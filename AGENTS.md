# Kill Bill — Agent Instructions

## Commands

```bash
# Development
npm run dev          # Start dev server on http://localhost:3000

# Build & Production
npm run build        # Build production bundle (standalone output)
npm start            # Run production server

# Linting
npm run lint         # ESLint with Next.js + TypeScript rules

# Testing
npm test             # Run all Vitest tests (watch mode — use `npx vitest run` for one pass)
npx vitest run src/lib/finance.test.ts   # Run a single test file
npm run test:e2e     # Run Playwright end-to-end tests (e2e/)

# Database
npx prisma migrate dev    # Run migrations + regenerate client
npx prisma db seed        # Seed admin user
npx prisma studio         # Open Prisma Studio GUI

# Docker
docker compose up -d      # Start full stack (app + MySQL)
```

## Environment Variables

Copy `.env.example` to `.env`. Required variables:
- `DATABASE_URL`, `DATABASE_HOST`, `DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_NAME`
- `JWT_SECRET` — used for signing session tokens
- `GEMINI_API_KEY` — required for OCR receipt parsing

## Architecture

Kill Bill is a couples/group expense-splitting app. Full-stack Next.js with App Router, Prisma + MariaDB, and JWT auth.

### Key directories

- `src/app/` — Pages and API routes (App Router)
- `src/components/` — React components grouped by feature (`dashboard/`, `expense/`, `expenses/`, `ui/`)
- `src/lib/` — Core logic: `finance.ts` (balance/settlement math), `splits.ts` (split distributions), `ocr_parser.ts` (Gemini Vision OCR), `auth.ts` (session/cookie management), `jwt.ts` (sign/verify), `db.ts` (Prisma singleton)
- `src/proxy.ts` — Edge middleware protecting `/dashboard`, `/admin`, and `/api/admin` routes (Next.js 16 renamed `middleware.ts` → `proxy.ts`)
- `prisma/` — Schema, migrations, seed script, and fix scripts
- `src/generated/prisma/` — Generated Prisma client (do not edit manually)

### Data model

All monetary amounts are stored in **cents** (integers). Convert to euros only for display using `src/lib/currency.ts`.

Nine Prisma models: `Couple` → `User[]`, `Expense[]`, `Settlement[]`. An `Expense` has `Split[]` records (one per user) and links to `Tag[]` through `ExpenseTag`. `InviteCode` controls registration, and `Budget` tracks per-category spending limits. `Expense.category`/`recurringInterval` and `Settlement.status`/`method` are Prisma enums (not free-form strings).

### Espacios (spaces)

A `Couple` row doubles as a **space** with four modes selected at creation (`SpaceType`, never inferred from member count): **INDIVIDUAL** (virtual — no rows, `visibility=PERSONAL` + `ownerId`), **COUPLE** (cap 2), **GROUP** (cap 20), **EPHEMERAL** (cap 20, `expiresAt`, the only mode allowing guests). Caps and rules live in `src/lib/space-policy.ts`; the only allowed upgrade is COUPLE→GROUP. A space has a lifecycle `SpaceStatus` `ACTIVE → SETTLING → ARCHIVED` (reopenable); `SETTLING` blocks new expenses but allows settling, `ARCHIVED` is read-only. Membership/status is authorized **against the group of the resource** (not the `active_group` UI cookie) via `src/lib/authz.ts` `requireSpaceAccess`, which re-checks the DB Membership row, not the JWT claim. `GroupInvite` replaces eternal `Couple.code` links: link tokens are 256-bit bearer secrets stored **only as sha256 hash** (`tokenHash` + `tokenPrefix`), with `expiresAt`, `maxUses` and `revokedAt`; the plaintext is shown once. Login/register never silently auto-join — `/i/[token]` is the explicit consent screen. **Guest** access (shadow `User` with `isGuest=true`, Membership role `GUEST`) uses a short-lived `kind:'guest'` JWT (72h, sliding, hard-capped at the space `expiresAt`) that `getSessionCtx` **revalidates against the DB on every request** (revocation without a blacklist). The entire guest/ephemeral surface is gated behind the `EPHEMERAL_SPACES_ENABLED` env flag (see `src/lib/flags.ts`) — off by default; turning it off never breaks already-upgraded accounts.

