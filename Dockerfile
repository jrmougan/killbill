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
RUN npx prisma generate

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
COPY --from=builder /app/public ./public

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
# Instalamos dependencias de Prisma (CLI y configuración)
RUN npm init -y && npm install prisma tsx @prisma/client

# Volvemos al directorio de la app
WORKDIR /app

# Si usas Sharp para optimización de imágenes (RECOMENDADO), descomenta esto:
# COPY --from=builder /app/node_modules/sharp ./node_modules/sharp

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Ejecutamos server.js (que está dentro de la carpeta standalone que copiamos a la raíz)
CMD ["node", "server.js"]