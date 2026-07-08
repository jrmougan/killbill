/**
 * Phase 2b — seed the 8 system categories and backfill Expense/Budget.categoryId.
 *
 * Idempotent: system rows are matched by (groupId = null, key) and created only
 * if missing; backfill only touches rows whose categoryId is still NULL.
 *
 * Metadata mirrors src/lib/categories.ts (kept in sync by hand). `icon` is the
 * lucide-react component NAME (categories.ts stores the component itself).
 *
 * Run:  npx tsx scripts/seed-categories-and-backfill.ts
 */
import { prisma } from '../src/lib/db';

const SYSTEM_CATEGORIES = [
  { key: 'shopping',      label: 'Compras',    labelEn: 'shopping',      emoji: '🛍️', icon: 'ShoppingBag',  color: 'text-pink-400',   bgColor: 'bg-pink-400/20',   hex: '#f472b6' },
  { key: 'food',          label: 'Comida',     labelEn: 'food',          emoji: '🍕', icon: 'Coffee',       color: 'text-orange-400', bgColor: 'bg-orange-400/20', hex: '#fb923c' },
  { key: 'rent',          label: 'Alquiler',   labelEn: 'rent',          emoji: '🏠', icon: 'Home',         color: 'text-blue-400',   bgColor: 'bg-blue-400/20',   hex: '#60a5fa' },
  { key: 'utilities',     label: 'Recibos',    labelEn: 'utilities',     emoji: '💡', icon: 'Lightbulb',    color: 'text-yellow-400', bgColor: 'bg-yellow-400/20', hex: '#facc15' },
  { key: 'transport',     label: 'Transporte', labelEn: 'transport',     emoji: '🚗', icon: 'TramFront',    color: 'text-green-400',  bgColor: 'bg-green-400/20',  hex: '#4ade80' },
  { key: 'entertainment', label: 'Ocio',       labelEn: 'entertainment', emoji: '🎬', icon: 'Clapperboard', color: 'text-purple-400', bgColor: 'bg-purple-400/20', hex: '#c084fc' },
  { key: 'health',        label: 'Salud',      labelEn: 'health',        emoji: '💊', icon: 'Heart',        color: 'text-red-400',    bgColor: 'bg-red-400/20',    hex: '#f87171' },
  { key: 'other',         label: 'Otro',       labelEn: 'other',         emoji: '📦', icon: 'Receipt',      color: 'text-gray-400',   bgColor: 'bg-gray-400/20',   hex: '#9ca3af' },
] as const;

async function main() {
  let seeded = 0;
  let expensesLinked = 0;
  let budgetsLinked = 0;

  for (let i = 0; i < SYSTEM_CATEGORIES.length; i++) {
    const c = SYSTEM_CATEGORIES[i];

    // MySQL does not enforce a UNIQUE index across NULLs, so guard by hand.
    let category = await prisma.category.findFirst({ where: { groupId: null, key: c.key } });
    if (!category) {
      category = await prisma.category.create({
        data: { ...c, sortOrder: i, isSystem: true, groupId: null },
      });
      seeded++;
    }

    // Backfill FKs from the enum value (system categories are global).
    const e = await prisma.expense.updateMany({
      where: { category: c.key as never, categoryId: null },
      data: { categoryId: category.id },
    });
    const b = await prisma.budget.updateMany({
      where: { category: c.key as never, categoryId: null },
      data: { categoryId: category.id },
    });
    expensesLinked += e.count;
    budgetsLinked += b.count;
  }

  console.log(`Seeded ${seeded} system categories; linked ${expensesLinked} expenses, ${budgetsLinked} budgets.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed/backfill failed:', err);
    process.exit(1);
  });
