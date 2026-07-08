import { prisma } from '@/lib/db';
import { getGroupMembers } from '@/lib/membership';

/**
 * Ledger-sourced net balances (integer CENTS) for a group's ACTIVE members.
 * Σ LedgerEntry.amount over each member's Account — the EXACT quantity
 * scripts/reconcile-ledger.ts proves equal to finance.ts.calculateBalances.
 *
 * Restricted to ACTIVE members (result keyed only by them), defaulting to 0 when
 * a member has no account/entries — identical to reconcile GATE A. Positive =
 * member is owed; negative = member owes.
 */
export async function getGroupBalances(groupId: string): Promise<Record<string, number>> {
  const members = await getGroupMembers(groupId);
  const accounts = await prisma.account.findMany({
    where: { groupId },
    include: { entries: { select: { amount: true } } },
  });

  const byUser = new Map<string, number>();
  for (const a of accounts) {
    byUser.set(a.userId, a.entries.reduce((sum, e) => sum + e.amount, 0));
  }

  const balances: Record<string, number> = {};
  for (const m of members) balances[m.id] = byUser.get(m.id) ?? 0;
  return balances;
}
