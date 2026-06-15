---
name: Docker & Deployment
description: Guidelines for deploying Kill Bill via Docker, GHCR, and Coolify.
---
# Deployment & Docker

- **CI/CD**: `.github/workflows/deploy.yml` runs on push to `main`. It first runs the Playwright e2e suite (`e2e.yml`), then builds the Docker image and pushes it to GHCR (`ghcr.io/jrmougan/killbill:latest`), and finally triggers a redeploy by calling the **Coolify webhook** (`COOLIFY_WEBHOOK` + `COOLIFY_TOKEN` secrets). There is no SSH-into-VPS step anymore.
- **Coolify**: Production is managed by Coolify, which pulls the new GHCR image and restarts the container on webhook trigger. Run `prisma migrate deploy` as part of the release so the DB schema stays in sync.
- **Docker Compose**: `docker-compose.yml` describes the `app` service used in production (image from GHCR, not built locally). It is exposed through **Traefik** (router host `finanzas.mougan.es`, TLS via `myresolver`, service port `3000`).
- **Environment Variables**: `DATABASE_URL` (or built from `DATABASE_HOST`/`DATABASE_USER`/`DATABASE_PASSWORD`/`DATABASE_NAME`/`DATABASE_PORT`), `JWT_SECRET`, and `GEMINI_API_KEY` (OCR).
- **Networks**: The container joins two external Docker networks — `mysql_network` (to reach the shared MySQL/MariaDB instance) and `traefik` (for the reverse proxy). Uploads persist via a `./uploads:/app/public/uploads` volume.
