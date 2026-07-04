# Phase 1 — Group + Membership (expand → migrate → contract, DATA-SAFE)

> Status: **planning checklist** (no code changed by authoring this doc).
> Prereq: Phase 0 (`20260704090000_phase0_hygiene_currency`) is applied.
> Money is always integer minor units (cents). Live DB has ~146 expenses — every step is additive and reversible.

## 0. Guiding principle

We introduce a **many-to-many membership layer** (`Membership`) *alongside* the existing
one-user-one-couple model. We do **not** rename or drop anything in Phase 1.

- `groupId` on `Membership` **is** the existing `Couple.id` (FK to `Couple` for now).
- `User.coupleId` **stays** and remains the source of truth until reads are switched.
- Renaming `Couple` → `Group` and dropping `User.coupleId` are an **explicit later CONTRACT phase** (Phase 2), out of scope here.

This keeps Phase 1 fully reversible: if anything is wrong, we stop reading `Membership`, and the old columns still hold the truth.

Order of operations (do not reorder):
1. **EXPAND** — add `Membership` table + enums (additive DDL). App logic untouched.
2. **MIGRATE (backfill)** — populate `Membership` from `User.coupleId`.
3. **VERIFY** — assert `Membership` reproduces current membership exactly + balance-parity gate.
4. **SWITCH READS** — repoint code to derive members from `Membership` (still writing `coupleId` too).
5. (Later, Phase 2, NOT here) CONTRACT — rename `Couple`→`Group`, drop `User.coupleId`.

---

## 1. Target schema additions (`prisma/schema.prisma`)

Add two enums and one model. **Do not touch** `Couple`, `User`, `Expense`, `Settlement`, `Budget`, `Tag`.

```prisma
enum MembershipRole {
  OWNER
  ADMIN
  MEMBER
}

enum MembershipStatus {
  ACTIVE
  LEFT
  REMOVED
}

model Membership {
  id       String @id @default(cuid())

  // groupId == Couple.id for now. FK points at Couple until the Phase 2 rename.
  groupId  String
  group    Couple @relation(fields: [groupId], references: [id], onDelete: Cascade)

  userId   String
  user     User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  role     MembershipRole   @default(MEMBER)
  status   MembershipStatus @default(ACTIVE)

  joinedAt DateTime  @default(now())
  leftAt   DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([groupId, userId])
  @@index([groupId])
  @@index([userId])
  @@index([groupId, status])
}
```

Back-relations required for Prisma to compile (additive, no column changes):
- On `model Couple`: add `memberships Membership[]`
- On `model User`: add `memberships Membership[]`

After editing schema:
```bash
npx prisma generate   # ALLOWED. Do NOT run prisma migrate dev/deploy.
```

Design notes to record in the PR:
- `@@unique([groupId, userId])` means a user has **at most one** membership row per group. Backfill sets `status=ACTIVE`. Future "left then rejoined" is modeled by flipping `status`/`leftAt`, not by inserting a second row.
- `role`/`status` are **enums**, consistent with the existing enum style (`SettlementStatus`, `ExpenseVisibility`).
- FK `onDelete: Cascade` on `group` mirrors today's `couple/unlink` cleanup (deleting a Couple removes its memberships automatically).

---

## 2. Migration + backfill SQL sketch

Hand-write the migration SQL (same style as `20260704090000_phase0_hygiene_currency/migration.sql`: raw `ALTER/CREATE TABLE` for MariaDB). **The migration is applied out-of-band with a backup — do NOT run `prisma migrate dev/deploy` yourself.**

New migration dir: `prisma/migrations/2026XXXXXXXXXX_phase1_group_membership/migration.sql`

### 2a. EXPAND — create table (additive, no data change)

