---
name: money-change
description: Change balance, split, ledger or settlement behaviour safely. Use before touching src/lib/finance.ts, splits.ts, ledger.ts, ledger-read.ts, settlement code or anything that computes or posts money.
---

# Money change

For cents, locking and error codes, follow `AGENTS.md`. This covers only what it does not.

An expense is payer + total + `Split` rows, one per user (`SplitStrategy`: `EQUAL`, `CUSTOM`, `EXCLUSIVE`, `ITEMIZED`); settlements zero out debts between specific users. `finance.ts` holds the balance and settlement math, `splits.ts` the split distributions, `expense-tx.ts` the space lock and ledger transactions.

1. **Rounding**: remainder cents go to the first members by index. Shares sum exactly to the amount and are never negative (`chk_split_amount_nonneg`, pinned by `src/lib/splits.check-constraints.test.ts`). Zero is legitimate.
2. **Parity**: `calculateBalances` (`finance.ts`: amount paid − fair share of splits ± settlements) and the ledger sums must stay equal, so change `finance.ts` and `computeExpenseEntries` (`ledger.ts`) together. `scripts/backfill-ledger.ts` reuses the latter. Every transaction stays zero-sum, including for departed members.
3. **Failing test first**, in `finance.test.ts`, `splits*.test.ts`, `ledger*.test.ts` or `financial-invariants.test.ts`. Cover 1 cent, an odd total, N>2, a departed member and a promotion line.
4. **Verify**. The e2e commands wipe the database in `.env` (`docs/agents/testing.md`):

   ```bash
   mise run check
   mise run e2e -- e2e/api/concurrency.api.spec.ts --project=api
   mise run e2e -- e2e/settlements
   mise exec -- node --env-file=.env --import tsx scripts/reconcile-ledger.ts
   ```

   `reconcile-ledger.ts` is read-only and exits non-zero on a mismatch. It and `src/lib/db.ts` do not load `.env` themselves, hence the flag. That form has not been run yet; verify it on first use.
