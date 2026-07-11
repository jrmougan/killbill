import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { toCents } from '@/lib/currency';
import { calculateSplitAmounts, hasExclusiveReceiptItems } from '@/lib/splits';
import { getGroupMembers, getActiveGroup } from '@/lib/membership';
import { resolveCategoryId } from '@/lib/category-db';
import { buildReceiptLineItems } from '@/lib/receipt';
import { postExpenseLedger } from '@/lib/ledger';
import { assertSpaceWritable, SpacePolicyError } from '@/lib/space-policy';
import { Prisma } from '@/generated/prisma/client';
import type { SpaceStatus } from '@/generated/prisma/enums';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function GET(request: Request) {
    try {
        const session = await getSession();
        if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const userId = session.userId as string;

        const { searchParams } = new URL(request.url);
        const scope = searchParams.get('scope') === 'personal' ? 'personal' : 'shared';

        // Phase 4 selector switch: my group comes from the Membership layer.
        // Shared scope needs a couple; personal scope works for any user.
        const groupId = scope === 'shared' ? await getActiveGroup(userId) : null;
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
            orderBy: { date: 'desc' },
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

export async function POST(request: Request) {
    try {
        const session = await getSession();
        if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const userId = session.userId as string;

        const body = await request.json();
        const { description, amount, category, beneficiaryId, customSplits, receiptUrl, receiptData, notes, isRecurring, recurringInterval, paidById: paidByIdInput, visibility: visibilityInput, isPersonal } = body;

        const user = await prisma.user.findUnique({
            where: { id: userId },
        });
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        // Personal expenses are a private ledger and never touch the couple; shared
        // expenses require a couple (existing behaviour). Phase 4 selector switch:
        // the caller's group is resolved via the Membership layer once per request.
        const isPersonalExpense = isPersonal === true || visibilityInput === 'PERSONAL';
        const groupId = isPersonalExpense ? null : await getActiveGroup(userId);
        if (!isPersonalExpense && !groupId) return NextResponse.json({ error: 'No Couple' }, { status: 400 });

        // A shared expense may only be created in a WRITABLE (ACTIVE) space —
        // SETTLING blocks new expenses, ARCHIVED is read-only (space-policy).
        if (!isPersonalExpense && groupId) {
            const space = await prisma.couple.findUnique({ where: { id: groupId }, select: { status: true } });
            if (!space) return NextResponse.json({ error: 'No Couple' }, { status: 400 });
            try {
                assertSpaceWritable(space.status as SpaceStatus);
            } catch (e) {
                if (e instanceof SpacePolicyError) {
                    return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
                }
                throw e;
            }
        }

        // Validate description is a non-empty string (missing/empty previously 500'd at the DB layer).
        if (typeof description !== 'string' || description.trim().length === 0) {
            return NextResponse.json({ error: 'Invalid description' }, { status: 400 });
        }

        // Convert euros to cents
        const amountCents = toCents(amount);
        if (!Number.isFinite(amountCents) || amountCents <= 0) {
            return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
        }

        // Load couple members up-front so we can validate any client-supplied
        // userId/beneficiaryId actually belongs to the caller's couple (prevents IDOR).
        // Members come from the Membership layer (ACTIVE, ordered) — split order
        // must match. Personal expenses have no couple, so there are no members.
        const coupleMembers = (!isPersonalExpense && groupId)
            ? (await getGroupMembers(groupId)).map(m => ({ id: m.id }))
            : [];
        const memberIds = new Set(coupleMembers.map(m => m.id));

        // The payer defaults to the creator, but the client may attribute the expense
        // to the partner ("¿Quién pagó?"). Only honour an id that belongs to the couple.
        // Personal expenses are always paid by (and owned by) the creator.
        const paidById = (!isPersonalExpense && typeof paidByIdInput === 'string' && memberIds.has(paidByIdInput))
            ? paidByIdInput
            : userId;

        // Calculate nextRecurringDate if recurring
        let nextRecurringDate: Date | undefined = undefined;
        if (isRecurring && recurringInterval) {
            const base = new Date();
            if (recurringInterval === 'weekly') {
                nextRecurringDate = new Date(base.getTime() + 7 * 24 * 60 * 60 * 1000);
            } else if (recurringInterval === 'monthly') {
                nextRecurringDate = new Date(base);
                nextRecurringDate.setMonth(nextRecurringDate.getMonth() + 1);
            } else if (recurringInterval === 'yearly') {
                nextRecurringDate = new Date(base);
                nextRecurringDate.setFullYear(nextRecurringDate.getFullYear() + 1);
            }
        }

        const VALID_INTERVALS = ['weekly', 'monthly', 'yearly'];
        const normalizedInterval = VALID_INTERVALS.includes(recurringInterval) ? recurringInterval : null;

        // Fase 3: the category is validated against the EFFECTIVE set of the
        // context (system ∪ context-custom) via resolveCategoryId — an unknown key
        // is a 400, NEVER silently normalized to 'other'. resolveCategoryId returns
        // null exactly when the key exists in neither the context-custom nor the
        // system layer, which is the effective-list membership check.
        if (typeof category !== 'string' || category.trim().length === 0) {
            return NextResponse.json({ error: 'Invalid category' }, { status: 400 });
        }
        const categoryId = await resolveCategoryId(
            category,
            isPersonalExpense ? { ownerId: userId } : { groupId },
        );
        if (!categoryId) {
            return NextResponse.json({ error: 'Invalid category' }, { status: 400 });
        }

        const expenseData: Prisma.ExpenseUncheckedCreateInput = {
            description,
            amount: amountCents,
            // Phase 5 (WS5): the enum category column is no longer written; categoryId
            // (the relational Category) is the sole category source.
            categoryId,
            paidById,
            ownerId: userId,
            // Fase 1: authorship. Imprescindible para que un GUEST solo pueda
            // editar/borrar los suyos; siempre = usuario actual en creación.
            createdById: userId,
            visibility: isPersonalExpense ? 'PERSONAL' : 'SHARED',
            coupleId: isPersonalExpense ? null : groupId,
            receiptUrl: receiptUrl || null,
            notes: notes || null,
            // Phase 5 (stop-dual-write): the recurrence schedule lives on
            // RecurringSeries (created below); Expense.isRecurring/recurringInterval/
            // nextRecurringDate are no longer written. The template is identified by
            // RecurringSeries.templateId, set once the expense id exists.
        };

        if (isPersonalExpense) {
            // Personal expenses are a private ledger — never split, never settled.
            // splitStrategy stays null (no splits created).
        } else if (customSplits && Array.isArray(customSplits) && customSplits.length > 0) {
            if (customSplits.some((s: { amount: number }) => (s?.amount ?? 0) < 0)) {
                return NextResponse.json({ error: 'Split amounts must not be negative' }, { status: 400 });
            }
            if (customSplits.some((s: { userId: string }) => !memberIds.has(s?.userId))) {
                return NextResponse.json({ error: 'Split user is not a member of your couple' }, { status: 400 });
            }
            const splitsTotal = customSplits.reduce(
                (sum: number, s: { amount: number }) => sum + (s?.amount ?? 0),
                0
            );
            if (splitsTotal !== amountCents) {
                return NextResponse.json({ error: 'Splits must sum to the total amount' }, { status: 400 });
            }
            expenseData.splitStrategy = 'CUSTOM';
            expenseData.splits = {
                create: customSplits.map((s: { userId: string; amount: number }) => ({
                    userId: s.userId,
                    amount: s.amount,
                })),
            };
        } else if (beneficiaryId) {
            if (!memberIds.has(beneficiaryId)) {
                return NextResponse.json({ error: 'Beneficiary is not a member of your couple' }, { status: 400 });
            }
            expenseData.splitStrategy = 'EXCLUSIVE';
            expenseData.splits = {
                create: [
                    {
                        userId: beneficiaryId,
                        amount: amountCents
                    }
                ]
            };
        } else {
            // Split among couple members, accounting for exclusive items. If the
            // receipt assigns any item to a specific member the split is ITEMIZED,
            // otherwise it's a plain EQUAL division.
            if (coupleMembers.length > 0) {
                expenseData.splitStrategy = hasExclusiveReceiptItems(receiptData) ? 'ITEMIZED' : 'EQUAL';
                const splits = calculateSplitAmounts(amountCents, receiptData, coupleMembers);
                expenseData.splits = {
                    create: splits.map(s => ({
                        userId: s.userId,
                        amount: s.amount,
                    }))
                };
            }
        }

        // Persist relational receipt line items (the source of truth; the legacy
        // receiptData JSON column is no longer written — Phase 5 stop-dual-write)
        // (Phase 2c). assignedTo is validated against couple members.
        const lineItems = buildReceiptLineItems(receiptData, memberIds);
        if (lineItems.length > 0) {
            expenseData.lineItems = { create: lineItems };
        }

        // Phase 2d dual-write: a recurring expense is the TEMPLATE of a series.
        // Persist the rule/template in RecurringSeries and link the template via
        // seriesId. Expense.isRecurring/recurringInterval/nextRecurringDate stay the
        // source of truth this phase (read-switch deferred). Both writes share one
        // transaction so a failed expense.create can't leave an orphan series.
        const expense = await prisma.$transaction(async (tx) => {
            let newSeriesId: string | null = null;
            if (isRecurring && normalizedInterval && nextRecurringDate) {
                const series = await tx.recurringSeries.create({
                    data: {
                        description,
                        amount: amountCents,
                        // Phase 5 (WS5): enum category no longer written; categoryId only.
                        categoryId,
                        visibility: isPersonalExpense ? 'PERSONAL' : 'SHARED',
                        splitStrategy: expenseData.splitStrategy ?? null,
                        notes: notes || null,
                        interval: normalizedInterval,
                        nextRunDate: nextRecurringDate,
                        coupleId: isPersonalExpense ? null : groupId,
                        ownerId: userId,
                        paidById,
                    },
                });
                expenseData.seriesId = series.id;
                newSeriesId = series.id;
            }
            const created = await tx.expense.create({ data: expenseData, include: { splits: true } });
            // Phase 5: set the durable template pointer now that the template id exists.
            if (newSeriesId) {
                await tx.recurringSeries.update({ where: { id: newSeriesId }, data: { templateId: created.id } });
            }
            // Phase 3 dual-write: a SHARED expense posts its balanced ledger
            // transaction in the same tx. PERSONAL expenses post nothing.
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
        });

        return NextResponse.json({ success: true, expenseId: expense.id });
    } catch (error) {
        console.error("Error creating expense:", error);
        return NextResponse.json({ error: "Error al crear el gasto" }, { status: 500 });
    }
}
