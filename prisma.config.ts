import { defineConfig } from 'prisma/config'

// Prisma 7 no carga .env por sí solo. Node 24 trae process.loadEnvFile(): en local
// lee .env; en el contenedor/CI no existe y las variables ya vienen del entorno.
try {
    process.loadEnvFile()
} catch {
    // Sin .env: usar el entorno tal cual.
}

// La CLI de Prisma (migrate deploy/dev/reset, db push, db seed, studio...) trabaja
// siempre contra la MySQL propia del worktree (WORKTREE_DATABASE_* de .env), aunque
// la app apunte a la réplica compartida: las migraciones de una rama no deben llegar
// a la réplica de todos los worktrees (docs/prod-replica.md). Sin esas variables
// (CI, contenedor de producción) no cambia nada. Sin imports locales: el Dockerfile
// copia solo este fichero a /prisma-tools. Misma lógica y puerto que
// src/lib/test-db-guard.mjs (worktreeDatabaseEnv, SHARED_REPLICA); un test lo comprueba.
const SHARED_REPLICA_PORT = 23308
const env = process.env
if (env.WORKTREE_DATABASE_PORT) {
    const { WORKTREE_DATABASE_PORT: port, WORKTREE_DATABASE_USER: user, WORKTREE_DATABASE_PASSWORD: password, WORKTREE_DATABASE_NAME: name } = env
    if (!user || !password || !name) throw new Error('Faltan WORKTREE_DATABASE_USER/PASSWORD/NAME en .env: ejecuta mise run setup.')
    // Se aplica a process.env para que el seed herede la misma base.
    Object.assign(env, {
        DATABASE_HOST: '127.0.0.1',
        DATABASE_PORT: port,
        DATABASE_USER: user,
        DATABASE_PASSWORD: password,
        DATABASE_NAME: name,
        DATABASE_URL: `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${port}/${name}`,
    })
}
let urlPort: number | undefined
try {
    urlPort = env.DATABASE_URL ? Number(new URL(env.DATABASE_URL).port) : undefined
} catch {
    // Prisma informará de la URL mal formada.
}
if (urlPort === SHARED_REPLICA_PORT) {
    throw new Error('La CLI de Prisma no trabaja contra la réplica compartida (puerto 23308). Usa mise run db:replica:local.')
}

export default defineConfig({
    schema: 'prisma/schema.prisma',
    migrations: {
        path: 'prisma/migrations',
        seed: 'npx tsx prisma/seed.ts',
    },
    datasource: {
        url: env.DATABASE_URL,
    },
})