### Auth flow

Login → bcryptjs password check → JWT signed with `jose` → stored as HttpOnly cookie. Middleware verifies JWT on every protected request. Session is refreshed on each API call in `src/lib/auth.ts`.

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

`ShoppingList` + `ShoppingListItem` (migration `add_shopping_lists` creates them; `remove_list_bridge_add_aisle` prunes the bridge and adds `aisle` — expand/contract). A list is **group** (`groupId`) or **personal** (`ownerId`) — XOR discriminated; items are lightweight (name required, optional `quantity`/`unit`/`note`/`aisle`) and carry **no `categoryId`**.

**A list is a PLANNING tool only — it NEVER generates an expense.** There is no list→expense bridge: no `checkoutList`, no `linkedExpenseId`, no `priceCents`, no `CheckoutSheet`. The spend is materialized by the receipt **OCR** (`/api/ocr` → `ocr_parser.ts`), which is the single source of truth for the money; the list just tracks what's missing, who grabs it and in which aisle order, ticked off together in near-real-time. All validation, scope/XOR enforcement, sortOrder allocation and the idempotent `checked` toggle (condition-by-id `updateMany`, never read-modify-write) live in `src/lib/list-crud.ts` (reads in `list-read.ts`, error mapping in `list-http.ts`); routes own only authorization.

**Aisle** (`aisle`, nullable): an OPTIONAL per-item supermarket-aisle key, **orthogonal to the 8 expense categories** — it organizes the physical walk through the shop, it does NOT classify spend and never touches the expense `CategoryPicker`. Its own static vocabulary (slug + emoji + `sortOrder` + keywords) lives in `src/lib/aisles.ts`; `autoAssignAisle(name)` best-effort assigns it from the item name (accent-folded keyword match, longest keyword wins, unmatched stays `null` — never forced to "otros"), and an explicit value is validated via `normalizeAisle`.

Routes: space `/api/spaces/[id]/lists/**` (authorized via `requireSpaceAccess`, `allowGuest:false`, writability blocks SETTLING/ARCHIVED) and personal `/api/me/lists/**` (session-scoped by `ownerId`), each with `…/[listId]/clear-checked` (deletes the checked items to recycle the weekly list). `clear-checked`/item routes all re-assert the list belongs to the scope (`getListWithItems`/`loadListInScope`) after the space-access gate. UI under `/lists` (índice Común/Personal + detalle) — `/lists` is proxy-protected.

### OCR flow

Receipt image uploaded → stored via `/api/upload` → path sent to `/api/ocr` → `ocr_parser.ts` calls Gemini Vision API → returns structured JSON (items + amounts) for user confirmation before saving.

### Deployment

GitHub Actions (`.github/workflows/deploy.yml`) on push to `main`: runs the e2e + unit/lint gates, builds a Docker image, pushes it to GHCR (`ghcr.io/jrmougan/killbill`), then triggers a **Coolify** webhook that pulls the new image and redeploys. Migrations run from the **container's start command** (`Dockerfile` `CMD`): `prisma migrate deploy` from the bundled `/prisma-tools` (Prisma CLI + `prisma/migrations`) executes before `node server.js`, so pending migrations auto-apply on every deploy and the server only starts if they succeed (a failed migration leaves the previous container serving). Coolify itself has no pre/post-deploy command. The container runs behind **Traefik** (host `finanzas.mougan.es`) and connects to a dedicated **MySQL 8.0** database (`killbill-mysql-8`, user in `mysql_native_password` — the `@prisma/adapter-mariadb` driver needs it) over the `coolify` Docker network. The production environment must set `JWT_SECRET` and `GEMINI_API_KEY` (auth fails loudly without `JWT_SECRET`).

## Testing

Unit tests live alongside the code in `src/lib/` (`.test.ts` files), using Vitest with jsdom. The `finance.ts` and `splits.ts` files are the most critical to keep tested — they contain the core financial math. End-to-end tests live in `e2e/` (Playwright) and run in CI against a MariaDB service; both unit tests and lint are blocking gates for the deploy. Test-only API routes (`/api/test/*`) and the login rate limiter are gated on `TEST_ROUTES_ENABLED=true`.
