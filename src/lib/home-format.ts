/**
 * Pure presentation helpers for the EQUIL Inicio / Espacios screens. DB-free and
 * deterministic (every date is rendered in Europe/Madrid, never the server TZ)
 * so they are unit-tested and shared by server pages and client components.
 *
 * Money is always integer CENTS in; the only maths here is sign/rounding for
 * display — balances themselves come from the ledger (`ledger-read.ts`).
 */

import { formatCurrency } from "@/lib/currency";

export const APP_TZ = "Europe/Madrid";

/** Less than one cent is noise from integer splits — treat it as zero. */
export function normalizeCents(cents: number): number {
    return Math.abs(cents) < 1 ? 0 : Math.round(cents);
}

/** Signed money: "+12,00 €" / "-5,00 €" / "0,00 €" (the e2e contract of `balance-amount`). */
export function signedEuros(cents: number): string {
    const c = normalizeCents(cents);
    return `${c > 0 ? "+" : ""}${formatCurrency(c)}`;
}

/** Unsigned money for the big card amount: "12,00 €". */
export function absEuros(cents: number): string {
    return formatCurrency(Math.abs(normalizeCents(cents)));
}

/** Espacios row balance: "+12,00 €" / "−5,00 €" (typographic minus) / "En paz". */
export function rowBalance(cents: number): string {
    const c = normalizeCents(cents);
    if (c === 0) return "En paz";
    return `${c > 0 ? "+" : "−"}${formatCurrency(Math.abs(c))}`;
}

/** Tone of a balance for colouring. */
export function balanceTone(cents: number): "positive" | "negative" | "neutral" {
    const c = normalizeCents(cents);
    return c > 0 ? "positive" : c < 0 ? "negative" : "neutral";
}

/** First name for compact copy ("con Lucía"). */
export function firstName(name: string | null | undefined): string {
    const n = (name ?? "").trim();
    return n ? n.split(/\s+/)[0] : "Alguien";
}

/**
 * Balance wording under a space card. `others` are the OTHER active members'
 * names; with exactly one other person the copy names them.
 */
export function balanceWords(cents: number, others: string[]): string {
    const c = normalizeCents(cents);
    const one = others.length === 1 ? firstName(others[0]) : null;
    if (c > 0) return one ? `${one} te debe` : "Te deben";
    if (c < 0) return one ? `Le debes a ${one}` : "Debes";
    return "Estáis en paz";
}

/** Card subtitle: "Solo tú" / "con Lucía" / "4 personas". */
export function cardSub(others: string[]): string {
    if (others.length === 0) return "Solo tú";
    if (others.length === 1) return `con ${firstName(others[0])}`;
    return `${others.length + 1} personas`;
}

// --- Dates (Europe/Madrid) -------------------------------------------------

function madridParts(d: Date): { y: number; m: number; day: number } {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: APP_TZ,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(d);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    return { y: get("year"), m: get("month"), day: get("day") };
}

/** Minutes Madrid is ahead of UTC at instant `d` (60 in winter, 120 in summer). */
function madridOffsetMinutes(d: Date): number {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: APP_TZ,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    }).formatToParts(d);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    return Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000);
}

/** Instant of 00:00 on the 1st of the current Madrid month. */
export function madridMonthStart(now: Date = new Date()): Date {
    const { y, m } = madridParts(now);
    const guess = new Date(Date.UTC(y, m - 1, 1));
    return new Date(guess.getTime() - madridOffsetMinutes(guess) * 60000);
}

/** Capitalised Madrid month name: "Octubre". */
export function madridMonthName(now: Date = new Date()): string {
    const s = new Intl.DateTimeFormat("es-ES", { timeZone: APP_TZ, month: "long" }).format(now);
    return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "Hoy" / "Ayer" / "3 oct" — compared on Madrid calendar days. */
export function dayLabel(date: Date | string, now: Date = new Date()): string {
    const d = new Date(date);
    const a = madridParts(d);
    const b = madridParts(now);
    const dayNum = (p: { y: number; m: number; day: number }) => Date.UTC(p.y, p.m - 1, p.day) / 86400000;
    const diff = dayNum(b) - dayNum(a);
    if (diff === 0) return "Hoy";
    if (diff === 1) return "Ayer";
    return new Intl.DateTimeFormat("es-ES", { timeZone: APP_TZ, day: "numeric", month: "short" })
        .format(d)
        .replace(".", "");
}

// --- Expense subtitles -----------------------------------------------------

/**
 * "Pagaste tú · a medias" style phrase for a shared expense. `splits` are the
 * per-user shares in cents; `names` maps userId → display name; `memberCount`
 * is the space's ACTIVE member count.
 */
export function expenseSub({
    payerId,
    meId,
    splits,
    names,
    memberCount,
}: {
    payerId: string;
    meId: string;
    splits: { userId: string; amount: number }[];
    names: Record<string, string>;
    memberCount: number;
}): string {
    const payer = payerId === meId ? "Pagaste tú" : `Pagó ${firstName(names[payerId])}`;
    const shares = splits.filter((s) => s.amount > 0);
    let how = "a medida";
    if (shares.length === 1) {
        const b = shares[0].userId;
        how = b === meId
            ? "solo para ti"
            : `${memberCount === 2 ? "solo para" : "para"} ${firstName(names[b])}`;
    } else if (shares.length > 1) {
        const min = Math.min(...shares.map((s) => s.amount));
        const max = Math.max(...shares.map((s) => s.amount));
        if (max - min <= 1) {
            how = shares.length === memberCount
                ? (memberCount === 2 ? "a medias" : "a partes iguales")
                : `entre ${shares.length}`;
        }
    }
    return `${payer} · ${how}`;
}

// --- Category breakdown ----------------------------------------------------

export type CategorySlice = { key: string; label: string; hex: string; cents: number; pct: number };

/**
 * Sort per-category totals (cents) desc and attach rounded percentages of the
 * grand total. Pure — the caller resolves label/hex from the effective set.
 */
export function categorySlices(
    totals: Record<string, number>,
    meta: (key: string) => { label: string; hex: string },
): CategorySlice[] {
    const total = Object.values(totals).reduce((a, b) => a + b, 0);
    if (total <= 0) return [];
    return Object.entries(totals)
        .filter(([, c]) => c > 0)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([key, cents]) => {
            const m = meta(key);
            return { key, label: m.label, hex: m.hex, cents, pct: Math.round((cents / total) * 100) };
        });
}

// --- Invite links ----------------------------------------------------------

/** Extract the invite token from a pasted `…/i/TOKEN` URL or a bare token. */
export function parseInviteToken(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const match = trimmed.match(/\/i\/([^/?#\s]+)/);
    const token = match ? match[1] : trimmed;
    if (!token || /\s/.test(token)) return null;
    let decoded: string;
    try {
        decoded = decodeURIComponent(token);
    } catch {
        return null;
    }
    // Invite tokens are base64url. Anything else ("..", "%2F…") would make the
    // browser normalise `/i/<token>` to another route (IE-26).
    return /^[A-Za-z0-9_-]+$/.test(decoded) ? decoded : null;
}
