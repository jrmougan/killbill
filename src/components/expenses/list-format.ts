/**
 * Pure text helpers for the Gastos list (prototype `is.gastos`): day group
 * labels ("Hoy", "Ayer", "Sáb 3") and the row subtitle
 * ("Pagaste tú · a medias"). Dates are bucketed in Europe/Madrid.
 */

const TZ = "Europe/Madrid";

/** Calendar day key (YYYY-MM-DD) of an instant in Madrid time. */
export function dayKey(date: Date | string): string {
    return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
        .format(new Date(date));
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Hoy" / "Ayer" / "Sáb 3" (same month) / "Sáb 3 sept" / "3 sept 2025" (other year). */
export function dayLabel(date: Date | string, now: Date = new Date()): string {
    const key = dayKey(date);
    const today = dayKey(now);
    if (key === today) return "Hoy";
    const y = new Date(now);
    y.setUTCDate(y.getUTCDate() - 1);
    if (key === dayKey(y)) return "Ayer";
    const d = new Date(date);
    const sameYear = key.slice(0, 4) === today.slice(0, 4);
    const sameMonth = key.slice(0, 7) === today.slice(0, 7);
    if (!sameYear) {
        return new Intl.DateTimeFormat("es-ES", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" }).format(d).replace(".", "");
    }
    const wd = new Intl.DateTimeFormat("es-ES", { timeZone: TZ, weekday: "short" }).format(d).replace(".", "");
    const day = new Intl.DateTimeFormat("es-ES", { timeZone: TZ, day: "numeric" }).format(d);
    if (sameMonth) return `${cap(wd)} ${day}`;
    const mon = new Intl.DateTimeFormat("es-ES", { timeZone: TZ, month: "short" }).format(d).replace(".", "");
    return `${cap(wd)} ${day} ${mon}`;
}

type Member = { id: string; name: string };

/**
 * Row subtitle for a shared expense: who paid + how it was split.
 * "Pagaste tú · a medias", "Pagó Lucía · solo para ti", "Pagaste tú · para los demás"…
 */
export function expenseSubtitle({
    meId,
    paidBy,
    members,
    splits,
    splitStrategy,
}: {
    meId: string;
    paidBy: string;
    members: Member[];
    splits: { userId: string; amount: number }[];
    splitStrategy: string | null;
}): string {
    const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? "otra persona";
    const payer = paidBy === meId ? "Pagaste tú" : `Pagó ${nameOf(paidBy)}`;
    const n = members.length;
    const charged = splits.filter((s) => s.amount > 0);

    let how: string;
    if (splitStrategy === "ITEMIZED") {
        how = "por productos";
    } else if (charged.length === 1) {
        const only = charged[0].userId;
        how = only === meId ? "solo para ti" : n === 2 ? `solo para ${nameOf(only)}` : `para ${nameOf(only)}`;
    } else if (charged.length > 1) {
        const amounts = charged.map((s) => s.amount);
        const even = Math.max(...amounts) - Math.min(...amounts) <= 1;
        const everyone = charged.length === n;
        const allButMe = !charged.some((s) => s.userId === meId) && charged.length === n - 1;
        if (even && everyone) how = n === 2 ? "a medias" : "a partes iguales";
        else if (even && allButMe) how = "para los demás";
        else how = "reparto personalizado";
    } else {
        how = n === 2 ? "a medias" : "a partes iguales";
    }
    return `${payer} · ${how}`;
}

/** Title + subtitle for a settlement row. */
export function settlementText({
    meId,
    fromId,
    toId,
    members,
    methodLabel,
    status,
}: {
    meId: string;
    fromId: string;
    toId: string | undefined;
    members: Member[];
    methodLabel: string;
    status?: string | null;
}): { title: string; sub: string } {
    const nameOf = (id: string | undefined) => members.find((m) => m.id === id)?.name ?? "otra persona";
    const title = fromId === meId
        ? `Pagaste a ${nameOf(toId)}`
        : toId === meId
            ? `${nameOf(fromId)} te pagó`
            : `${nameOf(fromId)} pagó a ${nameOf(toId)}`;
    const statusLabel = status === "PENDING" ? "Pendiente" : status === "CONFIRMED" ? "Confirmado" : status === "REJECTED" ? "Rechazado" : null;
    const sub = [`Liquidación${methodLabel ? ` · ${methodLabel}` : ""}`, statusLabel]
        .filter(Boolean)
        .join(" · ");
    return { title, sub };
}