```sql
-- Phase 1: Group + Membership. Additive; existing tables untouched.

CREATE TABLE `Membership` (
  `id`        VARCHAR(191) NOT NULL,
  `groupId`   VARCHAR(191) NOT NULL,
  `userId`    VARCHAR(191) NOT NULL,
  `role`      ENUM('OWNER','ADMIN','MEMBER')   NOT NULL DEFAULT 'MEMBER',
  `status`    ENUM('ACTIVE','LEFT','REMOVED')  NOT NULL DEFAULT 'ACTIVE',
  `joinedAt`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `leftAt`    DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `Membership_groupId_userId_key` (`groupId`, `userId`),
  INDEX `Membership_groupId_idx` (`groupId`),
  INDEX `Membership_userId_idx` (`userId`),
  INDEX `Membership_groupId_status_idx` (`groupId`, `status`),
  PRIMARY KEY (`id`)
);

ALTER TABLE `Membership`
  ADD CONSTRAINT `Membership_groupId_fkey`
    FOREIGN KEY (`groupId`) REFERENCES `Couple`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `Membership_userId_fkey`
    FOREIGN KEY (`userId`)  REFERENCES `User`(`id`)   ON DELETE CASCADE ON UPDATE CASCADE;
```

### 2b. MIGRATE — backfill from `User.coupleId`

Rule: one `ACTIVE` row per `(coupleId, userId)`; **earliest member of each couple = `OWNER`, everyone else = `MEMBER`**. "Earliest" = smallest `User.createdAt` (tie-break by `User.id` to be deterministic).

`cuid()` ids can't be generated in pure SQL portably, so generate ids as a hash of the natural key (deterministic + idempotent-friendly), or generate them in a tiny script (see 2c). SQL-only version:

```sql
-- Everyone with a couple becomes an ACTIVE MEMBER first.
INSERT INTO `Membership` (`id`, `groupId`, `userId`, `role`, `status`, `joinedAt`, `createdAt`, `updatedAt`)
SELECT
  SHA2(CONCAT(u.`coupleId`, ':', u.`id`), 224) AS id,   -- deterministic surrogate id
  u.`coupleId`,
  u.`id`,
  'MEMBER',
  'ACTIVE',
  u.`createdAt`,           -- joinedAt = when the user record was created
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
FROM `User` u
WHERE u.`coupleId` IS NOT NULL;

-- Promote the earliest member of each couple to OWNER.
UPDATE `Membership` m
JOIN (
  SELECT x.`coupleId` AS gid, x.`id` AS uid
  FROM `User` x
  WHERE x.`coupleId` IS NOT NULL
    AND x.`id` = (
      SELECT y.`id` FROM `User` y
      WHERE y.`coupleId` = x.`coupleId`
      ORDER BY y.`createdAt` ASC, y.`id` ASC
      LIMIT 1
    )
) owner ON owner.gid = m.`groupId` AND owner.uid = m.`userId`
SET m.`role` = 'OWNER';
```

### 2c. (Alternative backfill via script — preferred for clean cuids)

If you want real `cuid()` ids matching app-created rows, run a one-off script under `prisma/` (not a migration) that:
1. `findMany` users where `coupleId != null`, grouped by `coupleId`, ordered by `createdAt asc`.
2. `createMany` a `Membership` per user (`role = index===0 ? OWNER : MEMBER`, `status=ACTIVE`, `joinedAt = user.createdAt`).
Run it **after** the DDL is applied out-of-band. Keep it idempotent (`skipDuplicates: true`, guarded by `@@unique`).

### 2d. Backfill sanity assertions (run read-only, must all pass before switching reads)

```sql
-- Every coupled user has exactly one membership row.
SELECT COUNT(*) AS orphan_users
FROM `User` u
LEFT JOIN `Membership` m ON m.`userId` = u.`id` AND m.`groupId` = u.`coupleId`
WHERE u.`coupleId` IS NOT NULL AND m.`id` IS NULL;         -- expect 0

-- No membership references a couple the user isn't (still) in.
SELECT COUNT(*) AS mismatched
FROM `Membership` m
JOIN `User` u ON u.`id` = m.`userId`
WHERE m.`status` = 'ACTIVE' AND (u.`coupleId` IS NULL OR u.`coupleId` <> m.`groupId`);  -- expect 0

-- Exactly one OWNER per couple that has members.
SELECT `groupId`, SUM(`role`='OWNER') AS owners
FROM `Membership` WHERE `status`='ACTIVE'
GROUP BY `groupId` HAVING owners <> 1;                     -- expect 0 rows

-- ACTIVE membership count == coupled user count.
SELECT
  (SELECT COUNT(*) FROM `User` WHERE `coupleId` IS NOT NULL) AS users_in_couples,
  (SELECT COUNT(*) FROM `Membership` WHERE `status`='ACTIVE') AS active_memberships;  -- must be equal
```

