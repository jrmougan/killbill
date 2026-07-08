/**
 * Phase 3 precondition — repair legacy SHARED expenses whose splits sum to ±cents
 * off the total (rounding bugs predating the POST `splitsTotal === amount` check).
 *
 * For each such expense, adjust ONE split by the exact diff so Σsplits === amount.
 * The adjusted split is the FIRST group member's (getGroupMembers order — the same
 * member that receives remainder cents everywhere else in the app), falling back to
 * the first split row if that member has no split. Prints the per-expense change and
 * the resulting per-member balance delta so the effect on displayed balances is
 * explicit.
 *
 * Idempotent: only touches expenses where Σsplits !== amount.
 *
 * Run:  npx tsx scripts/repair-split-rounding.ts
 */
import { prisma } from '../src/lib/db';
import { getGroupMembers } from '../src/lib/membership';
import { calculateBalances } from '../src/lib/finance';

async function balancesFor(coupleId: string) {
  const members = await getGroupMembers(coupleId);
  const expenses = await prisma.expense.findMany({
    where: { coupleId, visibility: 'SHARED' },
    include: { splits: true },
  });
  const settlements = await prisma.settlement.findMany({ where: { coupleId, status: 'CONFIRMED' } });
  return {
    members,
    balances: calculateBalances(
      members,
      expenses.map((e) => ({ paidById: e.paidById, amount: e.amount, splits: e.splits.map((s) => ({ userId: s.userId, amount: s.amount })) })),
      settlements.map((s) => ({ fromUserId: s.fromUserId, toUserId: s.toUserId, amount: s.amount })),
      members[0]?.id ?? '',
    ),
  };
}

async function main() {
  const couples = await prisma.couple.findMany({ select: { id: true } });

  for (const couple of couples) {
    const expenses = await prisma.expense.findMany({
      where: { coupleId: couple.id, visibility: 'SHARED' },
      include: { splits: true },
    });
    const bad = expenses.filter((e) => e.splits.reduce((a, s) => a + s.amount, 0) !== e.amount);
    if (bad.length === 0) continue;

    const members = await getGroupMembers(couple.id);
    const before = (await balancesFor(couple.id)).balances;

    console.log(`\nGroup ${couple.id}: repairing ${bad.length} expenses`);
    for (const e of bad) {
      const ssum = e.splits.reduce((a, s) => a + s.amount, 0);
      const diff = e.amount - ssum; // +1 => add a cent, -1 => remove a cent
      const target =
        e.splits.find((s) => s.userId === members[0]?.id) ?? e.splits[0];
      if (!target) {
        console.warn(`  ${e.id} "${e.description}" has no splits; skipping`);
        continue;
      }
      const newAmount = target.amount + diff;
      await prisma.split.update({ where: { id: target.id }, data: { amount: newAmount } });
      console.log(`  ${e.id} "${e.description}" amount=${e.amount} Σ=${ssum} diff=${diff} → split[${target.userId}] ${target.amount}→${newAmount}`);
    }

    const after = (await balancesFor(couple.id)).balances;
    console.log(`  Balance delta (cents):`);
    for (const m of members) {
      const d = (after[m.id] ?? 0) - (before[m.id] ?? 0);
      console.log(`    ${m.id}: ${before[m.id] ?? 0} → ${after[m.id] ?? 0} (Δ ${d >= 0 ? '+' : ''}${d})`);
    }
  }

  console.log('\nRepair complete.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Repair failed:', err);
    process.exit(1);
  });
