import { prisma } from '@/lib/db';
import { Prisma } from '@/generated/prisma/client';

/**
 * Error codes worth retrying: the transaction was rolled back by the database
 * (write conflict / deadlock / lock wait timeout), so re-running it from the
 * start is safe and usually succeeds immediately.
 */
const RETRYABLE_CODES = new Set(['P2034', 'P1008']);
const RETRYABLE_MESSAGE = /deadlock|write conflict|lock wait timeout|TransactionWriteConflict/i;

export function isRetryableTxError(e: unknown): boolean {
    if (typeof e !== 'object' || e === null) return false;
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && RETRYABLE_CODES.has(code)) return true;
    const message = (e as { message?: unknown }).message;
    return typeof message === 'string' && RETRYABLE_MESSAGE.test(message);
}

export type RetryOptions = {
    /** Total attempts including the first one. */
    attempts?: number;
    /** Base backoff in ms (jittered, grows linearly). 0 in tests. */
    backoffMs?: number;
};

/**
 * Run `fn` and re-run it (bounded) when it fails with a retryable transaction
 * error. `fn` must be idempotent as a whole — i.e. a full interactive
 * transaction that was rolled back.
 */
export async function withTxRetry<T>(fn: () => Promise<T>, { attempts = 4, backoffMs = 25 }: RetryOptions = {}): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            return await fn();
        } catch (e) {
            lastError = e;
            if (attempt === attempts || !isRetryableTxError(e)) throw e;
            if (backoffMs > 0) {
                const wait = backoffMs * attempt + Math.floor(Math.random() * backoffMs);
                await new Promise((r) => setTimeout(r, wait));
            }
        }
    }
    throw lastError;
}

/**
 * Interactive transaction for writes that post to the ledger (expense create /
 * edit, import). READ COMMITTED avoids InnoDB gap locks on the unique indexes
 * the ledger touches (Account(groupId,userId), LedgerTransaction.dedupeKey), so
 * concurrent posts in the same space don't deadlock; any residual conflict is
 * retried (G-04).
 */
export function runLedgerTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>, options?: RetryOptions): Promise<T> {
    return withTxRetry(
        () => prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }),
        options,
    );
}
