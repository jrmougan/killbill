import { formatCurrency } from "@/lib/currency";

export type DeleteEffectSplit = { userId: string; name: string; amount: number };

/** How many debtor lines are named before collapsing the rest. */
const MAX_NAMED = 3;

/**
 * The balance effect of deleting an expense, phrased for the viewer
 * (docs/ux/plan-acciones-criticas.md, CF-21). Only splits that are a debt
 * towards the payer count (the payer's own share and zero shares do not).
 */
export function deleteEffectLines({
    viewerId,
    payer,
    splits,
    personal,
}: {
    viewerId: string;
    payer: { id: string; name: string };
    splits: DeleteEffectSplit[];
    personal: boolean;
}): string[] {
    if (personal) return ["Es un gasto personal: solo cambia tus cuentas."];
    const debts = splits.filter((s) => s.userId !== payer.id && s.amount > 0);
    if (debts.length === 0) return ["No cambia ningún saldo: nadie le debía nada a quien pagó."];

    if (payer.id === viewerId) {
        const named = debts.length > MAX_NAMED ? debts.slice(0, MAX_NAMED - 1) : debts;
        const lines = named.map((s) => `${s.name} dejará de deberte ${formatCurrency(s.amount)}`);
        const rest = debts.slice(named.length);
        if (rest.length > 0) {
            const total = rest.reduce((acc, s) => acc + s.amount, 0);
            lines.push(`${rest.length} personas más dejarán de deberte ${formatCurrency(total)} en total`);
        }
        return lines;
    }

    const mine = debts.find((s) => s.userId === viewerId);
    if (mine) return [`Dejarás de deber ${formatCurrency(mine.amount)} a ${payer.name}`];
    const total = debts.reduce((acc, s) => acc + s.amount, 0);
    return [`Tu saldo no cambia. ${payer.name} dejará de cobrar ${formatCurrency(total)}`];
}
