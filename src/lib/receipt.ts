import { toCents } from './currency';

/** A ReceiptLineItem create payload (without expenseId, for nested/explicit create). */
export interface ReceiptLineInput {
    description: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    position: number;
    assignedToId: string | null;
}

/**
 * Map legacy receiptData items (euro floats) to ReceiptLineItem rows (integer
 * cents) for the Phase 2c dual-write. An `assignedTo` not in `validUserIds` is
 * dropped to null so the FK can't reject it.
 */
export function buildReceiptLineItems(
    receiptData: unknown,
    validUserIds: Set<string>,
): ReceiptLineInput[] {
    if (!Array.isArray(receiptData)) return [];
    return receiptData.map((raw, i) => {
        const item = (raw ?? {}) as {
            description?: string;
            quantity?: number;
            price?: number;
            total?: number;
            assignedTo?: string | null;
        };
        const price = typeof item.price === 'number' ? item.price : (item.total ?? 0);
        const total = typeof item.total === 'number' ? item.total : (item.price ?? 0);
        const assignedTo = item.assignedTo && validUserIds.has(item.assignedTo) ? item.assignedTo : null;
        return {
            description: (item.description ?? '').toString().slice(0, 191),
            quantity: typeof item.quantity === 'number' ? item.quantity : 1,
            unitPrice: toCents(price),
            lineTotal: toCents(total),
            position: i,
            assignedToId: assignedTo,
        };
    });
}
