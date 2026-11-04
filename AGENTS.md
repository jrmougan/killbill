<!-- Budget: ≤ 10 KB. Subsystem detail goes in docs/agents/, with a row in "Read before touching". -->
# Kill Bill — Agent Instructions

Couples/group expense-splitting app: Next.js App Router, Prisma + MySQL 8.0 (`@prisma/adapter-mariadb` driver), JWT auth. This file and the code win over anything historical in `docs/`.

## Non-negotiables

- **Money** is stored as integer cents; convert only for display (`src/lib/currency.ts`). API bodies are mixed: top-level `amount` (expenses, settlements, budgets) is euros; `customSplits[].amount` and `*Cents` fields are cents (see the domain `*-schemas.ts`). User-typed money goes through `parseEuroInput`, never `parseFloat`/`Number()`.
- **Balances** are `LedgerEntry` sums (`getGroupBalances` in `ledger-read.ts`), not `calculateBalances`.
- **API contract**: new or changed routes under `src/app/api/` use `route()` from `src/lib/http`; handlers throw `HttpError` or domain errors and authorize explicitly with `requireSpace`. Error shapes, statuses and Spanish messages are a contract: never change them in a refactor.
- **Sessions**: route handlers (oxlint enforces it under `src/app/api/**`) and guest pages that read or write space data use `getSessionCtx`; raw `getSession` does not revalidate guests against the DB.
- **Space lock**: every write whose validity depends on a space's status, roster or balances runs in `withSpaceLock` (`src/lib/expense-tx.ts`) and re-checks with `assertWritableUnderLock` / `assertRosterUnchanged` (409 `MEMBERS_CHANGED`). Kicking a member with an open balance is 409 `HAS_BALANCE`.
- **Migrations** auto-apply on deploy: never edit an applied one; expand then contract across releases (`docs/agents/migrations.md`).
- **Lists never generate an expense**: no bridge, no `linkedExpenseId`, no prices.
- **Colors** render inline from `hex`, never a dynamic tailwind class (the JIT purges those).
- **Uploads** never go under `public/`.
- **`TEST_ROUTES_ENABLED=true`** enables `/api/test/*` and the OCR test seam and disables ALL rate limiting. Never set it in production.
- **Never edit** `src/generated/prisma/`.

## Commands

Use the versions pinned in `mise.toml`.

```bash
mise trust && mise install
mise run setup          # Create .env if absent, npm ci, Prisma generate; no DB writes
mise run services:up    # Local MySQL (CONTAINER_ENGINE=podman optional)
mise run services:status
mise run db:migrate     # Apply committed migrations
mise run db:seed        # Seed system categories and admin
mise run dev            # Next.js on the PORT in .env
mise run check          # Prisma generate, oxlint, typecheck (app + e2e), unit tests
mise run lint
mise run test           # Unit tests once
mise exec -- npx vitest run src/lib/finance.test.ts  # One file
mise run typecheck
mise run build
mise exec -- npx playwright install chromium --with-deps  # Before first e2e
mise run e2e            # Own server; RESETS the database in .env; stop dev first
mise run e2e -- e2e/<dir>      # Or: -- --project=api
mise exec -- npx prisma migrate dev  # NEW migration; interactive (agents: prisma-migration skill)
mise run services:down  # Keep the DB volume
SCREENS=a,b mise run ux:capture  # Screenshot, a11y tree, overflow and <44px report at 360×760; wipes the DB, stop dev first
mise run ux:design      # Render the EQUIL mockups
```

- `compose.dev.yaml` is local only; `docker-compose.yml` describes production and provisions no DB.
- Each worktree runs `setup` independently (own `.env`, Compose project, ports, volume).
- npm scripts stay available through `mise exec -- npm …`.
- The Ralph loop is finished: `scripts/ralph/README.md`.

## Environment

`setup` creates `.env` from `.env.example` (never overwrites) and generates `PORT`, `COMPOSE_PROJECT_NAME`, `DATABASE_PORT`, `MYSQL_ROOT_PASSWORD` and credentials.

- Required: `DATABASE_URL`, `DATABASE_HOST`, `DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_NAME`, `JWT_SECRET` (signs session tokens).
- Flags: `EPHEMERAL_SPACES_ENABLED` (guest and ephemeral surface, off by default).
- Seed: `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_PIN`; set before seeding a shared environment.
- All others are listed with their subsystem doc (`ocr-llm`, `deployment`, `mcp`).

## Layout

