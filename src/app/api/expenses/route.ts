import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { toCents } from '@/lib/currency';
import { calculateSplitAmounts, hasExclusiveReceiptItems, type ReceiptItemForSplit } from '@/lib/splits';
import { getGroupMembers, getActiveGroup } from '@/lib/membership';
import { resolveCategoryId } from '@/lib/category-db';
import { buildReceiptLineItems } from '@/lib/receipt';
import { postExpenseLedger } from '@/lib/ledger';
import { getSessionCtx, requireSpaceAccess } from '@/lib/authz';
import { assertRosterUnchanged, assertWritableUnderLock, runLedgerTransaction, withSpaceLock } from '@/lib/expense-tx';
import { SettlementError } from '@/lib/settlement-rules';
import { isRecurringInterval, nextRecurringRun, parseExpenseDate } from '@/lib/expense-input';
import type { Prisma } from '@/generated/prisma/client';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function GET(request: Request) {
    try {
        // getSessionCtx (not the raw JWT): a guest session is revalidated against
        // the DB on every request, so an expelled guest is cut off at once (H3).
        const ctx = await getSessionCtx();
        if (!ctx?.userId) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
        const userId = ctx.userId;

        const { searchParams } = new URL(request.url);
        const scope = searchParams.get('scope') === 'personal' ? 'personal' : 'shared';
        // A guest has no personal surface.
        if (scope === 'personal' && ctx.kind === 'guest') {
            return NextResponse.json({ expenses: [], nextCursor: null });
        }

        // Phase 4 selector switch: my group comes from the Membership layer (a
        // guest is caged to the space of its session). Shared scope needs a
        // couple; personal scope works for any user.
        const groupId = scope === 'shared'
            ? (ctx.kind === 'guest' ? ctx.groupId ?? null : await getActiveGroup(userId))
            : null;
        if (scope === 'shared' && !groupId) {
            return NextResponse.json({ expenses: [], nextCursor: null });
        }

        // Personal expenses belong to the caller only; shared ones to the couple.
        const where = scope === 'personal'
            ? { ownerId: userId, visibility: 'PERSONAL' as const }
            : { coupleId: groupId!, visibility: 'SHARED' as const };

        // Parse limit with sane default and bounds
        const parsedLimit = parseInt(searchParams.get('limit') ?? '', 10);
        const limit = Number.isFinite(parsedLimit)
            ? Math.min(Math.max(parsedLimit, 1), MAX_LIMIT)
            : DEFAULT_LIMIT;

        // Optional cursor (expense id) for keyset pagination, or numeric skip offset
        const cursor = searchParams.get('cursor');
        const parsedSkip = parseInt(searchParams.get('skip') ?? '', 10);
        const skip = Number.isFinite(parsedSkip) && parsedSkip > 0 ? parsedSkip : undefined;

        const expenses = await prisma.expense.findMany({
            where,
            include: {
                paidBy: {
                    select: { name: true }
                }
            },
            // `id` breaks ties between equal dates so keyset pagination is stable
            // (no row skipped/repeated across pages) — M3.
            orderBy: [{ date: 'desc' }, { id: 'desc' }],
            // Fetch one extra row to determine if there are more pages
            take: limit + 1,
            ...(cursor
                ? { cursor: { id: cursor }, skip: 1 }
                : skip
                    ? { skip }
                    : {}),
        });

        const hasMore = expenses.length > limit;
        const page = hasMore ? expenses.slice(0, limit) : expenses;
        const nextCursor = hasMore ? page[page.length - 1]?.id ?? null : null;

        const mappedExpenses = page.map((e) => ({
            ...e,
            payer_name: e.paidBy.name
        }));

        return NextResponse.json({ expenses: mappedExpenses, nextCursor });
    } catch (error) {
        console.error("Error fetching expenses:", error);
        return NextResponse.json({ error: "Error al obtener los gastos" }, { status: 500 });
    }
}

/** Upper bound for one expense (999.999,99 €, the numpad ceiling; Int column safe). */
const MAX_AMOUNT_CENTS = 99_999_999;

type SplitInput = { userId: string; amount: number };

const bad = (error: string, status = 400, code?: string) =>
    NextResponse.json(code ? { error, code } : { error }, { status });

/**
 * Create an expense.
 *
 * Destination (G-02): a shared expense goes to the space named by `groupId`
 * — authorized against THAT space via requireSpaceAccess (DB membership +
 * writability), never the `active_group` UI cookie. `groupId` is optional for
 * backwards compatibility (MCP tools, old clients): when absent the caller's
 * active space is used, still authorized the same way. `isPersonal: true` (or
 * `visibility: 'PERSONAL'`) creates a private expense instead.
 *
 * `date` (optional, "YYYY-MM-DD") must be a real calendar day in
 * [2000-01-01, today + 1 year] (G-06/T-03).
 */
