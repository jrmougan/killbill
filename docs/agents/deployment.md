# Deployment and operations

Read before touching `Dockerfile`, compose files, CI, cron routes, the health route or dependency pins. Operator runbook: `README.md`, "Producción".

## Pipeline

GitHub Actions (`.github/workflows/deploy.yml`, `concurrency: deploy-main`, never cancelled), on push to `main`:

1. Runs the e2e, unit, lint, typecheck and audit gates.
2. Builds a Docker image (Buildx, GHA cache) and pushes it to GHCR (`ghcr.io/jrmougan/killbill`, tags `latest` + commit SHA).
3. Triggers a **Coolify** webhook that pulls the new image and redeploys.

## Migrations at start

- Migrations run from the **container's start command** (`Dockerfile` `CMD`): `prisma migrate deploy` from the bundled `/prisma-tools` (Prisma CLI + `prisma/migrations`) executes before `node server.js` (`set -e`).
- Pending migrations auto-apply on every deploy and the server only starts if they succeed. A failed migration exits the container non-zero and leaves the previous container serving.
- `/prisma-tools` installs only the `prisma` CLI, pinned from the lockfile.
- Coolify has no pre/post-deploy command yet. Recommended: move migrations to a Coolify pre-deploy step (see `README.md`).
- Writing migrations: `docs/agents/migrations.md`.

## Runtime

- `GET /api/health` is public and uncached: `SELECT 1` → 200 `{status:'ok'}`, 503 on DB failure. The image `HEALTHCHECK` uses it.
- The container runs behind **Traefik** (host `finanzas.mougan.es`) and connects to a dedicated **MySQL 8.0** database. The user is `mysql_native_password`, which the `@prisma/adapter-mariadb` driver needs.
- **Unverified network topology**: `docker-compose.yml` attaches `mysql_network` and `traefik` with `DATABASE_HOST=mysql`, while earlier docs said `killbill-mysql-8` over the `coolify` Docker network. Live settings are in Coolify, not in this repo. Check there before relying on either.
- Uploads live on a persistent volume mounted at `/app/uploads`; see `docs/agents/ocr-llm.md`.

## Scheduled jobs

Plain HTTP calls with `x-cron-secret: $CRON_SECRET`. Without `CRON_SECRET` both routes answer 503.

- `POST /api/cron/recurring` materializes due recurring expenses of every space and should be scheduled (Coolify Scheduled Tasks). The dashboard still does it lazily for what it opens.
- `POST /api/cron/purge` (`?dryRun=1`) deletes every space ARCHIVED longer than `PURGE_ARCHIVED_AFTER_DAYS` (default 90, **any type**, plus uploads). It is deliberately NOT scheduled in v1: per the route's header, archived spaces are kept indefinitely (the owner believes Coolify has no such task; not checked in Coolify itself). `.env.example` and that header say EPHEMERAL, but the query has no type filter, so decide on that filter before scheduling it.

## Production environment

- `JWT_SECRET` is required; auth fails loudly without it.
- OCR provider keys and rotation: `docs/agents/ocr-llm.md`.
- Secrets and the production connection are configured in Coolify.
- Never set `TEST_ROUTES_ENABLED` in production.

## Dependency pins

These look like oversights and Renovate keeps proposing them:

- Stay on MySQL 8.0. 8.4 removed `--default-authentication-plugin`, used by `compose.dev.yaml` and e2e, and production runs 8.0.
- `prisma`, `@prisma/client` and `@prisma/adapter-mariadb` move together (`renovate.json`; the `Dockerfile` pins `/prisma-tools` from the lockfile).
- Node lives in `mise.toml` and `Dockerfile`; change both.

## Local vs production compose

`compose.dev.yaml` is local only. `docker-compose.yml` describes production and does not provision a database.
