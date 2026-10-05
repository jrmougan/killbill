// Pure, DB-free helpers for the "Quedar en paz" (/settle) screen. Everything is
// in integer CENTS. No new money math: the balance and the pairwise transfers
// come from the canonical ledger balances + finance.resolveMyDebts; the ticket
// only SUMS what it displays and reconciles the rest into one honest row.

import { resolveMyDebts } from "@/lib/finance";

export type SettleMethod = "BIZUM" | "TRANSFER" | "CASH";

export const SETTLE_METHODS: { value: SettleMethod; label: string; phrase: string }[] = [
    { value: "BIZUM", label: "Bizum", phrase: "por Bizum" },
    { value: "TRANSFER", label: "Transfer.", phrase: "por transferencia" },
    { value: "CASH", label: "Efectivo", phrase: "en efectivo" },
];

const METHOD_NAMES: Record<string, string> = { BIZUM: "Bizum", TRANSFER: "Transferencia", CASH: "Efectivo" };

/** Full method name for detail/history views ("Transferencia", not "Transfer."). */
export function methodName(method: string): string {
    return METHOD_NAMES[method] ?? method;
}

export function methodPhrase(method: string): string {
    return SETTLE_METHODS.find((m) => m.value === method)?.phrase ?? "";
}

/** Same 1-cent dead-band as finance.resolveMyDebts: |balance| ≤ 1 cent = at peace. */
export function isAtPeace(balanceCents: number): boolean {
    return Math.abs(balanceCents) <= 1;
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
    /** True when the expense is split equally among all members. */
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
     * Everything in my balance that is NOT explained by the period's expenses:
     * debt carried from before the period, confirmed payments, backdated
     * expenses. balance = (paidByMe − myShare) + carry, so the ticket adds up.
     */
    carry: number;
    balance: number;
};

export function buildTicket(expenses: TicketExpense[], me: string, balance: number): Ticket {
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
        carry: balance - (paidByMe - myShare),
        balance,
    };
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
