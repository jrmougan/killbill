import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getActiveGroup } from '@/lib/membership';
import { resolveCategoryId } from '@/lib/category-db';
import { categoryKeyOf, CATEGORY_REF_SELECT } from '@/lib/category-read';
import { requireSpaceAccess, type SessionCtx } from '@/lib/authz';
import { allowsBudgetsAndRecurring } from '@/lib/space-policy';
import type { SpaceType } from '@/generated/prisma/enums';
import { badRequest, HttpError, notFound, requireSpace, route } from '@/lib/http';
import { BudgetDeleteQuery, BudgetListQuery, parseBudgetBody } from '@/lib/budget-schemas';

/*
 * Budgets are a member/personal surface: a GUEST session (caged to an ephemeral
 * trip, where budgets are vetoed anyway) never reads or writes them — route
 * auth 'user' (403 "Acción no permitida para invitados"). The proxy already
 * blocks /api/budget for guests; this is the defense in depth.
 */

/**
 * Resolve + authorize the shared space a budget call targets. An explicit
 * `groupId` (query/body) wins over the `active_group` UI cookie; either way the
 * caller is authorized against THAT group with `requireSpaceAccess` (DB
 * membership, guests denied). Writes (`write: true`) also require the space to
 * be ACTIVE (SETTLING/ARCHIVED → 409 SPACE_NOT_WRITABLE) and a type that allows
 * budgets (EPHEMERAL vetoes them).
 */
async function sharedSpace(ctx: SessionCtx, explicitGroupId: string | null | undefined, write: boolean): Promise<string> {
    const groupId = explicitGroupId || (await getActiveGroup(ctx.userId));
    if (!groupId) throw badRequest('No perteneces a ningún espacio compartido', 'NO_SPACE');
    const auth = await requireSpace(ctx, groupId, { allowArchived: !write });
    if (write && !allowsBudgetsAndRecurring(auth.space.type as SpaceType)) {
        throw badRequest('Este tipo de espacio no admite presupuestos', 'BUDGETS_NOT_ALLOWED');
    }
    return groupId;
}

export const GET = route({ auth: 'user', query: BudgetListQuery }, async ({ ctx, query }) => {
    const userId = ctx.userId;
    const { scope } = query;

    // Shared budgets need a space; personal budgets work for any user. The space
    // is authorized against its DB membership (read: SETTLING/ARCHIVED allowed).
    let groupId: string | null = null;
    if (scope === 'shared') {
        const explicit = query.groupId;
        if (!explicit && !(await getActiveGroup(userId))) return NextResponse.json({ budgets: [] });
        groupId = await sharedSpace(ctx, explicit, false);
    }

    // Current-month view window [monthStart, monthEnd). Budgets are selected by
    // half-open period-range overlap; spend is measured over the same window.
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const periodOverlap = { periodStart: { lt: monthEnd }, periodEnd: { gt: monthStart } };
    const budgets = await prisma.budget.findMany({
        where: scope === 'personal'
            ? { ownerId: userId, ...periodOverlap }
            : { coupleId: groupId!, ...periodOverlap },
        orderBy: { categoryId: 'asc' },
        include: CATEGORY_REF_SELECT,
    });

    // Actual spending per category for the current month. Personal budgets are
    // measured against the caller's personal expenses; shared budgets against
    // the space's shared expenses only.
    const expenses = await prisma.expense.findMany({
        where: scope === 'personal'
            ? { ownerId: userId, visibility: 'PERSONAL', date: { gte: monthStart, lt: monthEnd } }
            : { coupleId: groupId!, visibility: 'SHARED', date: { gte: monthStart, lt: monthEnd } },
        select: { amount: true, ...CATEGORY_REF_SELECT },
    });

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
});

/**
 * POST /api/budget {category, amount (euros), month?: 'YYYY-MM', scope?, groupId?}
 * Upsert one monthly budget. `groupId` (optional) targets a specific shared
 * space; without it the active space is used. Either way the caller must be an
 * ACTIVE non-guest member of a writable space that allows budgets.
 */
