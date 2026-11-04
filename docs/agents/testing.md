# Testing

Read before touching `e2e/`, Playwright fixtures or test routes. The definition of done is in `AGENTS.md`.

## Layout

- Unit tests live alongside the code (`.test.ts`/`.test.tsx`), on Vitest with two projects: server code (`src/lib`, API routes, proxy, MCP) runs under `node`; components and `.tsx` tests under `jsdom`.
- End-to-end tests live in `e2e/` (Playwright, typechecked via `tsconfig.e2e.json`).
- CI runs e2e against MySQL 8.0 started from `compose.dev.yaml` (same flags as local and production). Unit tests, lint, typecheck and `npm audit --omit=dev --audit-level=critical` are blocking gates for the deploy.
- `vitest.config.ts` excludes `e2e/**`. CI separately runs `npx vitest run --config e2e/fixtures/vitest.config.ts`, so `mise run check` does not cover `e2e/fixtures/*.test.ts`.

## `TEST_ROUTES_ENABLED`

`TEST_ROUTES_ENABLED=true` enables `/api/test/*` and the `OCR_TEST_PROVIDER_URL` seam, and disables ALL rate limiting (`rateLimit()`, not only login). Never set it in production. `playwright.config.ts` sets it for its own server.

## Traps

- **E2E wipes the database in `.env`.** There is no separate test DB, and `/api/test/reset` deletes every user and space. The e2e server and `/api/test/reset`/`seed` refuse a non-local `DATABASE_HOST` or `DATABASE_URL` host (`src/lib/test-db-guard.mjs`), but a tunnel or forwarded port still looks local: never point them at another database that way.
- **Stop `mise run dev` first**: `reuseExistingServer: false`, and Playwright uses the same `PORT`.
- **Project routing**: `apiSuites` in `playwright.config.ts` (`api/crud`, `api/mcp`, `api/ai-settings`, `api/invites`, `shopping/smoke`, `*.api.spec.ts`) run only in the `api` project. `--project=mobile-chrome` ignores them silently. A new API suite outside `*.api.spec.ts` must be added to that list.
- **Flaky tests fail CI**: `failOnFlakyTests` under CI (guarded by `e2e/fixtures/config.test.ts`), with 2 retries that do not rescue a flake. Fix the wait instead (6ada52e, 4818a7d).
- **Fixture**: import `test` and `expect` from `e2e/fixtures/test.fixture.ts`. The auto `pageErrorGuard` fails a test on any uncaught browser error.
- **Extra sessions**: use the `newContext` fixture, never `browser.newContext`. There is no login API route; use `createAuthenticatedContext(newContext, user)` (`e2e/fixtures/auth.fixture.ts`) and its `ctx.request`.
- **Clocks**: the server runs `TZ=UTC`, the browser Europe/Madrid, on purpose, to catch inconsistent dates at hydration.
- **Server**: `e2e/ocr/test-server.mjs` runs `dev` locally and `standalone` in CI, so a build-only bug may pass locally. It also starts the loopback OCR provider, which only works with `TEST_ROUTES_ENABLED=true`, loopback and test credentials.
- **Mobile layout**: new screens go in `e2e/mobile/overflow.spec.ts`; see `docs/agents/ui-patterns.md`.

## Commands

Listed in `AGENTS.md`. `mise run typecheck` is `next typegen`, `tsc` (app) and `tsc -p tsconfig.e2e.json`; `mise run build` is Prisma generate plus the production build; `mise run services:up` waits for MySQL readiness. To seed a scenario, inspect `src/app/api/test/seed/route.ts` (for example `couple-with-debt`, `space-settling`, `ephemeral-with-guest`, `ux-showcase`).
