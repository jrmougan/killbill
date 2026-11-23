// Runs a command against this worktree's own MySQL (compose.dev.yaml), never the
// shared prod replica, whatever .env's DATABASE_* says: e2e, ux:capture, db:migrate
// and db:seed write to (or wipe) their database (docs/prod-replica.md).
//   node scripts/worktree-db.mjs <command> [args...]
// CI has no .env and no WORKTREE_DATABASE_*: DATABASE_* is used as given, still
// refusing the replica.
import { spawnSync } from 'node:child_process';
import { sharedReplicaReason, worktreeDatabaseEnv } from '../src/lib/test-db-guard.mjs';

try { process.loadEnvFile(); } catch { /* no .env: CI passes real variables */ }
const env = { ...process.env, ...worktreeDatabaseEnv(process.env) };
const refusal = sharedReplicaReason(env);
if (refusal) {
  console.error(`Refusing to run against the shared replica: ${refusal}.`);
  process.exit(1);
}
const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('Usage: node scripts/worktree-db.mjs <command> [args...]');
  process.exit(2);
}
const result = spawnSync(command === 'node' ? process.execPath : command, args, { stdio: 'inherit', env });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