export const POST = route(
    { auth: 'user', errorMessage: 'No se pudo guardar el presupuesto', logLabel: 'Error al guardar el presupuesto:' },
    async ({ req, ctx }) => {
        const userId = ctx.userId;
        // Parsed in the handler: the amount 400 keeps `code: INVALID_AMOUNT` and an
        // unparseable body its historical message.
        const { category, amount: amountCents, month, scope, groupId: bodyGroupId } = await parseBudgetBody(req);

        // The given month (YYYY-MM) or the current one.
        const now = new Date();
        const monthDate = month
            ? new Date(month.year, month.month - 1, 1)
            : new Date(now.getFullYear(), now.getMonth(), 1);

        // Shared budgets: authorize against the target space (writable, member,
        // no guests). Personal budgets are scoped by ownerId only.
        let groupId: string | null = null;
        if (scope === 'shared') groupId = await sharedSpace(ctx, bodyGroupId, true);

        // No hardcoded whitelist: the category is validated against the EFFECTIVE
        // set of the scope (null → 400), so a custom category is accepted and an
        // unknown key is rejected.
        const categoryId = await resolveCategoryId(category, scope === 'personal' ? { ownerId: userId } : { groupId });
        if (!categoryId) throw badRequest('La categoría no existe', 'INVALID_CATEGORY');

        // Half-open [periodStart, periodEnd) range (local-midnight convention).
        const periodStart = monthDate;
        const periodEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1);

        const budget = scope === 'personal'
            ? await prisma.budget.upsert({
                where: {
                    categoryId_periodStart_ownerId: {
                        categoryId,
                        periodStart,
                        ownerId: userId,
                    },
                },
                create: {
                    categoryId,
                    amount: amountCents,
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
                    categoryId_periodStart_coupleId: {
                        categoryId,
                        periodStart,
                        coupleId: groupId!,
                    },
                },
                create: {
                    categoryId,
                    amount: amountCents,
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
    },
);

/**
 * DELETE /api/budget?id=<budgetId>[&scope=shared|personal] — remove one budget
 * (EQUIL "Mes" sheet → "Eliminar"). Authorized against the BUDGET's own scope,
 * never the active-group cookie: a personal budget must belong to the caller
 * (`ownerId`); a shared one requires ACTIVE non-guest membership in ITS space,
 * which must be writable (SETTLING/ARCHIVED → 409 SPACE_NOT_WRITABLE). A
 * foreign/unknown id is a 404 (no existence leak), and the delete itself stays
 * conditional on the scope (`deleteMany` by id + owner/space).
 */
export const DELETE = route(
    {
        auth: 'user',
        query: BudgetDeleteQuery,
        errorMessage: 'No se pudo eliminar el presupuesto',
        logLabel: 'Error al eliminar el presupuesto:',
    },
    async ({ ctx, query: { id, scope: scopeParam } }) => {
        const userId = ctx.userId;
        const missing = () => notFound('Presupuesto no encontrado');

        const budget = await prisma.budget.findUnique({
            where: { id },
            select: { id: true, ownerId: true, coupleId: true },
        });
        if (!budget) throw missing();

        let where: { id: string; ownerId: string } | { id: string; coupleId: string };
        if (budget.ownerId) {
            if (budget.ownerId !== userId || scopeParam === 'shared') throw missing();
            where = { id, ownerId: userId };
        } else if (budget.coupleId) {
            if (scopeParam === 'personal') throw missing();
            const auth = await requireSpaceAccess(ctx, budget.coupleId);
            if (!auth.ok) {
                // Not a member of that space → indistinguishable from "no such budget".
                if (auth.status === 403 || auth.status === 404) throw missing();
                throw new HttpError(auth.status, auth.error, auth.code);
            }
            where = { id, coupleId: budget.coupleId };
        } else {
            throw missing();
        }

        const { count } = await prisma.budget.deleteMany({ where });
        if (count === 0) throw missing();
        return NextResponse.json({ ok: true });
    },
);
