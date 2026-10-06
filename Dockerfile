# 1. Base image
# Match the version in mise.toml (local development and CI).
FROM node:24.21.0-alpine AS base
# Instalar libc6-compat es necesario para Prisma y Sharp en Alpine
RUN apk add --no-cache libc6-compat openssl

# 2. Dependencies
FROM base AS deps
WORKDIR /app

# Copiamos solo los archivos de dependencias primero para aprovechar la caché de Docker
COPY package.json package-lock.json* ./

# Usamos 'npm ci' que es más rápido y estricto que 'install'
RUN npm ci

# 3. Builder
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Definimos variables de entorno necesarias para el build
# (Pon una URL dummy si tu build no requiere conexión real a la BD, 
# pero Prisma generate la necesita para saber el provider)
ENV DATABASE_URL="mysql://dummy:dummy@localhost:3306/dummy"
ENV NEXT_TELEMETRY_DISABLED=1

# Generamos el cliente de Prisma
RUN ./node_modules/.bin/prisma generate

# Construimos la app
RUN npm run build

# 4. Runner (Production)
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Crear usuario no-root (Seguridad)
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# --- OPTIMIZACIÓN CLAVE ---

# 1. Copiamos la carpeta public (imágenes estáticas, favicon, etc.)
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Subidas (tickets/avatares) FUERA de public/: Next sirve public/ como estático
# antes de cualquier ruta, y eso saltaría la sesión de /uploads/[filename].
# Es el punto de montaje del volumen persistente; al crearlo aquí con la
# propiedad correcta (nextjs:nodejs), un volumen nombrado hereda esos permisos
# y el usuario no-root puede escribir (sin él: EACCES).
ENV UPLOAD_DIR=/app/uploads
RUN mkdir -p ./uploads && chown -R nextjs:nodejs ./uploads

# 2. Copiamos SOLO la carpeta standalone. 
# Next.js ya metió aquí dentro sus propias dependencias necesarias.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./

# 3. Copiamos la carpeta static a la ubicación correcta dentro de .next
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# 4. PRISMA: Copiamos el cliente generado para la APP (Runtime)
COPY --from=builder --chown=nextjs:nodejs /app/src/generated ./src/generated

# Configuramos entorno aislado para herramientas de Prisma (Migraciones)
WORKDIR /prisma-tools
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
# Instalamos SOLO el CLI de Prisma en la versión exacta del package-lock.json: sin
# fijarla, un rebuild instalaba Prisma 8 (sin `migrate`) y el contenedor no
# arrancaba. `prisma` ya trae su driver (mysql2) y el cargador de prisma.config.ts
# (c12/jiti); el .env lo lee process.loadEnvFile() (Node 24), así que no hacen
# falta mysql2, dotenv, tsx ni @prisma/client aquí.
COPY --from=builder /app/package-lock.json /tmp/package-lock.json
RUN npm init -y >/dev/null \
    && npm install --save-exact --no-audit --no-fund \
       "prisma@$(node -p "require('/tmp/package-lock.json').packages['node_modules/prisma'].version")" \
    && rm /tmp/package-lock.json \
    && npm cache clean --force

# Volvemos al directorio de la app
WORKDIR /app

# Si usas Sharp para optimización de imágenes (RECOMENDADO), descomenta esto:
# COPY --from=builder /app/node_modules/sharp ./node_modules/sharp

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Healthcheck sin curl (no viene en alpine): fetch nativo de Node contra
# /api/health, que hace SELECT 1. El start-period cubre `migrate deploy`.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# Arranque: aplicar migraciones pendientes (desde /prisma-tools, que trae el CLI
# de Prisma + las migraciones) y SOLO si tienen éxito, ejecutar el servidor. Si
# `migrate deploy` falla, el proceso muere y el contenedor no arranca — Coolify
# mantiene el contenedor anterior vivo (sin caída) hasta que se corrija. Un no-op
# rápido cuando no hay migraciones pendientes. `set -e` garantiza que
# un fallo de migración termina el contenedor con código != 0 (fail fast).
# Recomendado: mover las migraciones a un paso previo de Coolify (ver README).
CMD ["sh", "-c", "set -e; cd /prisma-tools; ./node_modules/.bin/prisma migrate deploy; cd /app; exec node server.js"]
