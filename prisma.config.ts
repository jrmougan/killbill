import { defineConfig } from 'prisma/config'

// Prisma 7 no carga .env por sí solo. Node 24 trae process.loadEnvFile(): en local
// lee .env; en el contenedor/CI no existe y las variables ya vienen del entorno.
try {
    process.loadEnvFile()
} catch {
    // Sin .env: usar el entorno tal cual.
}

export default defineConfig({
    schema: 'prisma/schema.prisma',
    migrations: {
        path: 'prisma/migrations',
        seed: 'npx tsx prisma/seed.ts',
    },
    datasource: {
        url: process.env.DATABASE_URL,
    },
})
