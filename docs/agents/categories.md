# Category system

Read before touching categories or anything that resolves a category key.

## Levels

Categories live in the `Category` table on three levels:

- **System**: 8 seeded rows, `isSystem=true`, `groupId=null` + `ownerId=null`.
- **Space**: custom rows scoped by `groupId`, for shared/couple spaces.
- **Personal**: custom rows scoped by `ownerId`, for INDIVIDUAL mode.

The effective set of a context is `system ∪ context-custom`: merge in `category-read.ts`, DB fetch in `category-db.ts` via `getEffectiveCategories`/`resolveCategoryId`. Space and personal customs never leak across scopes, because resolution queries one discriminant at a time.

The merge lets a custom row shadow a system row with the same `key`, but CRUD forbids reserved keys (400) and `duplicate` derives a new one, so no write path through the API creates a shadow today.

## Rules

- **No whitelists**: `/api/expenses` and `/api/budget` validate the category key against the effective set via `resolveCategoryId`. An unknown key is a **400**, never silently coerced to `other`.
- **Icons**: `Category.icon` stores a lucide component *name* (string). `ICON_REGISTRY` (`category-icons.ts`) is the single string→component resolver (`getIconComponent`, `isValidIconName`). The 8 system icon names must stay registered (guarded by `category-icons.test.ts`).
- **Colors**: rendered inline from `hex`, never a dynamic tailwind class (the JIT purges those). Writes must pass the closed palette check (`isValidCategoryHex`).

## CRUD

- `/api/spaces/[id]/categories` (OWNER/ADMIN only) and `/api/me/categories` (session-scoped) share `category-crud.ts`.
- Reserved system keys → 400.
- Delete **requires** an explicit reassignment target (no orphan, no silent `other`). A Budget period collision on the target aborts with **409**.
- `…/categories/duplicate` clones a system or custom row into a new custom one.
- `Budget` tracks per-category spending limits.

## Manual step and history

- System categories must be seeded (`prisma db seed`, or `mise run db:seed`).
- The `add_category_owner` migration is additive: nullable `ownerId` column, indexes and FK only.
