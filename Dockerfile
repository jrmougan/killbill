# 1. Base image
FROM node:20-alpine AS base
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
#    --chown es CLAVE: sin él la carpeta queda como root y el usuario `nextjs`
#    no puede escribir los tickets subidos en public/uploads (EACCES).
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Aseguramos que el directorio de subidas existe y es escribible por `nextjs`.
# Es el punto de montaje del volumen persistente de Coolify; al crearlo aquí
# con la propiedad correcta, un volumen nombrado hereda esos permisos.
RUN mkdir -p ./public/uploads && chown -R nextjs:nodejs ./public/uploads

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
# Instalamos dependencias de Prisma (CLI y configuración)
RUN npm init -y && npm install prisma tsx @prisma/client mysql2

# Volvemos al directorio de la app
WORKDIR /app

# Si usas Sharp para optimización de imágenes (RECOMENDADO), descomenta esto:
# COPY --from=builder /app/node_modules/sharp ./node_modules/sharp

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Arranque: aplicar migraciones pendientes (desde /prisma-tools, que trae el CLI
# de Prisma + las migraciones) y SOLO si tienen éxito, ejecutar el servidor. Si
# `migrate deploy` falla, el proceso muere y el contenedor no arranca — Coolify
# mantiene el contenedor anterior vivo (sin caída) hasta que se corrija. Un no-op
# rápido cuando no hay migraciones pendientes.
CMD ["sh", "-c", "cd /prisma-tools && ./node_modules/.bin/prisma migrate deploy && cd /app && exec node server.js"]