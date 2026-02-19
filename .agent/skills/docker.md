---
name: Docker & Deployment
description: Guidelines for deploying Kill Bill via Docker and Portainer.
---
# Deployment & Docker

- **Docker Compose**: The project uses `docker-compose.yml` for local and Portainer deployment. The `app` service is built from the root `Dockerfile`.
- **Environment Variables**: Essential vars include `DATABASE_URL` (or constructed via `DATABASE_HOST`), `JWT_SECRET`.
- **Network**: Deploys typically connect to an external Docker network (`app_network`) to communicate with a shared MySQL container (`mysql-shared`).
