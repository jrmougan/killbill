import { prisma } from '@/lib/db';
import { Prisma } from '@/generated/prisma/client';
import type { SpaceStatus } from '@/generated/prisma/enums';
import { SettlementError } from '@/lib/settlement-rules';
import { assertSpaceWritable, SpacePolicyError } from '@/lib/space-policy';

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

export type LedgerTxOptions = RetryOptions & {
    /** Max ms to wait for a pooled connection (Prisma interactive tx `maxWait`). */
    maxWait?: number;
    /** Max ms the interactive transaction may run (Prisma `timeout`). */
    timeout?: number;
};

/**
 * Interactive transaction for writes that post to the ledger (expense create /
 * edit, import). READ COMMITTED avoids InnoDB gap locks on the unique indexes
 * the ledger touches (Account(groupId,userId), LedgerTransaction.dedupeKey), so
 * concurrent posts in the same space don't deadlock; any residual conflict is
 * retried (G-04).
 */
export function runLedgerTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>, options: LedgerTxOptions = {}): Promise<T> {
    const { maxWait, timeout, ...retry } = options;
    return withTxRetry(
        () => prisma.$transaction(fn, {
            isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
            ...(maxWait !== undefined ? { maxWait } : {}),
            ...(timeout !== undefined ? { timeout } : {}),
        }),
        retry,
    );
}

/**
 * Take the row lock on a space (`SELECT … FOR UPDATE` on Couple) inside `tx` and
 * return its CURRENT status, or null when the space does not exist.
 *
 * LOCK ORDER (G-04): every space-scoped write takes this lock FIRST, before it
 * touches any other row of the space (Expense/Split inserts — whose FK checks
 * take a shared lock on the same Couple row —, Membership updates, and the
 * Account rows ensureAccount reads/creates). With the space row always first,
 * two writers of the same space queue on it instead of deadlocking on
 * Account(groupId,userId) or on an S→X lock upgrade of the Couple row.
 */
export async function lockSpaceRow(tx: Prisma.TransactionClient, groupId: string): Promise<SpaceStatus | null> {
    const rows = await tx.$queryRaw<{ status: SpaceStatus }[]>`SELECT status FROM Couple WHERE id = ${groupId} FOR UPDATE`;
    return rows.length > 0 ? rows[0].status : null;
}

/**
 * Run `fn` in one ledger transaction (READ COMMITTED, retried on deadlock /
 * lock-wait — runLedgerTransaction) holding the space's row lock (lockSpaceRow).
 *
 * Every write whose validity depends on the space's status, its member set or
 * its balances (expenses, settlements, leave/kick, lifecycle transitions,
 * recurring materialization) runs here and re-reads that state INSIDE the
 * transaction, so a check and the write it guards can't be interleaved with a
 * concurrent writer of the same space. Under READ COMMITTED every read after
 * the lock sees what the previous lock holder committed.
 *
 * A missing space throws SettlementError(404, SPACE_NOT_FOUND). Typed rule
 * failures (SettlementError) are never retried: they roll back and propagate.
 */
export function withSpaceLock<T>(
    groupId: string,
    fn: (tx: Prisma.TransactionClient, spaceStatus: SpaceStatus) => Promise<T>,
    options: LedgerTxOptions = {},
): Promise<T> {
    return runLedgerTransaction(async (tx) => {
        const status = await lockSpaceRow(tx, groupId);
        if (status === null) throw new SettlementError(404, 'SPACE_NOT_FOUND', 'Espacio no encontrado');
        return fn(tx, status);
    }, { attempts: 3, maxWait: 10_000, timeout: 15_000, ...options });
}

/**
 * Inside a withSpaceLock callback: throw the 409 SPACE_NOT_WRITABLE a route
 * returns when the (locked, freshly read) status no longer accepts expenses —
 * SETTLING blocks new/edited expenses, ARCHIVED is read-only (same messages as
 * space-policy assertSpaceWritable).
 */
export function assertWritableUnderLock(status: SpaceStatus): void {
    try {
        assertSpaceWritable(status);
    } catch (e) {
        if (e instanceof SpacePolicyError) throw new SettlementError(e.status, e.code, e.message);
        throw e;
    }
}

/**
 * Inside a withSpaceLock callback: re-read the space's ACTIVE roster (canonical
 * order, see getGroupMembers) and require it to be exactly the one the request
 * was validated and split against. A member who joined/left/was expelled
 * between validation and the lock would otherwise get a split / ledger entry
 * computed on a stale roster (and an expelled payer or beneficiary would carry
 * a balance nobody can see). 409 MEMBERS_CHANGED → the client simply retries.
 */
export async function assertRosterUnchanged(
    tx: Prisma.TransactionClient,
    groupId: string,
    expectedIds: readonly string[],
): Promise<void> {
    const rows = await tx.membership.findMany({
        where: { groupId, status: 'ACTIVE' },
        orderBy: [{ joinedAt: 'asc' }, { userId: 'asc' }],
        select: { userId: true },
    });
    const same = rows.length === expectedIds.length && rows.every((r, i) => r.userId === expectedIds[i]);
    if (!same) {
        throw new SettlementError(409, 'MEMBERS_CHANGED',
            'Los miembros del espacio acaban de cambiar. Revisa el gasto y vuelve a intentarlo.');
    }
}
