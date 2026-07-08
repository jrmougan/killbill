/**
 * Phase 2a backfill — infer Expense.splitStrategy for pre-existing rows.
 *
 * Best-effort and idempotent: only touches SHARED expenses whose splitStrategy
 * is still NULL. PERSONAL expenses have no splits and are left NULL by design.
 *
 * Inference (from the persisted splits + receiptData):
 *   ITEMIZED  — receiptData has any line item with an `assignedTo`
 *   EXCLUSIVE — exactly one split row whose amount == the expense total
 *   EQUAL     — split amounts match an even integer division of the total
 *   CUSTOM    — anything else (explicit amounts that aren't an even split)
 *
 * Run:  npx tsx scripts/backfill-split-strategy.ts
 */
import { prisma } from '../src/lib/db';
import { hasExclusiveReceiptItems } from '../src/lib/splits';

/** True if `amounts` equals the deterministic even division of `total` among them. */
function isEqualDivision(total: number, amounts: number[]): boolean {
  const n = amounts.length;
  if (n === 0) return false;
  const base = Math.floor(total / n);
  const remainder = total - base * n;
  // Even division assigns +1 cent to the first `remainder` members. Order isn't
  // guaranteed here, so compare as multisets: `remainder` values of base+1, rest base.
  const expected = Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0));
  const a = [...amounts].sort((x, y) => x - y);
  const b = expected.sort((x, y) => x - y);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

async function main() {
  const expenses = await prisma.expense.findMany({
    where: { visibility: 'SHARED', splitStrategy: null },
    include: { splits: true },
  });

  const counts: Record<string, number> = { EQUAL: 0, CUSTOM: 0, EXCLUSIVE: 0, ITEMIZED: 0, SKIPPED: 0 };

  for (const e of expenses) {
    let strategy: 'EQUAL' | 'CUSTOM' | 'EXCLUSIVE' | 'ITEMIZED' | null = null;

    if (hasExclusiveReceiptItems(e.receiptData)) {
      strategy = 'ITEMIZED';
    } else if (e.splits.length === 1 && e.splits[0].amount === e.amount) {
      strategy = 'EXCLUSIVE';
    } else if (e.splits.length > 0) {
      const amounts = e.splits.map((s) => s.amount);
      strategy = isEqualDivision(e.amount, amounts) ? 'EQUAL' : 'CUSTOM';
    }

    if (!strategy) {
      counts.SKIPPED++;
      continue;
    }

    await prisma.expense.update({ where: { id: e.id }, data: { splitStrategy: strategy } });
    counts[strategy]++;
  }

  console.log('Backfill complete:', counts, `(scanned ${expenses.length})`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
