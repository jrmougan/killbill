# Kill Bill — Agent Instructions

## Commands

Use the versions pinned in `mise.toml` (Node 24.21.0, bundled npm 11.19.0).

```bash
mise install
mise run setup          # Preserve/create .env, npm ci, Prisma generate; no DB writes
mise run services:up    # Local MySQL via Docker/Podman; wait for readiness
mise run db:migrate     # Apply committed migrations explicitly
mise run db:seed        # Seed system categories and admin explicitly
mise run dev            # Next.js on the PORT generated in .env
mise run check          # Prisma generate + oxlint + typecheck (app + e2e) + unit tests
mise run typecheck      # next typegen + tsc (app) + tsc -p tsconfig.e2e.json
mise run build          # Prisma generate + production build
mise run e2e            # Playwright: uses/reset the configured DB; stop dev first
mise run services:down  # Keep the DB volume
```

`compose.dev.yaml` is local-only; `docker-compose.yml` is the production deployment
and does not provision a database. Each worktree should run `setup` independently,
with its own `.env`, Compose project, ports and volume. See README.md for details.
The existing npm scripts remain available through `mise exec -- npm …`.

## Environment Variables

`mise run setup` creates `.env` from `.env.example` with local credentials and ports; it never overwrites an existing file. Required variables:
- `DATABASE_URL`, `DATABASE_HOST`, `DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_NAME`
- `JWT_SECRET` — used for signing session tokens
- `GEMINI_API_KEY` — primary provider for OCR receipt parsing
- `OPENROUTER_API_KEY` — optional OCR fallback when Gemini fails or returns invalid output
- `OPENROUTER_OCR_MODEL` — optional fallback model override (defaults to `xiaomi/mimo-v2.6-flash`)
- `UPLOAD_DIR` — optional upload storage dir (default `<cwd>/uploads`; `/app/uploads` in Docker). Never under `public/`
- `CRON_SECRET` — optional; enables `POST /api/cron/recurring` and `/api/cron/purge` (503 without it)

## Architecture

Kill Bill is a couples/group expense-splitting app. Full-stack Next.js with App Router, Prisma + MySQL 8.0 (via the `@prisma/adapter-mariadb` driver), and JWT auth.

### Key directories

- `src/app/` — Pages and API routes (App Router)
- `src/components/` — React components grouped by feature (`dashboard/`, `expense/`, `expenses/`, `ui/`)
- `src/hooks/` — client hooks: `useApiMutation` (fetch + error + `router.refresh`) over `apiRequest`
- `src/lib/` — Core logic: `finance.ts` (balance/settlement math), `splits.ts` (split distributions), `expense-tx.ts` (space lock + ledger transactions), `receipt-ocr-ai.ts` (Gemini/OpenRouter receipt OCR), `auth.ts` (session/cookie management), `jwt.ts` (sign/verify), `uploads.ts` (upload storage paths), `db.ts` (Prisma singleton)
- `src/proxy.ts` — Edge middleware protecting `/dashboard`, `/admin`, and `/api/admin` routes (Next.js 16 renamed `middleware.ts` → `proxy.ts`)
- `prisma/` — Schema, migrations, seed script, and fix scripts
- `src/generated/prisma/` — Generated Prisma client (do not edit manually)

### Data model

All monetary amounts are stored in **cents** (integers). Convert to euros only for display using `src/lib/currency.ts`.

Nine Prisma models: `Couple` → `User[]`, `Expense[]`, `Settlement[]`. An `Expense` has `Split[]` records (one per user) and links to `Tag[]` through `ExpenseTag`. `InviteCode` controls registration, and `Budget` tracks per-category spending limits. `Expense.category`/`recurringInterval` and `Settlement.status`/`method` are Prisma enums (not free-form strings).

