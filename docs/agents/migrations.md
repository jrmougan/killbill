# Migrations and DB invariants

Read before touching `prisma/schema.prisma`, `prisma/migrations/` or adding a model. Procedure for agents: the `prisma-migration` skill.

## How they reach production

- `Dockerfile` `CMD` runs `prisma migrate deploy` before the server starts, so anything merged to `main` applies automatically; see `docs/agents/deployment.md`.
- `migrate deploy` executes migration SQL only, never backfill scripts. If a migration needs data moved first, it has to be sequenced across releases. `scripts/prod-migrate-runbook.sh` shows why, and is not a general tool.
- Migrations are not idempotent.

## Rules

- **Never edit an applied migration.** Git history has no modified `migration.sql`. Contract with a new migration (`remove_list_bridge_add_aisle` does exactly this).
- **Expand, then contract, across releases.** Add the new shape, stop writing the old one in a later change, then drop it. Precedents: `feat(lists)` 3ea6871 followed by `remove_list_bridge_add_aisle`; phase 5 stop-dual-write 568858a followed by CONTRACT df6b65e.
- **`prisma migrate dev` is interactive** and rejects non-interactive shells, so agents use `migrate diff`; see the skill.
- **Prisma does not model CHECK constraints** or the `scopeKey` columns. Read generated SQL and delete anything that touches them unintentionally.

## DB invariants (MySQL ≥ 8.0.16)

- Named `CHECK` constraints guard money columns and scope rules. A write that breaks a scope rule fails in the DB, not silently.
- `Category`, `Tag`, `Budget`, `ShoppingList` and `Expense` carry a VIRTUAL generated `scopeKey` column, declared `Unsupported(...)` in `schema.prisma` and never written by the app.
- `CHECK (scopeKey IS NOT NULL)` enforces the group XOR personal rule (and `SHARED ⇔ coupleId` on `Expense`). The column also backs `UNIQUE(scopeKey, key|name)`.
- MySQL ERROR 3823 forbids a CHECK on columns with an FK CASCADE, which is why `scopeKey` exists (`20261006110001_scope_check_constraints`).
- Production has had index drift, so some DROPs are conditional (`20261006110000`, `scripts/prod-capture-schema-drift.sql`).
- Before adding a constraint, check existing rows would pass: `scripts/validate-check-constraints.ts`, `scripts/validate-user-money-refs.ts`.

## New model checklist

- Add it to `src/app/api/test/reset/route.ts`, which lists one `deleteMany` per model explicitly and in FK order (dependents first; `Account`→`User` and `Split.userId` are Restrict). Update `src/app/api/test/gating.test.ts` if its mock needs it. def1e85 had to do this for `AiProviderConfig`: otherwise state leaks between scenarios.
- Review `src/app/api/test/seed/route.ts` scenarios that write the affected tables.
- `prisma/schema.prisma` is the source of truth for models. Do not keep a model count in docs.

## Text columns

Prisma `String` is VARCHAR(191) by default; overruns surface as a 500 (P2000). See rule 2 in `docs/route-handlers.md`.
