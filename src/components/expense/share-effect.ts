import { formatCurrency } from "@/lib/currency";

export type EffectMember = { id: string; name: string };

/** How many debtor lines are named before collapsing the rest. */
const MAX_NAMED = 3;

/**
 * The balance effect of promoting a personal expense to shared, phrased for
 * the viewer (CF-22): "{X} pasará a deberte {importe}" for each member whose
 * default share becomes a debt towards the payer.
 */
export function promoteEffectLines({
    viewerId,
    payerId,
    members,
    shares,
}: {
    viewerId: string;
    payerId: string;
    members: EffectMember[];
    /** Default split in cents, by member id. */
    shares: Record<string, number>;
}): string[] {
    const debts = members
        .filter((m) => m.id !== payerId && (shares[m.id] ?? 0) > 0)
        .map((m) => ({ ...m, amount: shares[m.id] }));
    if (debts.length === 0) return ["No cambia ningún saldo: el gasto entero es de quien lo pagó."];

    if (payerId === viewerId) {
        const named = debts.length > MAX_NAMED ? debts.slice(0, MAX_NAMED - 1) : debts;
        const lines = named.map((d) => `${d.name} pasará a deberte ${formatCurrency(d.amount)}`);
        const rest = debts.slice(named.length);
        if (rest.length > 0) {
            const total = rest.reduce((acc, d) => acc + d.amount, 0);
            lines.push(`${rest.length} personas más pasarán a deberte ${formatCurrency(total)} en total`);
        }
        return lines;
    }

    const payer = members.find((m) => m.id === payerId);
    const mine = debts.find((d) => d.id === viewerId);
    if (mine && payer) return [`Pasarás a deber ${formatCurrency(mine.amount)} a ${payer.name}`];
    return ["Tu saldo no cambia."];
}

/**
 * The line under "Guardar cambios" when editing a shared expense (CF-22):
 * how much the viewer's balance moves compared with the saved version.
 * `null` when it does not move (or the expense is not shared).
 */
export function editEffectLine({
    beforeCents,
    afterCents,
    partnerName,
}: {
    /** Viewer's balance contribution of the saved expense (paid − share). */
    beforeCents: number;
    /** Same, with the values currently in the form. */
    afterCents: number;
    /** The other member in a couple; groups say "el grupo". */
    partnerName: string | null;
}): string | null {
    const diff = afterCents - beforeCents;
    if (diff === 0) return null;
    const who = partnerName ?? "el grupo";
    const side = diff > 0 ? "a tu favor" : "en tu contra";
    return `Al guardar, el saldo con ${who} cambia en ${formatCurrency(Math.abs(diff))} ${side}. Si ya saldasteis, puede volver a quedar deuda.`;
}