**DB invariants** (MySQL ≥ 8.0.16): named `CHECK` constraints guard money columns and scope rules. Category/Tag/Budget/ShoppingList/Expense carry a VIRTUAL generated `scopeKey` column (`Unsupported(...)` in `schema.prisma`, never written by the app) with `CHECK (scopeKey IS NOT NULL)` enforcing the group XOR personal rule (and `SHARED ⇔ coupleId` on Expense); it also backs `UNIQUE(scopeKey, key|name)`. A write that breaks a scope rule fails in the DB, not silently.

**Space lock**: every write whose validity depends on a space's status, roster or balances (expenses incl. share/import, settlements, leave/kick, lifecycle, recurring materialization) runs in `withSpaceLock` (`src/lib/expense-tx.ts`: `SELECT … FOR UPDATE` on the `Couple` row first, READ COMMITTED, retried on deadlock) and re-checks under it with `assertWritableUnderLock` / `assertRosterUnchanged` (409 `MEMBERS_CHANGED`). Kicking a member with an open balance is 409 `HAS_BALANCE` (settle first; no `force`).

### Espacios (spaces)

A `Couple` row doubles as a **space** with four modes selected at creation (`SpaceType`, never inferred from member count): **INDIVIDUAL** (virtual — no rows, `visibility=PERSONAL` + `ownerId`), **COUPLE** (cap 2), **GROUP** (cap 20), **EPHEMERAL** (cap 20, `expiresAt`, the only mode allowing guests). Caps and rules live in `src/lib/space-policy.ts`; the only allowed upgrade is COUPLE→GROUP. A space has a lifecycle `SpaceStatus` `ACTIVE → SETTLING → ARCHIVED` (reopenable); `SETTLING` blocks new expenses but allows settling, `ARCHIVED` is read-only. Membership/status is authorized **against the group of the resource** (not the `active_group` UI cookie) via `src/lib/authz.ts` `requireSpaceAccess`, which re-checks the DB Membership row, not the JWT claim. `GroupInvite` replaces eternal `Couple.code` links: link tokens are 256-bit bearer secrets stored **only as sha256 hash** (`tokenHash` + `tokenPrefix`), with `expiresAt`, `maxUses` and `revokedAt`; the plaintext is shown once. Login/register never silently auto-join — `/i/[token]` is the explicit consent screen. **Guest** access (shadow `User` with `isGuest=true`, Membership role `GUEST`) uses a short-lived `kind:'guest'` JWT (72h, sliding, hard-capped at the space `expiresAt`) that `getSessionCtx` **revalidates against the DB on every request** (revocation without a blacklist). The entire guest/ephemeral surface is gated behind the `EPHEMERAL_SPACES_ENABLED` env flag (see `src/lib/flags.ts`) — off by default; turning it off never breaks already-upgraded accounts.

### Auth flow

Login → bcryptjs password check → JWT signed with `jose` → stored as HttpOnly cookie. Middleware verifies JWT on every protected request. Registered sessions are **not** refreshed per request: fixed 7 days from login (only guest JWTs slide, in the proxy). Each JWT carries `tv` = `User.tokenVersion`; `getSession` rejects a stale `tv`, and `POST /api/me/sessions/revoke` bumps it ("cerrar sesión en todos los dispositivos" — also kills MCP tokens). Route handlers and guest-reachable pages use `getSessionCtx` (`src/lib/authz.ts`), never raw `getSession` — oxlint forbids importing it under `src/app/api/**`. Login is rate-limited per IP **and** per email; the client IP is `X-Real-Ip` or the **last** `X-Forwarded-For` hop (`getClientIp`, assumes Traefik is the only ingress).

### Expense & balance flow

1. User creates expense: payer + total amount + splits (equal or custom)
2. `finance.ts` calculates each user's net balance: `amount paid − fair share of splits ± settlements`
3. Settlement records zero out debts between specific users

### Category system

Categories live in the `Category` table on three levels: **system** (8 seeded rows, `isSystem=true`, `groupId=null`+`ownerId=null`), **space** (custom rows scoped by `groupId`, for shared/couple spaces), and **personal** (custom rows scoped by `ownerId`, for INDIVIDUAL mode). A custom row *shadows* the system row with the same `key`; the effective set of a context is `system ∪ context-custom` (merge in `category-read.ts`, DB fetch in `category-db.ts` via `getEffectiveCategories`/`resolveCategoryId`). Space and personal customs never leak across scopes — resolution queries one discriminant at a time.

