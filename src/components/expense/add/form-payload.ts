/**
 * Split fragment of the expense write payload (POST /api/expenses or PATCH
 * /api/expenses/[id]) for the numpad form. Pure, cents only.
 *
 *  - personal / single-member space → nothing (no split).
 *  - itemized receipt (lines assigned per person) → nothing: the receipt lines
 *    travel as `receiptData` / `receiptItems` and the API derives an ITEMIZED
 *    split from them (G-16: it used to be sent as CUSTOM splits).
 *  - quick / custom choice → `beneficiaryId` (EXCLUSIVE), `customSplits`
 *    (CUSTOM) or — EQUAL — nothing on create / `splitEqual: true` on edit (so a
 *    previously custom split can be turned back into an equal one).
 */
import type { SplitMember, SplitResult } from "@/components/expense/split-editor";
import { quickSplitPayload, type QuickSplit } from "./quick-split";

export type SplitPayload = {
    beneficiaryId?: string;
    customSplits?: { userId: string; amount: number }[];
    splitEqual?: true;
};

export function splitPayload(o: {
    mode: "create" | "edit";
    isShared: boolean;
    itemized: boolean;
    choice: QuickSplit | "custom";
    custom: SplitResult;
    members: SplitMember[];
    meId: string;
    totalCents: number;
}): SplitPayload {
    if (!o.isShared || o.itemized) return {};
    const equal: SplitPayload = o.mode === "edit" ? { splitEqual: true } : {};
    if (o.choice === "custom") {
        if (o.custom.strategy === "EXCLUSIVE" && o.custom.beneficiaryId) return { beneficiaryId: o.custom.beneficiaryId };
        if (o.custom.strategy === "CUSTOM" && o.custom.customSplits) return { customSplits: o.custom.customSplits };
        return equal;
    }
    const quick = quickSplitPayload(o.choice, o.members, o.meId, o.totalCents);
    return quick.beneficiaryId || quick.customSplits ? quick : equal;
}

/** Sum of receipt line totals in cents (lines carry euro floats). */
export function receiptLinesCents(items: { total: number }[]): number {
    return items.reduce((sum, it) => sum + Math.round(it.total * 100), 0);
}
