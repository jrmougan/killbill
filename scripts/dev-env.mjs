import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { readEnvFile, updateEnvFile } from './env-file.mjs';
import { SHARED_REPLICA } from '../src/lib/test-db-guard.mjs';

// Never replace an existing environment, including one prepared by a developer.
// Only add the WORKTREE_DATABASE_* keys a .env from before the shared replica lacks:
// until then DATABASE_* always described this worktree's own MySQL.
if (existsSync('.env')) {
  const env = readEnvFile('.env');
  if (env.WORKTREE_DATABASE_PORT) {
    console.log('Keeping existing .env.');
    process.exit(0);
  }
  if (Number(env.DATABASE_PORT) === SHARED_REPLICA.port) {
    throw new Error('.env has no WORKTREE_DATABASE_* and DATABASE_* points at the shared replica: fix it by hand (see .env.example).');
  }
  for (const key of ['DATABASE_PORT', 'DATABASE_USER', 'DATABASE_PASSWORD', 'DATABASE_NAME']) {
    if (!env[key]) throw new Error(`Missing ${key} in .env: cannot derive WORKTREE_${key}.`);
  }
  updateEnvFile('.env', {
    DATABASE_TARGET: env.DATABASE_TARGET || 'worktree',
    WORKTREE_DATABASE_PORT: env.DATABASE_PORT,
    WORKTREE_DATABASE_USER: env.DATABASE_USER,
    WORKTREE_DATABASE_PASSWORD: env.DATABASE_PASSWORD,
    WORKTREE_DATABASE_NAME: env.DATABASE_NAME,
  });
  console.log('Kept .env and added WORKTREE_DATABASE_* (this worktree\'s own MySQL).');
  process.exit(0);
}

// Stable per checkout, including worktrees with the same directory basename.
const hash = createHash('sha256').update(realpathSync('.')).digest('hex');
const offset = Number.parseInt(hash.slice(0, 8), 16) % 10000;

async function availablePort(start) {
  for (let port = start; port < start + 100; port++) {
    const server = createServer();
    const free = await new Promise((resolve, reject) => {
      server.once('error', (error) => error.code === 'EADDRINUSE' ? resolve(false) : reject(error));
      server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error(`No available local port near ${start}`);
}

const port = await availablePort(13000 + offset);
const dbPort = await availablePort(33000 + offset);
const password = randomBytes(24).toString('hex');
const values = {
  PORT: port,
  COMPOSE_PROJECT_NAME: `killbill-${hash.slice(0, 12)}`,
  DATABASE_HOST: '127.0.0.1',
  DATABASE_USER: 'killbill',
  DATABASE_PASSWORD: password,
  DATABASE_NAME: 'killbill',
  DATABASE_PORT: dbPort,
  DATABASE_URL: `mysql://killbill:${password}@127.0.0.1:${dbPort}/killbill`,
  DATABASE_TARGET: 'worktree',
  WORKTREE_DATABASE_PORT: dbPort,
  WORKTREE_DATABASE_USER: 'killbill',
  WORKTREE_DATABASE_PASSWORD: password,
  WORKTREE_DATABASE_NAME: 'killbill',
  MYSQL_ROOT_PASSWORD: randomBytes(24).toString('hex'),
  JWT_SECRET: randomBytes(32).toString('hex'),
};
let template = readFileSync('.env.example', 'utf8');
for (const [key, value] of Object.entries(values)) {
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  if (!pattern.test(template)) throw new Error(`Missing ${key} in .env.example`);
  template = template.replace(pattern, `${key}=${value}`);
}
writeFileSync('.env', template, { flag: 'wx', mode: 0o600 });
console.log(`Created .env for ${values.COMPOSE_PROJECT_NAME}. App: http://localhost:${port}; MySQL: 127.0.0.1:${dbPort}.`);
console.log('Next: mise run services:up, mise run db:migrate, mise run db:seed (or mise run db:replica:use-shared), mise run dev.');