---

## 3. File-by-file code-change checklist (SWITCH READS)

Establish a single helper first, then repoint each read site to it. **Keep writing `User.coupleId`** everywhere it is written today (dual-write) so Phase 1 stays reversible.

### 3.0 New helper — `src/lib/membership.ts` (new file)
- `getGroupMembers(groupId): Promise<{ id, name, avatar, ... }[]>` — returns users via
  `prisma.membership.findMany({ where: { groupId, status: 'ACTIVE' }, include: { user: true }, orderBy: { joinedAt: 'asc' } })` mapped to `user`.
  **Ordering by `joinedAt asc` must reproduce today's `couple.members` ordering** (see §4) so the remainder-cent allocation in `splits.ts`/`finance.ts` is unchanged.
- Optionally `getMembership(groupId, userId)` for role checks.

### 3.1 `src/lib/splits.ts` — divide by member count, not literal 2
- `calculateSplitAmounts` already divides by `coupleMembers.length` (lines 30–37) — **N-way safe**, keep as is but drop the "couples are always 2" comment.
- **Line 54–55**: the exclusive-items branch hardcodes `/ 2` for the common part:
  ```
  const commonBase = Math.floor(commonTotalCents / 2);
  const commonRemainder = commonTotalCents - (commonBase * 2);
  ```
  Change `2` → `coupleMembers.length` so common items split N-way like the simple branch. **Behavior-preserving today** (length is 2), correct for N>2 later. Update the 50/50 wording in the doc comment.
- Rename param `coupleMembers` → `members` (local rename only; keep signature shape). Optional, cosmetic.

### 3.2 `src/lib/finance.ts` — no logic change
- `calculateBalances` / `getMyDebts` already take a `users[]` array and divide by `users.length` (line 17, 41–43). **No change** — the change is purely in *who* is passed in (now from `Membership`). This is the function whose output the regression gate pins (§4).

### 3.3 `src/app/api/couple/route.ts`
- `GET`: currently `include: { couple: { include: { members: true } } }`. Add a dual read: fetch members via `getGroupMembers(user.coupleId)` and return them; keep `couple` shape for the client.
- `POST` (create couple): after `prisma.couple.create({ ... members: { connect } })`, **also create** the creator's `Membership` (`role: OWNER, status: ACTIVE`). Wrap create+membership in one `$transaction`.

### 3.4 `src/app/api/couple/join/route.ts`
- Inside the existing `$transaction` (lines 33–44): after `tx.user.update({ data: { coupleId } })`, **also** `tx.membership.upsert` / `create` a row (`role: MEMBER, status: ACTIVE, joinedAt: now`).
- The `memberCount >= 2` cap (line 37–38): keep counting from `User.coupleId` for now (source of truth) OR count `ACTIVE` memberships — pick one and keep the cap logic identical in effect. Recommend: keep `tx.user.count({ where: { coupleId } })` in Phase 1 (no behavior change), add membership as a mirror.

### 3.5 `src/app/api/couple/unlink/route.ts`
- Inside the `$transaction` (lines 22–41): when unlinking the user, set their `Membership` to `status: LEFT, leftAt: now` (do **not** hard-delete — preserves history), in addition to `coupleId: null`.
- The couple-teardown branch (`remainingMembers === 0`) deletes splits/expenses/settlements/couple. `Membership` rows are removed automatically by `onDelete: Cascade` on the `Couple` delete — verify and note it; no explicit `deleteMany` needed, but you may add `tx.membership.deleteMany({ where: { groupId }})` before the couple delete for clarity.

### 3.6 `src/app/register/actions.ts`
- Lines 45–55 read `couple.members.length >= 2` to cap; lines 78–91 create the user with `coupleId` in a transaction.
- Add: when the new user is attached to a couple (`coupleId`), create their `Membership` (`role: MEMBER` if the couple already has members, else `OWNER`; status ACTIVE) inside the same transaction. Keep the existing `user.count`/`members.length` cap check unchanged.