- **No whitelists**: `/api/expenses` and `/api/budget` validate the category key against the effective set via `resolveCategoryId` — an unknown key is a **400**, never silently coerced to `other`.
- **Icons**: `Category.icon` stores a lucide component *name* (string). `ICON_REGISTRY` (`category-icons.ts`) is the single string→component resolver (`getIconComponent`, `isValidIconName`); the 8 system icon names must stay registered (guarded by `category-icons.test.ts`).
- **Colors**: rendered inline from `hex` (never a dynamic tailwind class — the JIT purges those). Writes must pass the closed palette check (`isValidCategoryHex`).
- **CRUD**: `/api/spaces/[id]/categories` (OWNER/ADMIN only) and `/api/me/categories` (session-scoped) share `category-crud.ts`. Reserved system keys → 400; delete **requires** an explicit reassignment target (no orphan/silent `other`) and a Budget period collision on the target aborts with **409**. `…/categories/duplicate` clones a system/custom row into a new custom.
- **Manual step**: system categories must be seeded (`prisma db seed`); the `add_category_owner` migration is additive (nullable `ownerId` column + indexes + FK only).

### Shopping lists (listas de la compra)

`ShoppingList` + `ShoppingListItem` (migration `add_shopping_lists` creates them; `remove_list_bridge_add_aisle` prunes the bridge and adds `aisle` — expand/contract). A list is **group** (`groupId`) or **personal** (`ownerId`) — XOR discriminated; items are lightweight (name required, optional `quantity`/`unit`/`note`/`aisle`) and carry **no `categoryId`**. `quantity` is a positive DOUBLE (≤ 100 000, ≤ 3 decimals: "1,5 kg"); `src/lib/list-quantity.ts` parses it for both the editor and the API (number or es-ES text) and never truncates/clears silently (migration `shopping_item_decimal_quantity`).

**A list is a PLANNING tool only — it NEVER generates an expense.** There is no list→expense bridge: no `checkoutList`, no `linkedExpenseId`, no `priceCents`, no `CheckoutSheet`. The spend is materialized by the receipt **OCR** (`/api/ocr` → `ocr_parser.ts`), which is the single source of truth for the money; the list just tracks what's missing, who grabs it and in which aisle order, ticked off together in near-real-time (the client polls a cheap `…/[listId]/version` stamp and only `router.refresh()`es when it changes). All validation, scope/XOR enforcement, sortOrder allocation and the idempotent `checked` toggle (condition-by-id `updateMany`, never read-modify-write) live in `src/lib/list-crud.ts` (reads in `list-read.ts`, error mapping in `list-http.ts`); routes own only authorization.

**Aisle** (`aisle`, nullable): an OPTIONAL per-item supermarket-aisle key, **orthogonal to the 8 expense categories** — it organizes the physical walk through the shop, it does NOT classify spend and never touches the expense `CategoryPicker`. Its own static vocabulary (slug + emoji + `sortOrder` + keywords) lives in `src/lib/aisles.ts`; `autoAssignAisle(name)` best-effort assigns it from the item name (accent-folded keyword match, longest keyword wins, unmatched stays `null` — never forced to "otros"), and an explicit value is validated via `normalizeAisle`.

