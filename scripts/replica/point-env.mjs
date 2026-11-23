// Points the app's DATABASE_* in .env at one database (docs/prod-replica.md):
//   shared <credentials.env>  the shared anonymized prod replica (127.0.0.1:23308)
//   worktree                  this worktree's own MySQL (empty and migrated)
//   local                     this worktree's own MySQL, loaded with db:replica:local;
//                             `mise run setup` leaves it alone until db:replica:use-shared
// Only DATABASE_TARGET and DATABASE_HOST/PORT/USER/PASSWORD/NAME/URL change.
// Prints no secrets.
import { readEnvFile, updateEnvFile } from '../env-file.mjs';
import { SHARED_REPLICA, worktreeDatabaseEnv } from '../../src/lib/test-db-guard.mjs';

const [target, credentials] = process.argv.slice(2);
const env = readEnvFile('.env');
let values;
if (target === 'shared') {
  if (!credentials) throw new Error('Usage: point-env.mjs shared <credentials.env>');
  const c = readEnvFile(credentials);
  for (const key of ['MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE']) {
    if (!c[key]) throw new Error(`Missing ${key} in the replica credentials`);
  }
  if (c.MYSQL_USER !== SHARED_REPLICA.user) throw new Error('Unexpected replica user in the credentials');
  values = {
    DATABASE_HOST: '127.0.0.1',
    DATABASE_PORT: SHARED_REPLICA.port,
    DATABASE_USER: c.MYSQL_USER,
    DATABASE_PASSWORD: c.MYSQL_PASSWORD,
    DATABASE_NAME: c.MYSQL_DATABASE,
    DATABASE_URL: `mysql://${c.MYSQL_USER}:${c.MYSQL_PASSWORD}@127.0.0.1:${SHARED_REPLICA.port}/${c.MYSQL_DATABASE}`,
  };
} else if (target === 'worktree' || target === 'local') {
  values = worktreeDatabaseEnv(env);
  if (!values.DATABASE_URL) throw new Error('Missing WORKTREE_DATABASE_* in .env: run mise run setup.');
} else {
  throw new Error('Usage: point-env.mjs shared <credentials.env> | worktree | local');
}
updateEnvFile('.env', { DATABASE_TARGET: target, ...values });
console.error(`[db:replica] .env: la app usa ${target === 'shared'
  ? `la réplica compartida (127.0.0.1:${SHARED_REPLICA.port})`
  : `la MySQL propia del worktree (127.0.0.1:${values.DATABASE_PORT}${target === 'local' ? ', con la réplica cargada' : ''})`}.`);
