/**
 * Phase 2d backfill — create one RecurringSeries per existing recurring TEMPLATE
 * expense (isRecurring=true) and link the template back via Expense.seriesId.
 *
 * Idempotent: only touches recurring templates whose seriesId is still NULL, so
 * re-running never creates duplicate series. A template missing recurringInterval
 * or nextRecurringDate can't form a valid rule (both are NOT NULL on the series)
 * and is skipped.
 *
 * NOTE ON INSTANCES: already-materialized instances (isRecurring=false, created by
 * src/lib/recurring.ts as field-for-field copies of their template) carry NO
 * durable link back to the template — they only share description/amount/etc, which
 * is not a reliable key (two templates could coincide, and edits drift the copy).
 * We therefore link ONLY templates here. Instances materialized from now on get
 * their seriesId set at creation time (dual-write in src/lib/recurring.ts).
 *
 * Run:  npx tsx scripts/backfill-recurring-series.ts
 */
import { prisma } from '../src/lib/db';

async function main() {
  const templates = await prisma.expense.findMany({
    where: { isRecurring: true, seriesId: null },
  });

  let created = 0;
  let skipped = 0;

  for (const e of templates) {
    // Both are NOT NULL on RecurringSeries; a template lacking either can't form
    // a valid rule, so leave it untouched (stays a legacy recurring Expense).
    if (!e.recurringInterval || !e.nextRecurringDate) {
      skipped++;
      continue;
    }

    await prisma.$transaction(async (tx) => {
      const series = await tx.recurringSeries.create({
        data: {
          description: e.description,
          amount: e.amount,
          category: e.category,
          categoryId: e.categoryId,
          visibility: e.visibility,
          splitStrategy: e.splitStrategy,
          notes: e.notes,
          interval: e.recurringInterval!,
          nextRunDate: e.nextRecurringDate!,
          isActive: true, // series-driven materializer only picks active series (Phase 4 recurring-sync)
          coupleId: e.coupleId,
          ownerId: e.ownerId,
          paidById: e.paidById,
          currency: e.currency,
          minorUnit: e.minorUnit,
          templateId: e.id, // Phase 5 (stop-dual-write): durable template pointer
        },
      });

      await tx.expense.update({
        where: { id: e.id },
        data: { seriesId: series.id },
      });
    });

    created++;
  }

  console.log(
    `Backfill complete: created ${created} RecurringSeries and linked their templates ` +
    `(${skipped} recurring templates skipped for missing interval/nextRecurringDate, ` +
    `scanned ${templates.length}).`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