### 3.7 `src/app/dashboard/page.tsx`
- Lines 36–52 load `couple.members`; line 111–114 derive `members`, `partner`, `usersMap`; lines 161–182 feed `members` into `calculateBalances`.
- Replace `const members = couple.members;` with `const members = await getGroupMembers(couple.id);` (ACTIVE, ordered by joinedAt). Everything downstream (`partner = members.find(...)`, `usersMap`, `calculateBalances(members, ...)`) is unchanged.
- Onboarding couple-create branch (lines 83–87): add the OWNER `Membership` for the creator, same as §3.3 POST.

### 3.8 `src/app/analytics/page.tsx`
- Lines 24–33 load `couple.members`; line 73 divides `e.amount / (members.length || 1)`; lines 119–120 call `calculateBalances(members, ...)`.
- Replace member source with `getGroupMembers(couple.id)`. No math change (already uses `members.length`).

### 3.9 `src/app/settle/page.tsx`
- Lines 19–34 load `couple.members`; line 50–51 `getMyDebts(members, ...)`; line 86 `calculateSplitAmounts(e.amount, null, members)`; line 102 `partner`.
- Replace member source with `getGroupMembers(couple.id)`. No math change.

### 3.10 `src/app/expenses/list/page.tsx`
- Lines 17–30 load `couple.members`; line 75 iterates `members.forEach(...)`.
- Replace member source with `getGroupMembers(couple.id)`.

### 3.11 `src/app/api/expenses/route.ts`
- GET (lines 24–32): scope guard uses `user.coupleId` — **keep** (source of truth for "does user have a group").
- POST (lines 108–202): `coupleMembers` loaded via `prisma.user.findMany({ where: { coupleId } })` (lines 111–117) and passed to `calculateSplitAmounts` (line 202); `memberIds` set validates split/beneficiary IDOR (lines 117, 172, 189).
  - Replace the `findMany` with `getGroupMembers(user.coupleId)` so members come from `Membership`.
  - `memberIds` / IDOR checks and `coupleId` write (line 155) unchanged.
- Recurring materialization writes `coupleId` (see §3.13) — leave scoping by `coupleId`.

### 3.12 `src/app/budget/page.tsx`
- Uses `include: { couple: true }` and `user.couple?.id` only for scoping (lines 16–38). **No membership read**, no change needed in Phase 1 (budgets are group-scoped by `coupleId`, unaffected).

### 3.13 `src/lib/recurring.ts`
- Materializes by `coupleId` scope (lines 31–32, 111). **No membership read.** Splits for materialized recurring expenses: if it recomputes splits, ensure it uses `getGroupMembers`; otherwise no change. Verify it doesn't hardcode 2.

### 3.14 `prisma/seed.ts`
- Only seeds the admin user, no couple/members. **No change required.** (Optional: if you later seed a demo couple, create matching `Membership` rows.)

### 3.15 `src/app/api/test/seed/route.ts`
- Test scenarios create couples with 2 users via `coupleId` (lines 91–312). For each `prisma.couple.create` + user creates, **add `Membership` rows** (OWNER for first user, MEMBER for second, ACTIVE) so e2e exercises the new read path. This keeps `getGroupMembers` returning the expected 2 members in tests.

### 3.16 Other `couple`/member touch points to eyeball (grep results — most are scoping-only, confirm no `members` read)
- `src/app/api/expenses/[id]/route.ts`, `.../share/route.ts`, `.../tags/route.ts` — scope/ownership by `coupleId`; likely no `members` read. Confirm.
- `src/app/api/settle/route.ts`, `.../[id]/status/route.ts` — settlement `coupleId` scoping. Confirm no member enumeration.
- `src/app/api/tags/*`, `src/app/api/export/route.ts`, `src/app/api/budget/route.ts` — `coupleId` scoping only. No change.
- `src/app/settings/*`, `src/app/tags/*`, `src/app/expense/[id]/*`, `src/app/expenses/new/page.tsx` — confirm they read partner/members from an API that already goes through the switched path.

---

## 4. Regression gate — prove balances are unchanged

The whole risk of "switch reads" is that the member **set** or **ordering** changes, which would shift the deterministic remainder-cent allocation in `calculateBalances`/`calculateSplitAmounts`. Pin it:

