/**
 * Phase 2e backfill — derive Budget.periodStart/periodEnd from the legacy `month`.
 *
 * Idempotent: only touches rows whose periodStart is still NULL. For each budget
 * periodStart = month (first day of the month) and periodEnd = first day of the
 * following month, forming a half-open [periodStart, periodEnd) range.
 *
 * `month` is stored as a DATETIME at local midnight (see src/app/api/budget/route.ts,
 * which builds it with `new Date(year, mon - 1, 1)`). We reuse the same local-time
 * convention here so the derived range lines up exactly with the existing column.
 * periodType is left at its column default ('MONTH').
 *
 * Run:  npx tsx scripts/backfill-budget-periods.ts
 */
import { prisma } from '../src/lib/db';

/** First day of the month after `month`, at local midnight (matches route.ts). */
function nextMonthStart(month: Date): Date {
  return new Date(month.getFullYear(), month.getMonth() + 1, 1);
}

async function main() {
  const budgets = await prisma.budget.findMany({
    where: { periodStart: null },
    select: { id: true, month: true },
  });

  let updated = 0;

  for (const b of budgets) {
    const periodStart = b.month;
    const periodEnd = nextMonthStart(b.month);
    await prisma.budget.update({
      where: { id: b.id },
      data: { periodStart, periodEnd },
    });
    updated++;
  }

  console.log(`Backfill complete: ${updated} budgets updated (scanned ${budgets.length}).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