Routes: space `/api/spaces/[id]/lists/**` (authorized via `requireSpaceAccess`, `allowGuest:false`; writes go through `requireListWriteAccess` in `list-http.ts`: because a list is planning, not spending, it stays **editable while the space is SETTLING** and only **ARCHIVED** blocks writes with 409 `SPACE_NOT_WRITABLE` — the UI shows a read-only banner, and in SETTLING "Terminar" only empties the cart instead of opening the add-expense form) and personal `/api/me/lists/**` (session-scoped by `ownerId`; guest sessions get 403), each with `…/[listId]/clear-checked` (deletes the checked items to recycle the weekly list). `clear-checked`/item routes all re-assert the list belongs to the scope (`getListWithItems`/`loadListInScope`) after the space-access gate. UI under `/lists` (the Listas tab): a chip per list (Común first, then Personal, with the pending count) and the selected list as the main view (`/lists` opens the first one, `/lists/[listId]` deep-links; server loader `src/app/lists/load.ts`, client `src/components/shopping/lists-hub.tsx`); pending items grouped by aisle, checked ones under "En el carro", ~6 s poll + refresh on mount/focus/`pageshow`/visibility (no stale cart after browser back); adding a pending duplicate asks first ("Sumar 1" / "Añadir igualmente") — `/lists` is proxy-protected.

**"Terminar y apuntar gasto" is a shortcut WITHOUT link.** It only (1) calls `…/[listId]/clear-checked` and then (2) navigates to `/expenses/new?title=<list name>&category=shopping&space=<groupId|personal>&returnTo=/lists/<listId>&scan=1` (built by `buildFinishExpenseUrl` in `src/components/shopping/finish-url.ts`; `shopping` is the seeded system category the OCR also uses for supermarket receipts). The add-expense form is merely prefilled; the user still enters/scans the amount and saves it like any other expense. Nothing is persisted that ties the list to the expense (still no `linkedExpenseId`, no prices), and abandoning the form creates nothing — the list itself never generates an expense.

### OCR flow

Receipt image uploaded → stored via `/api/upload` (session required, per-user rate limit, PNG/JPEG/WEBP magic-byte check) in `UPLOAD_DIR` — outside `public/`, which Next would serve statically without auth — and read back only through the session-gated `src/app/uploads/[filename]/route.ts` (legacy `public/uploads` still read until migrated) → path sent to `/api/ocr` → Gemini Vision returns structured JSON (items + amounts) for user confirmation before saving. Provider calls and response validation live in `receipt-ocr-ai.ts`; an API, empty-response, or invalid-JSON failure falls back to OpenRouter when `OPENROUTER_API_KEY` is configured.

### MCP server (Model Context Protocol)

The app exposes an MCP endpoint at `POST /api/mcp` (Streamable HTTP transport) so external AI agents (Hermes Agent, Claude Desktop, etc.) can interact with Kill Bill programmatically.

**Architecture**: The MCP endpoint is served by the existing Next.js standalone process — no second process or Docker changes. Auth is `Authorization: Bearer <jwt>` validated via the same `JWT_SECRET` used for browser sessions (`src/lib/mcp-auth.ts` `validateBearerToken`). Guest tokens are rejected. The endpoint is **stateless**: every POST builds a fresh `McpServer` (`src/mcp/server.ts` `createServer`) + transport bound to that request's bearer and tears them down after responding (GET/DELETE → 405; no session map, `Mcp-Session-Id` is ignored). The server that wraps the raw JWT in an `InternalApiClient` (`src/mcp/internal-client.ts`) — this client injects the JWT as the `session_token` cookie on internal HTTP calls to the existing API routes, so **every tool reuses the full authorization stack** (`requireSpaceAccess`, role gates, space-policy) with zero duplication. The transport is `WebStandardStreamableHTTPServerTransport` (Web-standard `Request`/`Response`, native to Next.js route handlers). MCP tokens carry `tv` too, so revoking sessions invalidates them.

**Token issuance**: `POST /api/me/mcp-token` (requires normal session cookie auth) issues a 90-day JWT with `kind:'mcp'` (`signMcpToken` in `jwt.ts`). TTL configurable via `MCP_TOKEN_TTL_DAYS` env var.

**Tool modules** (`src/mcp/tools/`): each exports a `ToolRegistrar` function that registers tools on the `McpServer`. Tool inputs are validated with Zod (raw shapes, not `z.object()`); outputs are JSON content blocks. Tool `inputSchema` fields use `.describe()` for agent UX. Tools are wired in the `registrars` array in `src/mcp/server.ts`.

