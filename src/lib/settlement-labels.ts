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
    BIZUM: 'Bizum',
    TRANSFER: 'Transferencia',
};

export function getSettlementStatusLabel(status: string): string {
    return STATUS_LABELS[status] ?? status;
}

/**
 * Status pill text, worded for who looks at it: a PENDING payment is still a
 * claim ("Pendiente de confirmar"), and a REJECTED one reads "No recibido" to
 * the payer and "Rechazado" to the receiver (docs/ux/plan-acciones-criticas.md).
 */
export function getSettlementChipLabel(status: string, side?: 'payer' | 'receiver'): string {
    if (status === 'PENDING') return 'Pendiente de confirmar';
    if (status === 'REJECTED' && side === 'payer') return 'No recibido';
    return getSettlementStatusLabel(status);
}

export function getSettlementMethodLabel(method: string): string {
    return METHOD_LABELS[method] ?? method;
}
