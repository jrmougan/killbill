/**
 * Quick split model for the EQUIL add-expense flow (pure, cents only).
 *
 * The numpad screen offers three one-tap distributions for a shared space:
 *   - "equal"  → everyone pays the same (EQUAL; the API divides evenly).
 *   - "mine"   → the whole amount is mine (EXCLUSIVE, beneficiary = me).
 *   - "theirs" → couple: the whole amount is the partner's (EXCLUSIVE);
 *                group: split evenly among everyone except me (CUSTOM).
 * Anything finer ("custom") comes from the SplitEditor under "Más opciones".
 */

import { formatCurrency } from "@/lib/currency";
import { computeSplit, splitValueFromExisting, type SplitMember, type SplitValue } from "@/components/expense/split-editor";

export type QuickSplit = "equal" | "mine" | "theirs";

/** Labels of the "Reparto" tile, per space size (prototype copy). */
export function quickSplitOptions(
    members: SplitMember[],
    meId: string,
): { value: QuickSplit; label: string }[] {
    const others = members.filter((m) => m.id !== meId);
    if (others.length === 1) {
        return [
            { value: "equal", label: "A medias" },
            { value: "mine", label: "Solo para mí" },
            { value: "theirs", label: `Solo ${others[0].name}` },
        ];
    }
    return [
        { value: "equal", label: "Iguales" },
        { value: "mine", label: "Solo para mí" },
        { value: "theirs", label: "Los demás" },
    ];
}

/** Even split with the leftover cents going to the FIRST members (mirrors SplitEditor). */
function evenShares(members: SplitMember[], totalCents: number): Record<string, number> {
    return computeSplit({ mode: "equal", amounts: {}, percents: {}, beneficiaryId: null }, members, totalCents).shares;
}

/** Per-member cents for a quick split. Members absent from the map owe 0. */
export function quickShares(
    split: QuickSplit,
    members: SplitMember[],
    meId: string,
    totalCents: number,
): Record<string, number> {
    if (split === "equal") return evenShares(members, totalCents);
    if (split === "mine") return { [meId]: totalCents };
    const others = members.filter((m) => m.id !== meId);
    if (others.length === 0) return { [meId]: totalCents };
    return evenShares(others, totalCents);
}

/**
 * API payload fragment for a quick split (POST /api/expenses):
 * EQUAL → nothing, EXCLUSIVE → `beneficiaryId`, CUSTOM → `customSplits` (cents).
 */
export function quickSplitPayload(
    split: QuickSplit,
    members: SplitMember[],
    meId: string,
    totalCents: number,
): { beneficiaryId?: string; customSplits?: { userId: string; amount: number }[] } {
    if (split === "equal") return {};
    if (split === "mine") return { beneficiaryId: meId };
    const others = members.filter((m) => m.id !== meId);
    if (others.length === 0) return { beneficiaryId: meId };
    if (others.length === 1) return { beneficiaryId: others[0].id };
    const shares = evenShares(others, totalCents);
    return { customSplits: others.map((m) => ({ userId: m.id, amount: shares[m.id] })) };
}

/**
 * How much MY balance moves with this expense, in cents: what I paid minus my
 * share. Positive → others owe me more; negative → I owe more.
 */
export function balanceDelta(
    payerId: string,
    meId: string,
    shares: Record<string, number>,
    totalCents: number,
): number {
    return (payerId === meId ? totalCents : 0) - (shares[meId] ?? 0);
}

/**
 * Live preview line under the Pagó/Reparto tiles (prototype copy):
 * "Lucía te deberá 21,93 € más" / "Deberás 19,00 € a Lucía" / "No cambia el saldo".
 * Empty for a zero amount or a single-member space.
 */
export function previewLine({
    deltaCents,
    totalCents,
    members,
    meId,
    payerId,
}: {
    deltaCents: number;
    totalCents: number;
    members: SplitMember[];
    meId: string;
    payerId: string;
}): string {
    if (totalCents <= 0 || members.length < 2) return "";
    const others = members.filter((m) => m.id !== meId);
    const couple = others.length === 1;
    if (deltaCents > 0) {
        return couple
            ? `${others[0].name} te deberá ${formatCurrency(deltaCents)} más`
            : `Te deberán ${formatCurrency(deltaCents)} más`;
    }
    if (deltaCents < 0) {
        const payer = members.find((m) => m.id === payerId);
        const who = couple ? others[0].name : payerId === meId || !payer ? "los demás" : payer.name;
        return `Deberás ${formatCurrency(-deltaCents)} a ${who}`;
    }
    return "No cambia el saldo";
}

/**
 * Map a persisted split (edit screen) back onto the quick tiles when it is one
 * of them, otherwise onto the custom editor. ITEMIZED is left to the receipt
 * lines (returned as "equal" here; the caller's itemized flag wins).
 */
export function initialSplitState(
    strategy: "EQUAL" | "CUSTOM" | "EXCLUSIVE" | "ITEMIZED" | null | undefined,
    splits: { userId: string; amount: number }[],
    members: SplitMember[],
    meId: string,
    totalCents: number,
): { choice: QuickSplit | "custom"; value: SplitValue } {
    const value = splitValueFromExisting(strategy, splits, members, totalCents);
    if (members.length < 2 || !strategy || strategy === "EQUAL" || strategy === "ITEMIZED") {
        return { choice: "equal", value };
    }
    const others = members.filter((m) => m.id !== meId);
    if (strategy === "EXCLUSIVE" && splits.length === 1) {
        if (splits[0].userId === meId) return { choice: "mine", value };
        if (others.length === 1 && splits[0].userId === others[0].id) return { choice: "theirs", value };
    }
    if (strategy === "CUSTOM" && others.length > 1) {
        const theirs = quickShares("theirs", members, meId, totalCents);
        const byId = new Map(splits.map((s) => [s.userId, s.amount]));
        const matches = members.every((m) => (byId.get(m.id) ?? 0) === (theirs[m.id] ?? 0));
        if (matches) return { choice: "theirs", value };
    }
    return { choice: "custom", value };
}
