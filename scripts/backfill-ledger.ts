/**
 * Phase 3 backfill — post the double-entry ledger from existing domain rows.
 *
 * For every Couple (group):
 *   - upsert an Account per referenced user,
 *   - post ONE EXPENSE transaction per SHARED expense (delta[m] = paid[m] - share[m]),
 *   - post ONE SETTLEMENT transaction per CONFIRMED settlement (from +amount, to -amount).
 *
 * The per-member deltas are computed with the SAME algorithm and SAME member
 * ordering (getGroupMembers: ACTIVE, joinedAt asc then userId asc) that
 * finance.ts.calculateBalances uses, so the ledger reproduces the balances
 * bit-for-bit (integer cents). See scripts/reconcile-ledger.ts for the gate.
 *
 * IDEMPOTENT: identity is the source-derived UNIQUE dedupeKey
 *   'expense:<id>' | 'settlement:<id>:confirm'
 * and UNIQUE(groupId,userId) on Account. Each source's transaction is rebuilt
 * (delete its entries + recreate) inside one prisma.$transaction, so re-running
 * self-heals instead of double-posting.
 *
 * Run OUT OF BAND by the operator AFTER the migration is applied and AFTER the
 * Phase 1 membership backfill (getGroupMembers must be populated). Read-only
 * finance.ts is untouched; safe to re-run.
 *
 * Run:  npx tsx scripts/backfill-ledger.ts
 */
import { prisma } from '../src/lib/db';
import { getGroupMembers } from '../src/lib/membership';
// Single source of the entry math — shared with the dual-write path so backfill
// and runtime can never drift from finance.ts.
import { computeExpenseEntries } from '../src/lib/ledger';

type Entry = { userId: string; amount: number };

/** Upsert an Account for (groupId,userId); return its id. */
async function ensureAccount(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  groupId: string,
  userId: string,
): Promise<string> {
  const account = await tx.account.upsert({
    where: { groupId_userId: { groupId, userId } },
    create: { groupId, userId },
    update: {},
  });
  return account.id;
}

/** Create (or rebuild) one transaction + its entries, keyed on dedupeKey. */
async function postTransaction(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  args: {
    groupId: string;
    kind: 'EXPENSE' | 'SETTLEMENT';
    dedupeKey: string;
    amount: number;
    postedAt: Date;
    expenseId?: string;
    settlementId?: string;
    entries: Entry[];
  },
): Promise<void> {
  const txn = await tx.ledgerTransaction.upsert({
    where: { dedupeKey: args.dedupeKey },
    create: {
      groupId: args.groupId,
      kind: args.kind,
      dedupeKey: args.dedupeKey,
      amount: args.amount,
      postedAt: args.postedAt,
      expenseId: args.expenseId ?? null,
      settlementId: args.settlementId ?? null,
    },
    update: { amount: args.amount, postedAt: args.postedAt },
  });

  // Rebuild entries so a re-run self-heals (idempotent).
  await tx.ledgerEntry.deleteMany({ where: { transactionId: txn.id } });

  for (const e of args.entries) {
    const accountId = await ensureAccount(tx, args.groupId, e.userId);
    await tx.ledgerEntry.create({
      data: { transactionId: txn.id, accountId, amount: e.amount },
    });
  }
}

async function main() {
  const couples = await prisma.couple.findMany({ select: { id: true } });

  let expenseTxns = 0;
  let settlementTxns = 0;
  let skippedNonZero = 0;

  for (const couple of couples) {
    const members = await getGroupMembers(couple.id);

    // Pre-create an Account per ACTIVE member for cleanliness (departed users get
    // theirs lazily when an entry references them).
    for (const m of members) {
      await prisma.account.upsert({
        where: { groupId_userId: { groupId: couple.id, userId: m.id } },
        create: { groupId: couple.id, userId: m.id },
        update: {},
      });
    }

    // ---- SHARED expenses -> EXPENSE transactions ----
    const expenses = await prisma.expense.findMany({
      where: { coupleId: couple.id, visibility: 'SHARED' },
      include: { splits: true },
    });

    for (const e of expenses) {
      const entries = computeExpenseEntries(
        { amount: e.amount, paidById: e.paidById, splits: e.splits },
        members,
      );
      // Defensive: a balanced expense sums to 0. If splits don't sum to amount
      // (bad data) the tx would not be zero-sum — skip + report rather than post
      // garbage (this expense already breaks Σ calculateBalances).
      const sum = entries.reduce((a, x) => a + x.amount, 0);
      if (sum !== 0) {
        skippedNonZero++;
        console.warn(`  SKIP non-zero-sum expense ${e.id} (Σdelta=${sum}); fix splits out of band.`);
        continue;
      }
      await prisma.$transaction((tx) =>
        postTransaction(tx, {
          groupId: couple.id,
          kind: 'EXPENSE',
          dedupeKey: `expense:${e.id}`,
          amount: e.amount,
          postedAt: e.date,
          expenseId: e.id,
          entries,
        }),
      );
      expenseTxns++;
    }

    // ---- CONFIRMED settlements -> SETTLEMENT transactions ----
    const settlements = await prisma.settlement.findMany({
      where: { coupleId: couple.id, status: 'CONFIRMED' },
    });

    for (const s of settlements) {
      // A 0-amount checkpoint settlement (or a self-settlement) moves no balance
      // — finance.ts nets it to 0 — so it posts nothing.
      if (s.amount === 0 || s.fromUserId === s.toUserId) continue;
      await prisma.$transaction((tx) =>
        postTransaction(tx, {
          groupId: couple.id,
          kind: 'SETTLEMENT',
          dedupeKey: `settlement:${s.id}:confirm`,
          amount: s.amount,
          postedAt: s.date,
          settlementId: s.id,
          entries: [
            { userId: s.fromUserId, amount: s.amount },
            { userId: s.toUserId, amount: -s.amount },
          ],
        }),
      );
      settlementTxns++;
    }
  }

  console.log(
    `Backfill complete: ${expenseTxns} EXPENSE + ${settlementTxns} SETTLEMENT transactions ` +
    `across ${couples.length} groups (${skippedNonZero} non-zero-sum expenses skipped).`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
