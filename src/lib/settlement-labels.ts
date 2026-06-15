/**
 * Localized (es-ES) labels for Settlement enums.
 * Keep these in sync with the Prisma enums SettlementStatus / SettlementMethod.
 */

export type SettlementStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED';
export type SettlementMethod = 'CASH' | 'BIZUM' | 'TRANSFER';

const STATUS_LABELS: Record<string, string> = {
    PENDING: 'Pendiente',
    CONFIRMED: 'Confirmado',
    REJECTED: 'Rechazado',
};

const METHOD_LABELS: Record<string, string> = {
    CASH: 'Efectivo',
    BIZUM: 'Bizum / Transferencia',
    TRANSFER: 'Bizum / Transferencia',
};

export function getSettlementStatusLabel(status: string): string {
    return STATUS_LABELS[status] ?? status;
}

export function getSettlementMethodLabel(method: string): string {
    return METHOD_LABELS[method] ?? method;
}
