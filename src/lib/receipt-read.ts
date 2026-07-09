import { toEuros } from './currency';
import { ReceiptItem } from '@/types';

/**
 * Phase 4 read-switch ("receipt-full"): the ReceiptLineItem TABLE (cents-native)
 * is the effective read source for receipt-derived display + persisted-read
 * splits, replacing the legacy Expense.receiptData JSON (euro floats).
 *
 * Pure on purpose (mirrors src/lib/category-read.ts): server pages, API routes
 * and unit tests share one read path without pulling in Prisma. receiptData
 * WRITES stay (dual-write) until the gated Phase 5 column drop.
 */

/** A persisted ReceiptLineItem row, narrowed to the columns the read path needs. */
export interface ReceiptLineRow {
    description: string;
    quantity: number;
    unitPrice: number;  // CENTS
    lineTotal: number;  // CENTS (can be negative, e.g. promotions)
    position: number;
    assignedToId: string | null;
}

/**
 * Prisma include fragment: the receipt rows in receipt order. Spread into any
 * Expense query whose result reads the receipt (display or persisted-read split).
 */
export const RECEIPT_LINES_SELECT = {
    lineItems: { orderBy: { position: 'asc' } },
} as const;

/**
 * Map persisted ReceiptLineItem rows -> the euro-float ReceiptItem[] DTO the UI
 * expects. cents -> euros for price/total; assignedToId -> assignedTo (same
 * semantics: userId => exclusive, null => shared 50/50). Rows are defensively
 * re-sorted by position so display order matches the legacy JSON array order.
 * toEuros(toCents(x)) == x for 2-decimal euro values, so every display sum
 * stays byte-identical to the legacy receiptData read.
 */
export function receiptItemsView(
    lines: ReceiptLineRow[] | null | undefined,
): ReceiptItem[] {
    if (!lines) return [];
    return [...lines]
        .sort((a, b) => a.position - b.position)
        .map((l) => ({
            description: l.description,
            quantity: l.quantity,
            price: toEuros(l.unitPrice),
            total: toEuros(l.lineTotal),
            assignedTo: l.assignedToId,
        }));
}

/**
 * Reduce persisted rows to the minimal cents shape the split twin
 * (calculateSplitAmountsFromLines / hasExclusiveReceiptLines in splits.ts)
 * needs. No conversion — lineTotal is already cents. Returns null for a null
 * receipt so the split twin takes its EQUAL branch, matching the euro path.
 */
export function linesForSplit(
    lines: ReceiptLineRow[] | null | undefined,
): { lineTotal: number; assignedToId: string | null }[] | null {
    if (!lines) return null;
    return lines.map((l) => ({ lineTotal: l.lineTotal, assignedToId: l.assignedToId }));
}
