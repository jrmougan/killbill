/**
 * Phase 3 reconciliation — the operator's CORRECTNESS GATE. READ-ONLY.
 *
 * For every Couple (group) it recomputes finance.ts.calculateBalances from the
 * SAME inputs the dashboard uses (members via getGroupMembers, SHARED expenses +
 * their splits, CONFIRMED settlements) and compares, per ACTIVE member, to the
 * SUM of that member's posted ledger entries. Exact integer-cent equality — no
 * tolerance, no floats.
 *
 * THE INVARIANT (must hold for every group g and every active member m):
 *     Σ LedgerEntry.amount over m's Account in g  ===  calculateBalances(g)[m]
 * plus every LedgerTransaction's entries sum to 0.
 *
 * Reconciliation is over ACTIVE members only, because that is exactly the set
 * finance.ts computes over. Departed payers/split-holders keep their Account so
 * each transaction stays strictly zero-sum, but their balance is intentionally
 * outside the gate (finance.ts drops non-members).
 *
 * Exits non-zero on any mismatch. Must be GREEN before any future read-switch.
 *
 * Run:  npx tsx scripts/reconcile-ledger.ts
 */
import { prisma } from '../src/lib/db';
import { getGroupMembers } from '../src/lib/membership';
import { calculateBalances } from '../src/lib/finance';

async function main() {
  const couples = await prisma.couple.findMany({ select: { id: true } });

  let groupsChecked = 0;
  let memberMismatches = 0;
  let txnImbalances = 0;

  for (const couple of couples) {
    const members = await getGroupMembers(couple.id);
    if (members.length === 0) continue;
    groupsChecked++;

    const expenses = await prisma.expense.findMany({
      where: { coupleId: couple.id, visibility: 'SHARED' },
      include: { splits: true },
    });
    const settlements = await prisma.settlement.findMany({
      where: { coupleId: couple.id, status: 'CONFIRMED' },
    });

    // Source of truth — identical inputs to dashboard/page.tsx.
    const expected = calculateBalances(
      members,
      expenses.map((e) => ({
        paidById: e.paidById,
        amount: e.amount,
        splits: e.splits.map((s) => ({ userId: s.userId, amount: s.amount })),
      })),
      settlements.map((s) => ({
        fromUserId: s.fromUserId,
        toUserId: s.toUserId,
        amount: s.amount,
      })),
      members[0].id,
    );

    // Ledger balance per member: Σ entries over that member's Account in g.
    const accounts = await prisma.account.findMany({
      where: { groupId: couple.id },
      include: { entries: { select: { amount: true } } },
    });
    const ledger = new Map<string, number>();
    for (const a of accounts) {
      ledger.set(a.userId, a.entries.reduce((sum, e) => sum + e.amount, 0));
    }

    // GATE A — per active member, exact equality (both directions covered by
    // iterating the members set; ledger defaults to 0 when no account/entries).
    for (const m of members) {
      const exp = expected[m.id] ?? 0;
      const led = ledger.get(m.id) ?? 0;
      if (exp !== led) {
        memberMismatches++;
        console.error(
          `MISMATCH group=${couple.id} user=${m.id} finance=${exp} ledger=${led} diff=${led - exp}`,
        );
      }
    }

    // GATE B — every transaction's entries sum to 0 (double-entry invariant).
    const txns = await prisma.ledgerTransaction.findMany({
      where: { groupId: couple.id },
      include: { entries: { select: { amount: true } } },
    });
    for (const t of txns) {
      const s = t.entries.reduce((sum, e) => sum + e.amount, 0);
      if (s !== 0) {
        txnImbalances++;
        console.error(`IMBALANCED txn=${t.id} dedupeKey=${t.dedupeKey} Σentries=${s}`);
      }
    }
  }

  const ok = memberMismatches === 0 && txnImbalances === 0;
  console.log(
    `Reconcile ${ok ? 'PASS' : 'FAIL'}: ${groupsChecked} groups checked, ` +
    `${memberMismatches} member mismatches, ${txnImbalances} imbalanced transactions.`,
  );
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('Reconcile failed:', err);
  process.exit(1);
});
