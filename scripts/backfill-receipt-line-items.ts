/**
 * Phase 2c backfill — materialize ReceiptLineItem rows from Expense.receiptData.
 *
 * Idempotent: skips any expense that already has line items. Converts the legacy
 * euro floats to integer cents. An `assignedTo` that doesn't match a real user is
 * stored as null (the FK would otherwise reject it).
 *
 * Run:  npx tsx scripts/backfill-receipt-line-items.ts
 */
import { prisma } from '../src/lib/db';
import { Prisma } from '../src/generated/prisma/client';

type LegacyItem = {
  description?: string;
  quantity?: number;
  price?: number;
  total?: number;
  assignedTo?: string | null;
};

const toCents = (euros: number) => Math.round(euros * 100);

async function main() {
  const userIds = new Set((await prisma.user.findMany({ select: { id: true } })).map((u) => u.id));

  const expenses = await prisma.expense.findMany({
    where: { receiptData: { not: Prisma.JsonNull } },
    select: { id: true, receiptData: true },
  });

  let expensesProcessed = 0;
  let linesCreated = 0;
  let skippedExisting = 0;

  for (const e of expenses) {
    const data = e.receiptData;
    if (!Array.isArray(data) || data.length === 0) continue;

    const existing = await prisma.receiptLineItem.count({ where: { expenseId: e.id } });
    if (existing > 0) {
      skippedExisting++;
      continue;
    }

    const rows = (data as LegacyItem[]).map((item, i) => {
      const price = typeof item.price === 'number' ? item.price : (item.total ?? 0);
      const total = typeof item.total === 'number' ? item.total : (item.price ?? 0);
      const assignedTo = item.assignedTo && userIds.has(item.assignedTo) ? item.assignedTo : null;
      return {
        expenseId: e.id,
        description: (item.description ?? '').toString().slice(0, 191),
        quantity: typeof item.quantity === 'number' ? item.quantity : 1,
        unitPrice: toCents(price),
        lineTotal: toCents(total),
        position: i,
        assignedToId: assignedTo,
      };
    });

    await prisma.receiptLineItem.createMany({ data: rows });
    expensesProcessed++;
    linesCreated += rows.length;
  }

  console.log(
    `Backfill complete: ${linesCreated} line items across ${expensesProcessed} expenses ` +
    `(${skippedExisting} already had line items, scanned ${expenses.length}).`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