### 4a. Ordering invariant
- Today `couple.members` returns users in Prisma's default order for the relation (effectively insertion / PK order). `getGroupMembers` must produce the **same order** for existing couples. Backfill sets `joinedAt = User.createdAt`; order `Membership` by `joinedAt asc, userId asc`. Add a test asserting the resulting id array equals the previous `couple.members` id array for seeded scenarios.

### 4b. Golden snapshot of live balances (before)
Run BEFORE applying the switch (read-only, against a copy/backup of prod data — never mutate):
```bash
# one-off script: for each Couple, load members (old way: user.coupleId),
# SHARED expenses+splits, settlements → calculateBalances → dump JSON keyed by coupleId.
npx tsx scripts/dump-balances.ts > /private/tmp/.../balances-before.json
```

### 4c. Golden snapshot (after switch reads)
Run the identical dump but sourcing members via `getGroupMembers`:
```bash
npx tsx scripts/dump-balances.ts --membership > balances-after.json
diff <(jq -S . balances-before.json) <(jq -S . balances-after.json)   # expect empty
```
**Gate: the diff must be empty.** Any nonzero delta means member set/order drift — stop and fix before merging.

### 4d. Unit test parity
- Add `src/lib/splits.test.ts` case: for a 2-member array, the exclusive-items branch with `/ members.length` produces byte-identical output to the old `/ 2` (regression pin for §3.1).
- Keep existing `finance.test.ts` / `splits.test.ts` green: `npx vitest run src/lib/finance.test.ts src/lib/splits.test.ts`.
- Run full gate: `npx vitest run` and `npm run lint` (both are blocking CI gates).
- e2e: `npm run test:e2e` with the updated test seed (§3.15) to exercise the switched read path end-to-end.

---

## 5. Risks & rollback

### Risks
1. **Member ordering drift** → remainder-cent reallocation → off-by-one-cent balance changes. Mitigation: §4a ordering invariant + §4b/c golden diff.
2. **Missing membership rows** (a coupled user without a Membership) → `getGroupMembers` returns fewer members → wrong `members.length` → wrong splits. Mitigation: §2d assertions (orphan_users = 0) must pass before switching reads.
3. **Duplicate/extra membership rows** → inflated member count. Mitigation: `@@unique([groupId,userId])` + filter `status='ACTIVE'`.
4. **Dual-write divergence** (`coupleId` updated but `Membership` not, or vice-versa) in join/unlink/register. Mitigation: all writes wrapped in the existing `$transaction`; `coupleId` remains source of truth this phase.
5. **`prisma migrate dev` accidentally run** would try to author/apply DDL against the live DB. HARD RULE: never run it; migration is applied out-of-band with a backup. Only `npx prisma generate` is allowed locally.
6. **FK to `Couple`** must be dropped/recreated in Phase 2 when renaming to `Group`; note it so the contract phase plans a rename that preserves the FK.

### Rollback
- **Code**: revert the PR (`git revert <sha>` / drop the branch). Because reads only *switch* to `Membership` while `User.coupleId` is still written, reverting restores the old read path with zero data loss.
- **Schema/data**: `Membership` is purely additive. To undo, `DROP TABLE Membership;` and drop the two enums (or, since MariaDB enums are inline column types, dropping the table is sufficient). No existing table/column was modified, so no data is at risk.
- **DB**: the migration is applied out-of-band **with a backup**; if the backfill assertions (§2d) or the balance diff (§4c) fail, restore from that backup and do not switch reads.
- **Order of rollback**: revert code first (stops reading Membership), then optionally drop the table. The app returns to Phase 0 behavior immediately after the code revert.

---

## 6. Definition of done (Phase 1)
- [ ] `Membership` + enums + back-relations added to schema; `npx prisma generate` clean.
- [ ] Migration SQL authored (not applied by us) and reviewed.
- [ ] Backfill script/SQL authored; §2d assertions all pass on a data copy.
- [ ] `src/lib/membership.ts` helper added; all §3 read sites switched; `coupleId` still dual-written.
- [ ] `splits.ts` line 54 uses `members.length` (behavior-identical for N=2).
- [ ] Balance golden diff (§4c) empty; `npx vitest run` + `npm run lint` + `npm run test:e2e` green.
- [ ] `User.coupleId` and `Couple` **untouched/kept** (rename + drop deferred to Phase 2 CONTRACT).