export async function POST(request: Request) {
    try {
        const ctx = await getSessionCtx();
        if (!ctx?.userId) return bad('No autorizado', 401);
        const userId = ctx.userId;

        let body: Record<string, unknown>;
        try {
            body = await request.json();
        } catch {
            return bad('Petición no válida');
        }
        if (!body || typeof body !== 'object') return bad('Petición no válida');
        const {
            description, amount, category, beneficiaryId, customSplits, receiptUrl, receiptData, notes,
            isRecurring, recurringInterval, paidById: paidByIdInput, visibility: visibilityInput, isPersonal,
            date: dateInput, groupId: groupIdInput,
        } = body as Record<string, unknown> & { customSplits?: unknown };

        // Personal expenses are a private ledger and never touch a space.
        const isPersonalExpense = isPersonal === true || visibilityInput === 'PERSONAL';
        if (isPersonalExpense && ctx.kind === 'guest') {
            return bad('Los invitados no pueden crear gastos personales', 403);
        }

        let groupId: string | null = null;
        if (!isPersonalExpense) {
            if (groupIdInput !== undefined && groupIdInput !== null && (typeof groupIdInput !== 'string' || groupIdInput === '')) {
                return bad('Espacio no válido');
            }
            groupId = typeof groupIdInput === 'string' ? groupIdInput : await getActiveGroup(userId);
            if (!groupId) return bad('No perteneces a ningún espacio');
            // Membership (DB row), guest cage and writability (SETTLING/ARCHIVED
            // reject new expenses) of the RESOURCE's space.
            const access = await requireSpaceAccess(ctx, groupId, { allowGuest: true });
            if (!access.ok) return bad(access.error, access.status, access.code);
        } else {
            const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
            if (!user) return bad('No autorizado', 401);
        }

        if (typeof description !== 'string' || description.trim().length === 0) {
            return bad('El concepto es obligatorio');
        }

        const parsedDate = parseExpenseDate(dateInput);
        if (!parsedDate.ok) return bad(parsedDate.error);
        const expenseDate = parsedDate.date;

        // Euros (number, or numeric string from old clients) → cents.
        const amountCents = toCents(Number(amount));
        if (amount === null || amount === '' || !Number.isFinite(amountCents) || amountCents <= 0) {
            return bad('Importe no válido');
        }
        if (amountCents > MAX_AMOUNT_CENTS) return bad('El importe máximo es 999.999,99 €');

        // Members of the destination space (ACTIVE, ordered — split order matters
        // for the remainder cent). Personal expenses have none.
        const coupleMembers = groupId ? (await getGroupMembers(groupId)).map((m) => ({ id: m.id })) : [];
        const memberIds = new Set(coupleMembers.map((m) => m.id));

        // The payer defaults to the creator; the client may attribute it to another
        // member ("¿Quién pagó?"). Personal expenses are always paid by the owner.
        let paidById = userId;
        if (!isPersonalExpense && paidByIdInput !== undefined && paidByIdInput !== null) {
            if (typeof paidByIdInput !== 'string' || !memberIds.has(paidByIdInput)) {
                return bad('Quien pagó no es miembro del espacio');
            }
            paidById = paidByIdInput;
        }

        const wantsRecurring = isRecurring === true;
        if (wantsRecurring && !isRecurringInterval(recurringInterval)) {
            return bad('Periodicidad no válida');
        }
        const normalizedInterval = wantsRecurring && isRecurringInterval(recurringInterval) ? recurringInterval : null;
        // G-12: the series is anchored on the expense date, not on "now".
        const nextRecurringDate = normalizedInterval
            ? nextRecurringRun(expenseDate ?? new Date(), normalizedInterval)
            : undefined;

        // Category validated against the EFFECTIVE set of the context (system ∪
        // context-custom) — an unknown key is a 400, never silently 'other'.
        if (typeof category !== 'string' || category.trim().length === 0) {
            return bad('Categoría no válida');
        }
        const categoryId = await resolveCategoryId(
            category,
            isPersonalExpense ? { ownerId: userId } : { groupId },
        );
        if (!categoryId) return bad('Categoría no válida');

        const expenseData: Prisma.ExpenseUncheckedCreateInput = {
            description: description.trim(),
            amount: amountCents,
            categoryId,
            paidById,
            ownerId: userId,
            // Authorship: a GUEST may only edit/delete their own.
            createdById: userId,
            visibility: isPersonalExpense ? 'PERSONAL' : 'SHARED',
            coupleId: isPersonalExpense ? null : groupId,
            receiptUrl: typeof receiptUrl === 'string' && receiptUrl ? receiptUrl : null,
            notes: typeof notes === 'string' && notes.trim() ? notes : null,
            ...(expenseDate ? { date: expenseDate } : {}),
        };

        const receiptItems = Array.isArray(receiptData) ? (receiptData as ReceiptItemForSplit[]) : null;

        if (isPersonalExpense) {
            // Personal expenses are never split nor settled (splitStrategy null).
        } else if (Array.isArray(customSplits) && customSplits.length > 0) {
            const splits = customSplits as SplitInput[];
            if (splits.some((s) => !Number.isInteger(s?.amount))) {
                return bad('Los importes del reparto no son válidos');
            }
            if (splits.some((s) => s.amount < 0)) {
                return bad('Los importes del reparto no pueden ser negativos');
            }
            if (splits.some((s) => !memberIds.has(s?.userId))) {
                return bad('El reparto incluye a alguien que no es miembro del espacio');
            }
            if (splits.reduce((sum, s) => sum + s.amount, 0) !== amountCents) {
                return bad('El reparto no suma el importe total');
            }
            expenseData.splitStrategy = 'CUSTOM';
            expenseData.splits = { create: splits.map((s) => ({ userId: s.userId, amount: s.amount })) };
        } else if (beneficiaryId) {
            if (typeof beneficiaryId !== 'string' || !memberIds.has(beneficiaryId)) {
                return bad('La persona elegida no es miembro del espacio');
            }
            expenseData.splitStrategy = 'EXCLUSIVE';
            expenseData.splits = { create: [{ userId: beneficiaryId, amount: amountCents }] };
        } else if (coupleMembers.length > 0) {
            // EQUAL, or ITEMIZED when receipt lines are assigned to members (the
            // lines are rescaled to the amount if their sum differs — G-03).
            expenseData.splitStrategy = hasExclusiveReceiptItems(receiptItems) ? 'ITEMIZED' : 'EQUAL';
            const splits = calculateSplitAmounts(amountCents, receiptItems, coupleMembers);
            expenseData.splits = { create: splits.map((s) => ({ userId: s.userId, amount: s.amount })) };
        }

        // Relational receipt line items; assignedTo validated against members.
        const lineItems = buildReceiptLineItems(receiptData, memberIds);
        if (lineItems.length > 0) {
            expenseData.lineItems = { create: lineItems };
        }

        // Expense + optional RecurringSeries + ledger post in one transaction,
        // READ COMMITTED and retried on write conflicts (G-04).
        const createInTx = async (tx: Prisma.TransactionClient) => {
            let newSeriesId: string | null = null;
            if (normalizedInterval && nextRecurringDate) {
                const series = await tx.recurringSeries.create({
                    data: {
                        description: expenseData.description,
                        amount: amountCents,
                        categoryId,
                        visibility: isPersonalExpense ? 'PERSONAL' : 'SHARED',
                        splitStrategy: expenseData.splitStrategy ?? null,
                        notes: expenseData.notes ?? null,
                        interval: normalizedInterval,
                        nextRunDate: nextRecurringDate,
                        coupleId: isPersonalExpense ? null : groupId,
                        ownerId: userId,
                        paidById,
                    },
                });
                newSeriesId = series.id;
            }
            const created = await tx.expense.create({
                data: { ...expenseData, seriesId: newSeriesId },
                include: { splits: true },
            });
            if (newSeriesId) {
                await tx.recurringSeries.update({ where: { id: newSeriesId }, data: { templateId: created.id } });
            }
            // A SHARED expense posts its balanced ledger transaction in the same tx.
            if (created.visibility === 'SHARED' && created.coupleId) {
                await postExpenseLedger(tx, {
                    expenseId: created.id,
                    groupId: created.coupleId,
                    amount: created.amount,
                    paidById: created.paidById,
                    occurredAt: created.date,
                    splits: created.splits.map((s) => ({ userId: s.userId, amount: s.amount })),
                    members: coupleMembers,
                });
            }
            return created;
        };

        // A SHARED expense is written under the space row lock (A3): the status
        // (SETTLING/ARCHIVED reject new expenses) and the roster the splits were
        // computed on are re-checked inside the same transaction as the insert,
        // so a concurrent close/kick/leave can't interleave. PERSONAL ones touch
        // no space.
        const expense = groupId
            ? await withSpaceLock(groupId, async (tx, status) => {
                assertWritableUnderLock(status);
                await assertRosterUnchanged(tx, groupId, coupleMembers.map((m) => m.id));
                return createInTx(tx);
            })
            : await runLedgerTransaction(createInTx);

        return NextResponse.json({ success: true, expenseId: expense.id, groupId: expense.coupleId });
    } catch (error) {
        if (error instanceof SettlementError) return NextResponse.json(error.toJSON(), { status: error.status });
        console.error("Error creating expense:", error);
        return NextResponse.json({ error: "Error al crear el gasto" }, { status: 500 });
    }
}
