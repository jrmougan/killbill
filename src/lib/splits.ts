import { toCents } from './currency';

export interface ReceiptItemForSplit {
    total: number;        // in euros (float)
    assignedTo?: string | null;
}

interface CoupleMMember {
    id: string;
}

/**
 * True when a receipt assigns at least one line item exclusively to a member
 * (i.e. the split is ITEMIZED rather than a plain EQUAL division). Tolerates any
 * JSON shape: a bare item array, or an object wrapping an `items` array.
 */
export function hasExclusiveReceiptItems(receiptData: unknown): boolean {
    if (!receiptData) return false;
    const items = Array.isArray(receiptData)
        ? receiptData
        : Array.isArray((receiptData as { items?: unknown }).items)
            ? (receiptData as { items: unknown[] }).items
            : null;
    return items?.some((it) => it && typeof it === 'object' && (it as ReceiptItemForSplit).assignedTo) ?? false;
}

/**
 * Calculate split amounts (in cents) for a couple expense,
 * accounting for exclusive items assigned to a specific partner.
 *
 * - Common items (no assignedTo) are split 50/50.
 * - Exclusive items (assignedTo = userId) are charged 100% to that user.
 * - Remainder from integer division goes to the first member in the array.
 *
 * Returns an array of { userId, amount } in cents.
 */
export function calculateSplitAmounts(
    amountCents: number,
    receiptData: ReceiptItemForSplit[] | null | undefined,
    coupleMembers: CoupleMMember[],
): { userId: string; amount: number }[] {
    // Check if receiptData has any exclusive items
    const hasExclusiveItems = receiptData?.some(item => item.assignedTo) ?? false;

    if (!hasExclusiveItems || !receiptData || coupleMembers.length < 2) {
        // Simple 50/50 split (or N-way, though couples are always 2)
        const baseAmount = Math.floor(amountCents / coupleMembers.length);
        const remainder = amountCents - (baseAmount * coupleMembers.length);
        return coupleMembers.map((m, i) => ({
            userId: m.id,
            amount: baseAmount + (i < remainder ? 1 : 0),
        }));
    }

    // Calculate common vs exclusive amounts from receiptData (euros → cents)
    let commonTotalCents = 0;
    const exclusiveByUser: Record<string, number> = {};

    for (const item of receiptData) {
        const itemCents = toCents(item.total);
        if (item.assignedTo) {
            exclusiveByUser[item.assignedTo] = (exclusiveByUser[item.assignedTo] || 0) + itemCents;
        } else {
            commonTotalCents += itemCents;
        }
    }

    // Split the common part equally among all members (N-way; behaviour-identical
    // for a 2-person couple, correct for groups >2).
    const n = coupleMembers.length;
    const commonBase = Math.floor(commonTotalCents / n);
    const commonRemainder = commonTotalCents - (commonBase * n);

    // Build split amounts
    const splits = coupleMembers.map((m, i) => ({
        userId: m.id,
        amount: commonBase + (i < commonRemainder ? 1 : 0) + (exclusiveByUser[m.id] || 0),
    }));

    // Verify splits sum matches the total amount.
    // Due to rounding differences between receipt item totals and the overall amount,
    // there may be a small discrepancy. Adjust the first split to compensate.
    const splitsSum = splits.reduce((acc, s) => acc + s.amount, 0);
    const diff = amountCents - splitsSum;
    if (diff !== 0) {
        splits[0].amount += diff;
    }

    return splits;
}

/**
 * Proportionally rescale existing per-user split amounts (CENTS) to a new total,
 * preserving each member's share of the old total. Used when a CUSTOM-strategy
 * expense is edited with only a new amount (no fresh per-user amounts): rescaling
 * keeps the split N-way and guarantees Σ == newTotalCents (remainder assigned to
 * the first member), instead of collapsing the split or leaving a non-balanced
 * ledger. Degenerate cases (empty input, zero old total) fall back to an even
 * N-way division so the result still sums exactly.
 */
export function rescaleSplits(
    existing: { userId: string; amount: number }[],
    newTotalCents: number,
): { userId: string; amount: number }[] {
    if (existing.length === 0) return [];
    const oldTotal = existing.reduce((acc, s) => acc + s.amount, 0);

    if (oldTotal <= 0) {
        const base = Math.floor(newTotalCents / existing.length);
        const remainder = newTotalCents - base * existing.length;
        return existing.map((s, i) => ({
            userId: s.userId,
            amount: base + (i < remainder ? 1 : 0),
        }));
    }

    const scaled = existing.map((s) => ({
        userId: s.userId,
        amount: Math.floor((s.amount * newTotalCents) / oldTotal),
    }));
    const diff = newTotalCents - scaled.reduce((acc, s) => acc + s.amount, 0);
    if (diff !== 0) scaled[0].amount += diff;
    return scaled;
}

/** A persisted ReceiptLineItem row narrowed to the columns the split needs (CENTS). */
export interface ReceiptLineForSplit {
    lineTotal: number;             // CENTS (already converted at write time)
    assignedToId?: string | null;  // exclusive assignee userId; null = shared
}

/**
 * Cents-native twin of hasExclusiveReceiptItems for PERSISTED ReceiptLineItem
 * rows. True when any row carries a non-null assignedToId (drives ITEMIZED vs
 * EQUAL). Byte-parity with the JSON fn over the same persisted receipt is proven
 * by audit gate G2b.
 */
export function hasExclusiveReceiptLines(
    lines: ReceiptLineForSplit[] | null | undefined,
): boolean {
    return lines?.some((l) => l.assignedToId) ?? false;
}

/**
 * Cents-native twin of calculateSplitAmounts for PERSISTED ReceiptLineItem rows.
 * Identical algorithm, but sums lineTotal (already cents) directly instead of
 * toCents(item.total). Byte-identical to the euro fn over the same persisted
 * receipt because lineTotal == toCents(json.total) (buildReceiptLineItems);
 * audit gate G2 proves this across all live receipts.
 */
export function calculateSplitAmountsFromLines(
    amountCents: number,
    lines: ReceiptLineForSplit[] | null | undefined,
    coupleMembers: CoupleMMember[],
): { userId: string; amount: number }[] {
    const hasExclusiveItems = lines?.some((l) => l.assignedToId) ?? false;

    if (!hasExclusiveItems || !lines || coupleMembers.length < 2) {
        const baseAmount = Math.floor(amountCents / coupleMembers.length);
        const remainder = amountCents - (baseAmount * coupleMembers.length);
        return coupleMembers.map((m, i) => ({
            userId: m.id,
            amount: baseAmount + (i < remainder ? 1 : 0),
        }));
    }

    let commonTotalCents = 0;
    const exclusiveByUser: Record<string, number> = {};

    for (const line of lines) {
        if (line.assignedToId) {
            exclusiveByUser[line.assignedToId] = (exclusiveByUser[line.assignedToId] || 0) + line.lineTotal;
        } else {
            commonTotalCents += line.lineTotal;
        }
    }

    const n = coupleMembers.length;
    const commonBase = Math.floor(commonTotalCents / n);
    const commonRemainder = commonTotalCents - (commonBase * n);

    const splits = coupleMembers.map((m, i) => ({
        userId: m.id,
        amount: commonBase + (i < commonRemainder ? 1 : 0) + (exclusiveByUser[m.id] || 0),
    }));

    const splitsSum2 = splits.reduce((acc, s) => acc + s.amount, 0);
    const diff2 = amountCents - splitsSum2;
    if (diff2 !== 0) {
        splits[0].amount += diff2;
    }

    return splits;
}
