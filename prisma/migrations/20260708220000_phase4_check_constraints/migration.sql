-- Phase 4: named CHECK constraints on money columns. REVERSIBLE (see rollback
-- at the bottom). Additive: no data is modified; both engines validate existing
-- rows with a table scan at ADD time (trivial at current data volume), so the
-- operator MUST run scripts/validate-check-constraints.ts (read-only, exits
-- non-zero on any violating row) BEFORE applying.
--
-- Engine compatibility (prod = MariaDB behind Coolify, dev container = mysql:latest):
--   * `ALTER TABLE .. ADD CONSTRAINT <name> CHECK (..)` is valid and ENFORCED on
--     MySQL >= 8.0.16 and MariaDB >= 10.2.1. (MySQL < 8.0.16 and MariaDB < 10.2.1
--     silently ignore CHECK — verify server version before relying on enforcement.)
--   * Prisma does not model CHECK constraints in schema.prisma and ignores them
--     in drift detection, so NO schema.prisma change accompanies this migration.
--
-- Constraint rationale (verified against write paths on 2026-07-08):
--   * Expense.amount > 0      — POST /api/expenses and PATCH /api/expenses/[id]
--                               both 400 on amountCents <= 0; recurring
--                               materialization copies a validated template.
--   * Settlement.amount >= 0  — POST /api/settle explicitly ALLOWS 0 ("checkpoint"
--                               settlements that archive the pending list) and
--                               rejects negatives; PATCH /api/settle/[id] rejects <= 0.
--                               Hence >= 0, NOT > 0.
--   * Budget.amount > 0       — POST /api/budget 400s on amountCents <= 0.
--   * minorUnit >= 0          — never written by application code on any of the
--                               three tables; always the Prisma default (2).
--
-- DELIBERATELY OMITTED — Split.amount:
--   Zero splits are legitimate (custom splits validate `< 0` only, and an EQUAL
--   split of a 1-cent expense yields a 0 split for the second member). Negative
--   splits are REACHABLE through a live write path: calculateSplitAmounts's
--   ITEMIZED diff-adjust (src/lib/splits.ts:86, `splits[0].amount += diff`) can
--   drive splits[0] negative when the entered total is far below the receipt
--   items' sum, and none of its three call sites (POST /api/expenses,
--   PATCH /api/expenses/[id], POST /api/expenses/[id]/share) guard the result.
--   A CHECK here would turn that currently-succeeding write into a 500. Add a
--   `Split.amount >= 0` CHECK only AFTER clamping/validating that path in code.
--
-- DEFERRED (blocked on membership semantics): visibility/coupleId XOR checks.

ALTER TABLE `Expense`
  ADD CONSTRAINT `chk_expense_amount_positive` CHECK (`amount` > 0);

ALTER TABLE `Expense`
  ADD CONSTRAINT `chk_expense_minorunit_nonneg` CHECK (`minorUnit` >= 0);

ALTER TABLE `Settlement`
  ADD CONSTRAINT `chk_settlement_amount_nonneg` CHECK (`amount` >= 0);

ALTER TABLE `Settlement`
  ADD CONSTRAINT `chk_settlement_minorunit_nonneg` CHECK (`minorUnit` >= 0);

ALTER TABLE `Budget`
  ADD CONSTRAINT `chk_budget_amount_positive` CHECK (`amount` > 0);

ALTER TABLE `Budget`
  ADD CONSTRAINT `chk_budget_minorunit_nonneg` CHECK (`minorUnit` >= 0);

-- ---------------------------------------------------------------------------
-- ROLLBACK (do not execute here — run manually to revert). Portable form,
-- valid on MariaDB >= 10.2 and MySQL >= 8.0.19:
--
--   ALTER TABLE `Expense`    DROP CONSTRAINT `chk_expense_amount_positive`;
--   ALTER TABLE `Expense`    DROP CONSTRAINT `chk_expense_minorunit_nonneg`;
--   ALTER TABLE `Settlement` DROP CONSTRAINT `chk_settlement_amount_nonneg`;
--   ALTER TABLE `Settlement` DROP CONSTRAINT `chk_settlement_minorunit_nonneg`;
--   ALTER TABLE `Budget`     DROP CONSTRAINT `chk_budget_amount_positive`;
--   ALTER TABLE `Budget`     DROP CONSTRAINT `chk_budget_minorunit_nonneg`;
--
-- On MySQL 8.0.16–8.0.18 only (no DROP CONSTRAINT), use the CHECK-specific form:
--
--   ALTER TABLE `Expense`    DROP CHECK `chk_expense_amount_positive`;
--   (etc., same constraint names)
-- ---------------------------------------------------------------------------
