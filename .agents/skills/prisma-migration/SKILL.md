---
name: prisma-migration
description: Create a new Prisma migration in this repo. Use before changing prisma/schema.prisma, adding a model or column, adding a constraint or index, or writing anything under prisma/migrations/.
---

# Prisma migration

Rules, DB invariants and the new-model checklist: `docs/agents/migrations.md`. Read it first.

Merging to `main` applies migrations to production automatically. Never edit an applied migration. Do not use `prisma migrate reset`, `prisma db push` or `--accept-data-loss`: Prisma guards its CLI against agents, and consent must come from the user.

`prisma migrate dev` rejects non-interactive shells and needs shadow-database rights the local app user likely lacks. Use `migrate diff` instead:

1. Check that `.env` points at the local database (`grep '^DATABASE_HOST=' .env`) and that no production `DATABASE_URL` is exported.
2. Bring the local DB to head: `mise run services:up`, then `mise run db:migrate`.
3. Edit `prisma/schema.prisma`.
4. Generate the SQL. `<ts>` is `YYYYMMDDHHMMSS` and must sort after the newest existing migration:

   ```bash
   mkdir -p prisma/migrations/<ts>_<snake_name>
   mise exec -- npx prisma migrate diff --from-config-datasource --to-schema=prisma/schema.prisma --script --output=prisma/migrations/<ts>_<snake_name>/migration.sql
   ```

5. Read the generated SQL. Delete anything unrelated to the change, especially around `scopeKey` columns and hand-written constraints, which Prisma does not model.
6. Destructive or NOT NULL change on populated tables: split into expand and contract across releases.
7. Apply: `mise run db:migrate`, then `mise run db:generate`.
8. Follow the new-model checklist if you added a model, then run `mise run check`.

The `migrate diff` command has not been run in this repo yet; verify it on first use and fix this file if it differs.
