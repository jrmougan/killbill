import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { toCents } from '@/lib/currency';
import { calculateSplitAmounts, hasExclusiveReceiptItems } from '@/lib/splits';
import { getGroupMembers } from '@/lib/membership';
import { resolveCategoryId } from '@/lib/category-db';
import { buildReceiptLineItems } from '@/lib/receipt';
import { Prisma } from '@/generated/prisma/client';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function GET(request: Request) {
    try {
        const session = await getSession();
        if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const userId = session.userId as string;

        const user = await prisma.user.findUnique({
            where: { id: userId },
        });

        const { searchParams } = new URL(request.url);
        const scope = searchParams.get('scope') === 'personal' ? 'personal' : 'shared';

        // Shared scope needs a couple; personal scope works for any user.
        if (scope === 'shared' && !user?.coupleId) {
            return NextResponse.json({ expenses: [], nextCursor: null });
        }

        // Personal expenses belong to the caller only; shared ones to the couple.
        const where = scope === 'personal'
            ? { ownerId: userId, visibility: 'PERSONAL' as const }
            : { coupleId: user!.coupleId!, visibility: 'SHARED' as const };

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

        // Personal expenses are a private ledger and never touch the couple; shared
        // expenses require a couple (existing behaviour).
        const isPersonalExpense = isPersonal === true || visibilityInput === 'PERSONAL';
        if (!isPersonalExpense && !user?.coupleId) return NextResponse.json({ error: 'No Couple' }, { status: 400 });
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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
        const coupleMembers = (!isPersonalExpense && user.coupleId)
            ? (await getGroupMembers(user.coupleId)).map(m => ({ id: m.id }))
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

        // Normalize free-form input to the DB enum vocabularies so an out-of-vocabulary
        // value (e.g. a category guessed by OCR/Gemini) cannot trigger a DB enum error.
        const VALID_CATEGORIES = ['shopping', 'food', 'rent', 'utilities', 'transport', 'entertainment', 'health', 'other'];
        const VALID_INTERVALS = ['weekly', 'monthly', 'yearly'];
        const normalizedCategory = VALID_CATEGORIES.includes(category) ? category : 'other';
        const normalizedInterval = VALID_INTERVALS.includes(recurringInterval) ? recurringInterval : null;

        // Dual-write the relational Category (Phase 2b). Personal expenses have no
        // group, so they resolve to the system category.
        const categoryId = await resolveCategoryId(
            normalizedCategory,
            isPersonalExpense ? null : user.coupleId,
        );

        const expenseData: Prisma.ExpenseUncheckedCreateInput = {
            description,
            amount: amountCents,
            category: normalizedCategory,
            categoryId,
            paidById,
            ownerId: userId,
            visibility: isPersonalExpense ? 'PERSONAL' : 'SHARED',
            coupleId: isPersonalExpense ? null : user.coupleId,
            receiptUrl: receiptUrl || null,
            receiptData: receiptData || undefined, // Prisma Json handling
            notes: notes || null,
            isRecurring: isRecurring ?? false,
            recurringInterval: normalizedInterval,
            nextRecurringDate: nextRecurringDate || null,
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

        // Dual-write relational receipt line items alongside the receiptData JSON
        // (Phase 2c). assignedTo is validated against couple members.
        const lineItems = buildReceiptLineItems(receiptData, memberIds);
        if (lineItems.length > 0) {
            expenseData.lineItems = { create: lineItems };
        }

        const expense = await prisma.expense.create({
            data: expenseData
        });

        return NextResponse.json({ success: true, expenseId: expense.id });
    } catch (error) {
        console.error("Error creating expense:", error);
        return NextResponse.json({ error: "Error al crear el gasto" }, { status: 500 });
    }
}
