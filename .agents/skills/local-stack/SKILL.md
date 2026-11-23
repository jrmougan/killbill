---
name: local-stack
description: Boot this app locally, inspect the local database or run e2e. Use when asked to run, start or screenshot the app, query local data, or run Playwright in this repo.
---

# Local stack

Commands are in `AGENTS.md`; e2e traps are in `docs/agents/testing.md`.

1. **Port**: `grep '^PORT=' .env`. Never read the whole `.env`; it holds secrets.
2. **Boot**: `mise run setup` once per worktree, then `mise run services:up`, `mise run db:migrate`, `mise run dev`. `setup` points the app at the shared anonymized prod replica (`127.0.0.1:23308`, login `admin@example.invalid` / `password`) when it exists; check `grep '^DATABASE_TARGET=' .env` (`shared`, `worktree` or `local`). With `worktree`, `mise run db:seed` for the local admin (`README.md`, "Desarrollo local"). Branch with new migrations: `mise run db:replica:local`; back: `mise run db:replica:use-shared` (`docs/prod-replica.md`).
3. **Browsers**: `mise exec -- npx playwright install chromium`. Add `--with-deps` only if system libraries are missing, since it can need sudo.
4. **E2E wipes this worktree's own MySQL** (`WORKTREE_DATABASE_*`), never the shared replica (guards abort). Stop `mise run dev` first; Playwright starts its own server. It also wipes a `db:replica:local` copy. Run one area with `mise run e2e -- e2e/<dir>`; API suites need `--project=api`.
5. **Scenario data**: scenarios are in `src/app/api/test/seed/route.ts`, and `/api/test/*` only answers with `TEST_ROUTES_ENABLED=true`, as under Playwright.
6. **Screens at phone size**: `SCREENS=a,b mise run ux:capture`. It also wipes the worktree's own database.
7. **Read-only query**, `SELECT` only (the host has no `mysql` client). Worktree DB below; the shared replica: `podman exec prod-replica-killbill sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" mysql -u"$MYSQL_USER" "$MYSQL_DATABASE" -e "SELECT ..."'`. Verify on first use:

   ```bash
   mise exec -- node --env-file=.env scripts/dev-compose.mjs exec -T db sh -c 'MYSQL_PWD=$MYSQL_PASSWORD mysql -u$MYSQL_USER $MYSQL_DATABASE -e "SELECT ..."'
   ```

8. **Dev server diagnostics without building**, with `mise run dev` running. Verify on first use:

   ```bash
   PORT=$(grep '^PORT=' .env | cut -d= -f2); curl -s -X POST http://localhost:$PORT/_next/mcp -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_compilation_issues","arguments":{}}}' | sed -n 's/^data: //p'
   ```

   Other tool names include `get_errors` (needs the page open in a browser), `get_routes` and `compile_route`.

9. **Stop**: `mise run services:down` keeps the volume.
