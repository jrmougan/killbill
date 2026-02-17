import { toCents } from './currency';

interface ReceiptItemForSplit {
    total: number;        // in euros (float)
    assignedTo?: string | null;
}

interface CoupleMMember {
    id: string;
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

    // Split the common part 50/50
    const commonBase = Math.floor(commonTotalCents / 2);
    const commonRemainder = commonTotalCents - (commonBase * 2);

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
