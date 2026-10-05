// Pure, DB-free helpers for the "Quedar en paz" (/settle) screen. Everything is
// in integer CENTS. No new money math: the balance and the pairwise transfers
// come from the canonical ledger balances + finance.resolveMyDebts; the ticket
// only SUMS what it displays and reconciles the rest into one honest row.

import { resolveMyDebts } from "@/lib/finance";
import { normalizeCents } from "@/lib/home-format";
import { getSettlementMethodLabel } from "@/lib/settlement-labels";

export type SettleMethod = "BIZUM" | "TRANSFER" | "CASH";

export const SETTLE_METHODS: { value: SettleMethod; label: string; phrase: string }[] = [
    { value: "BIZUM", label: "Bizum", phrase: "por Bizum" },
    { value: "TRANSFER", label: "Transfer.", phrase: "por transferencia" },
    { value: "CASH", label: "Efectivo", phrase: "en efectivo" },
];

/** Full method name for detail/history views ("Transferencia", not "Transfer."). */
export function methodName(method: string): string {
    return getSettlementMethodLabel(method);
}

export function methodPhrase(method: string): string {
    return SETTLE_METHODS.find((m) => m.value === method)?.phrase ?? "";
}

/** Same threshold as Inicio/Espacios (home-format.normalizeCents): 1 cent is a debt. */
export function isAtPeace(balanceCents: number): boolean {
    return normalizeCents(balanceCents) === 0;
}

/** True when every member of the space is at peace (not only me). */
export function everyoneAtPeace(balances: Record<string, number>): boolean {
    return Object.values(balances).every(isAtPeace);
}

export type Transfer = {
    /** The other member. */
    userId: string;
    /** "pay" = I pay them; "receive" = they pay me. */
    direction: "pay" | "receive";
    amount: number;
};

/**
 * Suggested pairwise transfers that involve `me`, from the ledger balances.
 * What I pay is resolveMyDebts(balances, me); what each other member pays me is
 * resolveMyDebts(balances, them)[me] — the same greedy matching, so both views
 * of the same transfer always agree.
 */
export function myTransfers(balances: Record<string, number>, me: string): Transfer[] {
    const out: Transfer[] = [];
    for (const [userId, amount] of Object.entries(resolveMyDebts(balances, me))) {
        if (amount > 0) out.push({ userId, direction: "pay", amount });
    }
    for (const other of Object.keys(balances)) {
        if (other === me) continue;
        const amount = resolveMyDebts(balances, other)[me] ?? 0;
        if (amount > 0) out.push({ userId: other, direction: "receive", amount });
    }
    return out.sort((a, b) => b.amount - a.amount);
}

export type TicketExpense = {
    amount: number;
    paidById: string;
    /** My share of this expense (split row, or the canonical equal split). */
    myShare: number;
    /** True when the expense is split into IDENTICAL shares among all members (no remainder cent). */
    equal: boolean;
};

export type Ticket = {
    count: number;
    /** Total of the shared expenses in the period. */
    total: number;
    /** My share of them ("A cada uno" when every one is an equal split). */
    myShare: number;
    allEqual: boolean;
    paidByMe: number;
    paidByOthers: number;
    /**
     * Net effect on my balance of the CONFIRMED payments in the period
     * (positive = I paid, negative = I was paid).
     */
    payments: number;
    /**
     * Everything else in my balance that the period does not explain (debt
     * carried from before the period, backdated/edited expenses).
     * balance = (paidByMe − myShare) + payments + carry, so the ticket adds up.
     */
    carry: number;
    balance: number;
};

export function buildTicket(expenses: TicketExpense[], me: string, balance: number, payments = 0): Ticket {
    let total = 0;
    let myShare = 0;
    let paidByMe = 0;
    let allEqual = true;
    for (const e of expenses) {
        total += e.amount;
        myShare += e.myShare;
        if (e.paidById === me) paidByMe += e.amount;
        if (!e.equal) allEqual = false;
    }
    return {
        count: expenses.length,
        total,
        myShare,
        allEqual,
        paidByMe,
        paidByOthers: total - paidByMe,
        payments,
        carry: balance - (paidByMe - myShare) - payments,
        balance,
    };
}

/** One movement of my ledger account, timed by when it happened in the app. */
export type LedgerEvent = { at: Date; amount: number; kind: "EXPENSE" | "SETTLEMENT"; key: string };

/**
 * Where the ticket period starts: the moment my running balance last returned
 * to exactly 0 (replaying my ledger movements in order), or null if it never
 * did (period = everything). A partial payment does NOT reset the period, so
 * the ticket keeps explaining the remaining balance. Also returns the net of
 * the confirmed payments AFTER the cutoff (shown as their own ticket row).
 */
export function ticketPeriod(events: LedgerEvent[]): { since: Date | null; payments: number } {
    const sorted = [...events].sort((a, b) => a.at.getTime() - b.at.getTime() || a.key.localeCompare(b.key));
    let running = 0;
    let lastZero = -1;
    sorted.forEach((e, i) => {
        running += e.amount;
        if (running === 0) lastZero = i;
    });
    const since = lastZero >= 0 ? sorted[lastZero].at : null;
    const payments = sorted
        .slice(lastZero + 1)
        .filter((e) => e.kind === "SETTLEMENT")
        .reduce((sum, e) => sum + e.amount, 0);
    return { since, payments };
}

/**
 * Label of the "my share" ticket row. "A cada uno" only when it is literally
 * true: every expense split into identical shares (`allEqual`, see
 * TicketExpense.equal). Otherwise "Tu parte" — an equal split of 10,01 € among
 * 3 is 3,34 / 3,34 / 3,33, so "a cada uno" would be false for someone.
 */
export function shareLabel(ticket: Pick<Ticket, "allEqual">, memberCount: number): string {
    if (!ticket.allEqual) return "Tu parte";
    return memberCount === 2 ? "A cada uno" : `A cada uno (÷${memberCount})`;
}

const TZ = "Europe/Madrid";

function dayParts(d: Date): { day: string; month: string; year: string } {
    const parts = new Intl.DateTimeFormat("es-ES", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return { day: get("day"), month: get("month").replace(".", "").toUpperCase(), year: get("year") };
}

/** "1 – 5 OCT", "28 SEPT – 5 OCT", "28 DIC 2025 – 5 ENE 2026", or "5 OCT" for a single day. */
export function formatPeriod(start: Date, end: Date): string {
    const a = dayParts(start);
    const b = dayParts(end);
    if (a.year !== b.year) return `${a.day} ${a.month} ${a.year} – ${b.day} ${b.month} ${b.year}`;
    if (a.month !== b.month) return `${a.day} ${a.month} – ${b.day} ${b.month}`;
    if (a.day !== b.day) return `${a.day} – ${b.day} ${b.month}`;
    return `${b.day} ${b.month}`;
}

/** Ticket meta line: "1 – 5 OCT · 10 GASTOS". */
export function ticketMeta(start: Date | null, end: Date, count: number): string {
    const n = `${count} ${count === 1 ? "GASTO" : "GASTOS"}`;
    if (!start || count === 0) return `SIN GASTOS NUEVOS`;
    return `${formatPeriod(start, end)} · ${n}`;
}
