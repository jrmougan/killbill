import type { Prisma } from '@/generated/prisma/client';

type Member = { id: string };
type Split = { userId: string; amount: number };
type Entry = { userId: string; amount: number };
type Tx = Prisma.TransactionClient;

/**
 * Net per-member deltas for a SHARED expense — the EXACT finance.ts math.
 * paid[m] = amount if m is the payer else 0; share[m] = the member's Split.amount
 * when splits exist, else equal division with the remainder cent(s) given to the
 * FIRST members by `members` index. delta[m] = paid[m] - share[m].
 *
 * Referenced users = members ∪ payer ∪ split users, so a payer or split-holder who
 * has since LEFT still gets an entry and the transaction stays strictly zero-sum
 * (Σ delta = amount - Σ share = 0). Zero deltas are dropped.
 *
 * This is the single source of the entry math — reused by scripts/backfill-ledger.ts
 * so shares can never drift from finance.ts.
 */
export function computeExpenseEntries(
  expense: { amount: number; paidById: string; splits: Split[] },
  members: Member[],
): Entry[] {
  const n = members.length || 1;
  const share = new Map<string, number>();
  if (expense.splits.length > 0) {
    for (const s of expense.splits) share.set(s.userId, (share.get(s.userId) ?? 0) + s.amount);
  } else {
    const base = Math.floor(expense.amount / n);
    const remainder = expense.amount - base * n;
    members.forEach((m, i) => share.set(m.id, base + (i < remainder ? 1 : 0)));
  }
  const userIds = new Set<string>([...members.map((m) => m.id), expense.paidById, ...expense.splits.map((s) => s.userId)]);
  const entries: Entry[] = [];
  for (const uid of userIds) {
    const paid = uid === expense.paidById ? expense.amount : 0;
    const delta = paid - (share.get(uid) ?? 0);
    if (delta !== 0) entries.push({ userId: uid, amount: delta });
  }
  return entries;
}

async function ensureAccount(tx: Tx, groupId: string, userId: string): Promise<string> {
  const a = await tx.account.upsert({ where: { groupId_userId: { groupId, userId } }, create: { groupId, userId }, update: {} });
  return a.id;
}

async function postTransaction(tx: Tx, args: { groupId: string; kind: 'EXPENSE' | 'SETTLEMENT'; dedupeKey: string; amount: number; postedAt: Date; expenseId?: string; settlementId?: string; entries: Entry[] }): Promise<void> {
  const sum = args.entries.reduce((s, e) => s + e.amount, 0);
  if (sum !== 0) throw new Error(`Refusing to post non-zero-sum ledger txn ${args.dedupeKey} (Σ=${sum})`);
  const txn = await tx.ledgerTransaction.upsert({
    where: { dedupeKey: args.dedupeKey },
    create: { groupId: args.groupId, kind: args.kind, dedupeKey: args.dedupeKey, amount: args.amount, postedAt: args.postedAt, expenseId: args.expenseId ?? null, settlementId: args.settlementId ?? null },
    update: { amount: args.amount, postedAt: args.postedAt },
  });
  // Rebuild entries so a re-run self-heals (idempotent).
  await tx.ledgerEntry.deleteMany({ where: { transactionId: txn.id } });
  for (const e of args.entries) {
    const accountId = await ensureAccount(tx, args.groupId, e.userId);
    await tx.ledgerEntry.create({ data: { transactionId: txn.id, accountId, amount: e.amount } });
  }
}

/** Post/rebuild the EXPENSE transaction for a SHARED expense. Caller guards PERSONAL. */
export async function postExpenseLedger(tx: Tx, e: { expenseId: string; groupId: string; amount: number; paidById: string; occurredAt: Date; splits: Split[]; members: Member[] }): Promise<void> {
  const entries = computeExpenseEntries({ amount: e.amount, paidById: e.paidById, splits: e.splits }, e.members);
  await postTransaction(tx, { groupId: e.groupId, kind: 'EXPENSE', dedupeKey: `expense:${e.expenseId}`, amount: e.amount, postedAt: e.occurredAt, expenseId: e.expenseId, entries });
}

/** Post the SETTLEMENT transaction for a CONFIRMED settlement. Skips 0-amount / self-settlements. */
export async function postSettlementLedger(tx: Tx, s: { id: string; coupleId: string; amount: number; fromUserId: string; toUserId: string; date: Date }): Promise<void> {
  if (s.amount === 0 || s.fromUserId === s.toUserId) return;
  await postTransaction(tx, { groupId: s.coupleId, kind: 'SETTLEMENT', dedupeKey: `settlement:${s.id}:confirm`, amount: s.amount, postedAt: s.date, settlementId: s.id, entries: [{ userId: s.fromUserId, amount: s.amount }, { userId: s.toUserId, amount: -s.amount }] });
}
