import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getPrimaryGroup } from '@/lib/membership';
import { toCents } from '@/lib/currency';
import { CATEGORIES } from '@/lib/categories';
import { resolveCategoryId } from '@/lib/category-db';
import { categoryKeyOf, CATEGORY_REF_SELECT } from '@/lib/category-read';

const VALID_CATEGORIES = Object.keys(CATEGORIES);

export async function GET(request: Request) {
    const session = await getSession();
    if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = session.userId as string;

    const { searchParams } = new URL(request.url);
    const scope = searchParams.get('scope') === 'personal' ? 'personal' : 'shared';

    // Shared budgets need a couple; personal budgets work for any user.
    // Phase 4 selector switch: the caller's group comes from the Membership layer.
    const groupId = scope === 'shared' ? await getPrimaryGroup(userId) : null;
    if (scope === 'shared' && !groupId) return NextResponse.json({ budgets: [] });

    // Current-month view window [monthStart, monthEnd). Budgets are selected by
    // half-open period-range overlap (Phase 2e/4 read-switch); spend is still
    // measured over this same month window below.
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    // Phase 4 read-switch: select by [periodStart, periodEnd) range overlap with the
    // current-month window instead of legacy `month` equality. For all-MONTH budgets
    // (periodStart == month, periodEnd == next-month-start) this yields identical rows,
    // and it also surfaces WEEK/YEAR/CUSTOM budgets overlapping the current month.
    const periodOverlap = { periodStart: { lt: monthEnd }, periodEnd: { gt: monthStart } };
    const budgets = await prisma.budget.findMany({
        where: scope === 'personal'
            ? { ownerId: userId, ...periodOverlap }
            : { coupleId: groupId!, ...periodOverlap },
        orderBy: { category: 'asc' },
        include: CATEGORY_REF_SELECT,
    });

    // Get actual spending per category for the current month.
    // Personal budgets are measured against the caller's personal expenses;
    // shared budgets against the couple's shared expenses only.
    const expenses = await prisma.expense.findMany({
        where: scope === 'personal'
            ? { ownerId: userId, visibility: 'PERSONAL', date: { gte: monthStart, lt: monthEnd } }
            : { coupleId: groupId!, visibility: 'SHARED', date: { gte: monthStart, lt: monthEnd } },
        select: { category: true, amount: true, ...CATEGORY_REF_SELECT },
    });

    // Phase 4 read-switch: spend-by-category keys on the relational Category
    // (categoryRef.key, enum fallback) on BOTH sides of the budget↔expense match.
    const spentByCategory: Record<string, number> = {};
    for (const e of expenses) {
        const key = categoryKeyOf(e);
        spentByCategory[key] = (spentByCategory[key] ?? 0) + e.amount;
    }

    const result = budgets.map((budget) => {
        const key = categoryKeyOf(budget);
        const spent = spentByCategory[key] ?? 0;
        const percentage = budget.amount > 0 ? Math.round((spent / budget.amount) * 100) : 0;
        // Surface the effective key as `category` so clients keep one read key.
        return { budget: { ...budget, category: key }, spent, percentage };
    });

    return NextResponse.json({ budgets: result });
}

export async function POST(request: Request) {
    try {
        const session = await getSession();
        if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const userId = session.userId as string;

        const body = await request.json();
        const { category, amount, month, scope: scopeInput } = body;
        const scope = scopeInput === 'personal' ? 'personal' : 'shared';

        // Shared budgets require a couple; personal budgets do not.
        // Phase 4 selector switch: the caller's group comes from the Membership layer.
        const groupId = scope === 'shared' ? await getPrimaryGroup(userId) : null;
        if (scope === 'shared' && !groupId) return NextResponse.json({ error: 'No Couple' }, { status: 400 });

        if (!category || amount === undefined) {
            return NextResponse.json({ error: 'category and amount are required' }, { status: 400 });
        }

        if (!VALID_CATEGORIES.includes(category)) {
            return NextResponse.json({ error: 'Invalid category' }, { status: 400 });
        }

        // Parse month (YYYY-MM) or default to current month
        let monthDate: Date;
        if (month) {
            const [year, mon] = month.split('-').map(Number);
            monthDate = new Date(year, mon - 1, 1);
        } else {
            const now = new Date();
            monthDate = new Date(now.getFullYear(), now.getMonth(), 1);
        }

        const amountNum = Number(amount);
        if (!Number.isFinite(amountNum)) {
            return NextResponse.json({ error: 'amount must be a valid number' }, { status: 400 });
        }

        const amountCents = toCents(amountNum);
        if (!Number.isFinite(amountCents) || amountCents <= 0) {
            return NextResponse.json({ error: 'amount must be greater than 0' }, { status: 400 });
        }

        // Dual-write the relational Category (Phase 2b). Personal budgets have no
        // group, so they resolve to the system category.
        const categoryId = await resolveCategoryId(category, scope === 'personal' ? null : groupId);

        // Phase 2e dual-write: derive the half-open [periodStart, periodEnd) range
        // from the same monthDate that seeds the legacy `month` column (local-midnight
        // convention, matching how monthDate is built above).
        const periodStart = monthDate;
        const periodEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1);

        const budget = scope === 'personal'
            ? await prisma.budget.upsert({
                where: {
                    category_month_ownerId: {
                        category,
                        month: monthDate,
                        ownerId: userId,
                    },
                },
                create: {
                    category,
                    categoryId,
                    amount: amountCents,
                    month: monthDate,
                    periodStart,
                    periodEnd,
                    periodType: 'MONTH',
                    ownerId: userId,
                },
                update: {
                    amount: amountCents,
                    categoryId,
                },
            })
            : await prisma.budget.upsert({
                where: {
                    category_month_coupleId: {
                        category,
                        month: monthDate,
                        coupleId: groupId!,
                    },
                },
                create: {
                    category,
                    categoryId,
                    amount: amountCents,
                    month: monthDate,
                    periodStart,
                    periodEnd,
                    periodType: 'MONTH',
                    coupleId: groupId!,
                },
                update: {
                    amount: amountCents,
                    categoryId,
                },
            });

        return NextResponse.json({ budget }, { status: 201 });
    } catch (error) {
        console.error('Error al guardar el presupuesto:', error);
        return NextResponse.json({ error: 'Error al guardar el presupuesto' }, { status: 500 });
    }
}
