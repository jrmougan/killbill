import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { calculateSplitAmounts, hasExclusiveReceiptItems, type ReceiptItemForSplit } from '@/lib/splits';
import { getGroupMembers, getActiveGroup } from '@/lib/membership';
import { resolveCategoryId } from '@/lib/category-db';
import { buildReceiptLineItems } from '@/lib/receipt';
import { postExpenseLedger } from '@/lib/ledger';
import { assertRosterUnchanged, assertWritableUnderLock, runLedgerTransaction, withSpaceLock } from '@/lib/expense-tx';
import { nextRecurringRun } from '@/lib/expense-input';
import { badRequest, forbidden, requireSpace, route, unauthorized } from '@/lib/http';
import { intParam } from '@/lib/http/schemas';
import { BENEFICIARY_NOT_MEMBER, CreateExpenseBody, PAYER_NOT_MEMBER, SPLIT_NOT_MEMBER } from '@/lib/expense-schemas';
import type { Prisma } from '@/generated/prisma/client';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const ListQuery = z.object({
    // Anything but 'personal' is the shared scope (historical behavior).
    scope: z.string().optional().transform((v) => (v === 'personal' ? 'personal' as const : 'shared' as const)),
    limit: intParam({ default: DEFAULT_LIMIT, min: 1, max: MAX_LIMIT }),
    // Optional cursor (expense id) for keyset pagination, or numeric skip offset.
    cursor: z.string().optional(),
    skip: intParam({ default: 0 }),
});

// getSessionCtx (not the raw JWT): a guest session is revalidated against the
// DB on every request, so an expelled guest is cut off at once (H3).
export const GET = route(
    { auth: 'user-or-guest', query: ListQuery, errorMessage: 'Error al obtener los gastos', logLabel: 'Error fetching expenses:' },
    async ({ ctx, query }) => {
        const userId = ctx.userId;
        const { scope, limit, cursor } = query;
        const skip = query.skip > 0 ? query.skip : undefined;
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
    },
);

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
 * [2000-01-01, today + 1 year] (G-06/T-03). The body SHAPE is validated by
 * CreateExpenseBody; membership-dependent rules are checked below.
 */
export const POST = route(
    { auth: 'user-or-guest', body: CreateExpenseBody, errorMessage: 'Error al crear el gasto', logLabel: 'Error creating expense:' },
    async ({ ctx, body }) => {
        const userId = ctx.userId;
        const {
            description, amount: amountCents, category, beneficiaryId, customSplits, receiptUrl, receiptData, notes,
            isRecurring, recurringInterval, paidById: paidByIdInput, visibility: visibilityInput, isPersonal,
            date: expenseDate, groupId: groupIdInput,
        } = body;

        // Personal expenses are a private ledger and never touch a space.
        const isPersonalExpense = isPersonal === true || visibilityInput === 'PERSONAL';
        if (isPersonalExpense && ctx.kind === 'guest') {
            throw forbidden('Los invitados no pueden crear gastos personales');
        }

        let groupId: string | null = null;
        if (!isPersonalExpense) {
            groupId = groupIdInput ?? await getActiveGroup(userId);
            if (!groupId) throw badRequest('No perteneces a ningún espacio');
            // Membership (DB row), guest cage and writability (SETTLING/ARCHIVED
            // reject new expenses) of the RESOURCE's space.
            await requireSpace(ctx, groupId, { allowGuest: true });
        } else {
            const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
            if (!user) throw unauthorized();
        }

        // Members of the destination space (ACTIVE, ordered — split order matters
        // for the remainder cent). Personal expenses have none.
        const coupleMembers = groupId ? (await getGroupMembers(groupId)).map((m) => ({ id: m.id })) : [];
        const memberIds = new Set(coupleMembers.map((m) => m.id));

        // The payer defaults to the creator; the client may attribute it to another
        // member ("¿Quién pagó?"). Personal expenses are always paid by the owner.
        let paidById = userId;
        if (!isPersonalExpense && paidByIdInput != null) {
            if (!memberIds.has(paidByIdInput)) throw badRequest(PAYER_NOT_MEMBER);
            paidById = paidByIdInput;
        }

        // CreateExpenseBody already requires an interval when isRecurring is true.
        const normalizedInterval = isRecurring === true ? recurringInterval ?? null : null;
        // G-12: the series is anchored on the expense date, not on "now".
        const nextRecurringDate = normalizedInterval
            ? nextRecurringRun(expenseDate ?? new Date(), normalizedInterval)
            : undefined;

        // Category validated against the EFFECTIVE set of the context (system ∪
        // context-custom) — an unknown key is a 400, never silently 'other'.
        const categoryId = await resolveCategoryId(
            category,
            isPersonalExpense ? { ownerId: userId } : { groupId },
        );
        if (!categoryId) throw badRequest('Categoría no válida');

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
            receiptUrl: receiptUrl || null,
            notes: notes?.trim() ? notes : null,
            ...(expenseDate ? { date: expenseDate } : {}),
        };

        const receiptItems = receiptData ? (receiptData as ReceiptItemForSplit[]) : null;

        if (isPersonalExpense) {
            // Personal expenses are never split nor settled (splitStrategy null).
        } else if (customSplits && customSplits.length > 0) {
            // Line shape (integer, non-negative cents) is checked by the schema.
            const splits = customSplits;
            if (splits.some((s) => !memberIds.has(s.userId))) throw badRequest(SPLIT_NOT_MEMBER);
            if (splits.reduce((sum, s) => sum + s.amount, 0) !== amountCents) {
                throw badRequest('El reparto no suma el importe total');
            }
            expenseData.splitStrategy = 'CUSTOM';
            expenseData.splits = { create: splits.map((s) => ({ userId: s.userId, amount: s.amount })) };
        } else if (beneficiaryId) {
            if (!memberIds.has(beneficiaryId)) throw badRequest(BENEFICIARY_NOT_MEMBER);
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
    },
);