- `finance.ts` — `list_spaces`, `get_balance`, `list_expenses`, `create_expense`, `update_expense`, `delete_expense`, `create_settlement`, `confirm_settlement`. Monetary inputs in euros (floats); `customSplits` amounts are converted to cents via `toCents` before posting to the API.
- `budget-shopping.ts` — `get_budgets`, `get_categories`, `list_shopping_lists`, `create_shopping_list`, `add_shopping_item`, `check_shopping_item`, `clear_checked_items`. Space-vs-personal routing is driven by whether `groupId` is provided.
- `ocr.ts` — `parse_receipt` accepts base64 image data, forwards to `/api/ocr` as multipart form.
- `resources-prompts.ts` — Resources `kb://spaces` and `kb://budget-summary`; Prompts `monthly_report`, `settle_up_guide`, `shopping_trip`.

**Hermes Agent config** (`~/.hermes/config.yaml`):
```yaml
mcp_servers:
  killbill:
    url: "https://finanzas.mougan.es/api/mcp"
    headers:
      Authorization: "Bearer <jwt from POST /api/me/mcp-token>"
```

### Deployment

GitHub Actions (`.github/workflows/deploy.yml`, `concurrency: deploy-main`, never cancelled) on push to `main`: runs the e2e + unit/lint/typecheck/audit gates, builds a Docker image (Buildx, GHA cache), pushes it to GHCR (`ghcr.io/jrmougan/killbill`, tags `latest` + commit SHA), then triggers a **Coolify** webhook that pulls the new image and redeploys. Migrations run from the **container's start command** (`Dockerfile` `CMD`): `prisma migrate deploy` from the bundled `/prisma-tools` (Prisma CLI + `prisma/migrations`) executes before `node server.js` (`set -e`), so pending migrations auto-apply on every deploy and the server only starts if they succeed (a failed migration exits the container non-zero and leaves the previous container serving). `/prisma-tools` installs only the `prisma` CLI pinned from the lockfile. Coolify itself has no pre/post-deploy command yet (recommended: move migrations to a Coolify pre-deploy step, see README). The image has a `HEALTHCHECK` on **`GET /api/health`** (public, uncached: `SELECT 1` → 200 `{status:'ok'}`, 503 on DB failure). The container runs behind **Traefik** (host `finanzas.mougan.es`) and connects to a dedicated **MySQL 8.0** database (`killbill-mysql-8`, user in `mysql_native_password` — the `@prisma/adapter-mariadb` driver needs it) over the `coolify` Docker network. Uploads live on a persistent volume mounted at `/app/uploads`. Scheduled jobs are plain HTTP calls with `x-cron-secret: $CRON_SECRET` (Coolify Scheduled Tasks): `POST /api/cron/recurring` materializes due recurring expenses of every space (the dashboard still does it lazily for what it opens) and `POST /api/cron/purge` (`?dryRun=1`) deletes spaces ARCHIVED longer than `PURGE_ARCHIVED_AFTER_DAYS` (+ their uploads). `GET /api/health` is the healthcheck. The production environment must set `JWT_SECRET` and at least one OCR provider key (`GEMINI_API_KEY` and/or `OPENROUTER_API_KEY`); configure both to enable failover (auth fails loudly without `JWT_SECRET`).

## Testing

Unit tests live alongside the code (`.test.ts`/`.test.tsx`), using Vitest with two projects: server code (`src/lib`, API routes, proxy, MCP) runs under `node`, components and `.tsx` tests under `jsdom`. The `finance.ts` and `splits.ts` files are the most critical to keep tested — they contain the core financial math. End-to-end tests live in `e2e/` (Playwright, typechecked via `tsconfig.e2e.json`) and run in CI against MySQL 8.0 started from `compose.dev.yaml` (same flags as local/prod); unit tests, lint, typecheck and `npm audit --omit=dev --audit-level=critical` are blocking gates for the deploy. Test-only API routes (`/api/test/*`) and the login rate limiter are gated on `TEST_ROUTES_ENABLED=true`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
