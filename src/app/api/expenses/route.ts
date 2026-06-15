import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { toCents } from '@/lib/currency';
import { calculateSplitAmounts } from '@/lib/splits';
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

        if (!user?.coupleId) return NextResponse.json({ expenses: [], nextCursor: null });

        const { searchParams } = new URL(request.url);

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
            where: { coupleId: user.coupleId },
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
        const { description, amount, category, beneficiaryId, customSplits, receiptUrl, receiptData, notes, isRecurring, recurringInterval } = body;

        const user = await prisma.user.findUnique({
            where: { id: userId },
        });

        if (!user?.coupleId) return NextResponse.json({ error: 'No Couple' }, { status: 400 });

        // Convert euros to cents
        const amountCents = toCents(amount);
        if (!Number.isFinite(amountCents) || amountCents <= 0) {
            return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
        }

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

        const expenseData: Prisma.ExpenseUncheckedCreateInput = {
            description,
            amount: amountCents,
            category: normalizedCategory,
            paidById: userId,
            coupleId: user.coupleId,
            receiptUrl: receiptUrl || null,
            receiptData: receiptData || undefined, // Prisma Json handling
            notes: notes || null,
            isRecurring: isRecurring ?? false,
            recurringInterval: normalizedInterval,
            nextRecurringDate: nextRecurringDate || null,
        };

        if (customSplits && Array.isArray(customSplits) && customSplits.length > 0) {
            const splitsTotal = customSplits.reduce(
                (sum: number, s: { amount: number }) => sum + (s?.amount ?? 0),
                0
            );
            if (splitsTotal !== amountCents) {
                return NextResponse.json({ error: 'Splits must sum to the total amount' }, { status: 400 });
            }
            expenseData.splits = {
                create: customSplits.map((s: { userId: string; amount: number }) => ({
                    userId: s.userId,
                    amount: s.amount,
                })),
            };
        } else if (beneficiaryId) {
            expenseData.splits = {
                create: [
                    {
                        userId: beneficiaryId,
                        amount: amountCents
                    }
                ]
            };
        } else {
            // Split among couple members, accounting for exclusive items
            const coupleMembers = await prisma.user.findMany({
                where: { coupleId: user.coupleId },
                select: { id: true }
            });

            if (coupleMembers.length > 0) {
                const splits = calculateSplitAmounts(amountCents, receiptData, coupleMembers);
                expenseData.splits = {
                    create: splits.map(s => ({
                        userId: s.userId,
                        amount: s.amount,
                    }))
                };
            }
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