- `src/app/` — pages and API routes. A new top-level page is public until its prefix is added to `PROTECTED_PATHS` (`src/proxy.ts`); guests need an explicit entry in `src/lib/authz-guest.ts` (deny-by-default).
- `src/components/` — React by feature; shared primitives in `ui/`. `src/hooks/` — `useApiMutation` over `apiRequest`.
- `src/lib/` — money: `finance.ts`, `splits.ts`, `ledger.ts`, `ledger-read.ts`, `expense-tx.ts`; auth: `auth.ts`, `authz.ts`, `jwt.ts`; OCR: `receipt-ocr-ai.ts`, `ai-settings.ts`, `secret-box.ts`, `uploads.ts`; `db.ts` (Prisma); `http/`.
- `src/proxy.ts` — request proxy (Next.js 16's rename of `middleware.ts`, Node.js runtime by default). Other API routes authenticate themselves.
- `src/mcp/` — MCP. `prisma/` — schema, migrations, seed. `e2e/` — Playwright. `docs/` — index in `docs/README.md`.
- `scripts/` — dev tooling (`dev-env.mjs`, `dev-compose.mjs`), one-off backfill/repair/validation scripts, the production migration runbook, `ralph/`.

## Domain in brief

- **Spaces**: a `Couple` row is a space with a `SpaceType` chosen at creation, never inferred: INDIVIDUAL (virtual, no rows), COUPLE, GROUP, EPHEMERAL (guests). Rules: `src/lib/space-policy.ts`.
- **Lifecycle**: `ACTIVE ⇄ SETTLING`, and either can go to `ARCHIVED` (terminal, read-only). SETTLING blocks new expenses but allows "Saldar deuda" (UI: "Cerrando cuentas").
- **Authorization** is against the resource's group, not the `active_group` cookie: `requireSpaceAccess` re-checks the DB Membership row.
- **Core models**: `Couple` → `Membership[]` (→ `User`), `Expense[]`, `Settlement[]`; `Expense` → `Split[]`, `Tag[]` via `ExpenseTag`; `Account`/`LedgerTransaction`/`LedgerEntry` hold the ledger. `prisma/schema.prisma` is the source of truth.
- **Enums**: `RecurringSeries.interval` and `Settlement.status`/`method` are Prisma enums. An expense category is relational (`Expense.categoryId` → `Category`); recurrence lives in `RecurringSeries`, not on `Expense`.
- **Balance flow**: saving an expense or a CONFIRMED settlement posts zero-sum entries in the same transaction (`postExpenseLedger`/`postSettlementLedger`). PENDING and REJECTED settlements never reach the ledger. `calculateBalances` is a reference formula for tests and `scripts/`.
- **Debt numbers differ**: `resolveMyDebts` = suggested greedy pairing only; `debtOf` = what a member really owes; `settlementCap` = max for one payment; `close-plan.ts` = what is left when closing. Display treats 1 cent as a debt (`isAtPeace`); blocking rules (leave, kick, archive) use `hasOpenBalance` (±1 cent).
- **CHECK constraints** (MySQL ≥ 8.0.16) guard money columns and scope rules; a bad write fails in the DB.
- **`scopeKey`**: VIRTUAL generated column, never written by the app, on Category/Tag/Budget/ShoppingList/Expense. Enforces group XOR personal; backs `UNIQUE(scopeKey, key|name)`.
- **Dates**: business dates are Europe/Madrid (servers run UTC): `APP_TZ` from `home-format.ts`, month bounds from `monthRange()`. Expense dates are stored at 12:00 UTC. In Server Components use `requestTime()`, never `new Date()` in render.

## UI language

- The user-facing product is EQUIL. UI copy and API errors are hardcoded Spanish; identifiers are English.
- Wording about debts, payments, closing or deleting comes from the glossary in `docs/ux/plan-acciones-criticas.md` §1 (`Saldar deuda`, `Al día`; never `Quedar en paz`, `liquidar`).
- The app sends no notifications and moves no money: do not promise it.
- Before changing visible text, grep it in `e2e/` and `scripts/ralph/capture.spec.ts`; specs assert exact Spanish strings, so update and run them in the same commit.

## Read before touching

| When you touch | Read |
| --- | --- |
| `src/app/api/**` | `docs/route-handlers.md` |
| `prisma/schema.prisma`, `prisma/migrations/`, new models | `docs/agents/migrations.md` |
| Auth, invites, guests, space lifecycle, `src/proxy.ts` | `docs/agents/spaces-auth.md` |
| Shopping lists, aisles | `docs/agents/shopping-lists.md` |
| Categories | `docs/agents/categories.md` |
| OCR, uploads, `/admin/ai`, LLM keys | `docs/agents/ocr-llm.md` |
| `src/mcp/**`, `src/app/api/mcp/` | `docs/agents/mcp.md` |
| `Dockerfile`, compose, CI, cron, health, dependency pins | `docs/agents/deployment.md` |
| `e2e/`, Playwright fixtures, test routes | `docs/agents/testing.md` |
| Screens, components, layout, refresh | `docs/agents/ui-patterns.md`, `docs/design/README.md` |
| UI copy, critical confirmations (`CriticalActionSheet`) | `docs/ux/plan-acciones-criticas.md` §1-2 |

## Skills (`.agents/skills/`)

Before a migration use `prisma-migration`; before touching finance/splits/ledger/settlements use `money-change`; to boot the app, query the local DB or run e2e use `local-stack`.

## Testing and done

- Before declaring work done: `mise run check`; for routes or UI also `mise run build` and the e2e of the area. `check` excludes build, e2e and `e2e/fixtures/*.test.ts`.
- `finance.ts`, `splits.ts`, `ledger.ts` and `ledger-read.ts` are the most critical.

## Commits and PRs

- `type(scope): asunto en español` (short scope; body explains cause and impact). Branch `jrmougan/<slug>`.
- PR body in Spanish, stating what could not be verified. Pushing to `main` deploys and migrates production, so go through a PR.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
