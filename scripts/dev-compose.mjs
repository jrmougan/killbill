import { spawnSync } from 'node:child_process';

// Use one pinned Compose implementation with either container engine.
const has = (command) => spawnSync(command, ['--version'], { stdio: 'ignore' }).status === 0;
const requested = process.env.CONTAINER_ENGINE;
if (requested && !['docker', 'podman'].includes(requested)) {
  throw new Error('CONTAINER_ENGINE must be docker or podman.');
}
const engine = requested || (has('docker') ? 'docker' : has('podman') ? 'podman' : null);
if (!engine) throw new Error('Install Docker or Podman before starting local services.');
if (!process.env.COMPOSE_PROJECT_NAME) {
  throw new Error('Set a unique COMPOSE_PROJECT_NAME in .env (see .env.example).');
}
const args = ['--project-name', process.env.COMPOSE_PROJECT_NAME, '--file', 'compose.dev.yaml', ...process.argv.slice(2)];
const result = engine === 'podman'
  ? spawnSync('podman', ['compose', ...args], {
    stdio: 'inherit',
    env: { ...process.env, PODMAN_COMPOSE_PROVIDER: 'docker-compose' },
  })
  : spawnSync('docker-compose', args, { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
