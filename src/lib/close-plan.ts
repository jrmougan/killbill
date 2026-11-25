import { resolveMyDebts } from "./finance";
import { hasOpenBalance } from "./space-policy";

/**
 * Pure (DB-free) view of what is still open in a space while closing it: the
 * /close checklist, the "Cerrando cuentas · faltan N" banner and the archive
 * block reason all count the same rows, and block with the same predicate as
 * the API's assertCanArchive (any open balance, of either sign).
 */

export type PendingPayment = { fromUserId: string; toUserId: string; amount: number };
export type PlannedDebt = { fromId: string; toId: string; amountCents: number };

/**
 * The simplified plan (the greedy matching /settle uses) once every PENDING
 * payment counts: a PENDING never posts to the ledger, so it is applied to the
 * payer's and receiver's balances BEFORE pairing. A debtor who already paid a
 * creditor other than the one the plan would pick is then not listed twice.
 * Within the ±1 cent tolerance everywhere, nothing is listed (archiving is allowed).
 */
export function closePlan(balances: Record<string, number>, pending: PendingPayment[] = []): PlannedDebt[] {
    const after: Record<string, number> = { ...balances };
    for (const p of pending) {
        after[p.fromUserId] = (after[p.fromUserId] ?? 0) + p.amount;
        after[p.toUserId] = (after[p.toUserId] ?? 0) - p.amount;
    }
    if (!Object.values(after).some(hasOpenBalance)) return [];
    const plan: PlannedDebt[] = [];
    for (const debtorId of Object.keys(after)) {
        for (const [creditorId, cents] of Object.entries(resolveMyDebts(after, debtorId))) {
            if (cents > 0) plan.push({ fromId: debtorId, toId: creditorId, amountCents: cents });
        }
    }
    return plan;
}

/**
 * Debts left to settle (ignoring PENDING payments, which block on their own):
 * the plan's rows, and never 0 while any balance is open — the API refuses to
 * archive then (409 OPEN_BALANCES), so the UI must not say "estáis al día".
 */
export function openDebtCount(balances: Record<string, number>): number {
    if (!Object.values(balances).some(hasOpenBalance)) return 0;
    return Math.max(1, closePlan(balances).length);
}

/** "Faltan N" of /close (and the SETTLING banner): PENDING payments plus the plan rows left after them. */
export function closeItemCount(balances: Record<string, number>, pending: PendingPayment[]): number {
    return pending.length + closePlan(balances, pending).length;
}
