import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getActiveGroup } from '@/lib/membership';
import { toCents, parseEuroInput } from '@/lib/currency';
import { resolveCategoryId } from '@/lib/category-db';
import { categoryKeyOf, CATEGORY_REF_SELECT } from '@/lib/category-read';
import { getSessionCtx, requireSpaceAccess, type SessionCtx } from '@/lib/authz';
import { allowsBudgetsAndRecurring } from '@/lib/space-policy';
import type { SpaceType } from '@/generated/prisma/enums';

/** Upper bound for a single budget: 1.000.000 € (fits the INT `amount` column). */
const MAX_BUDGET_CENTS = 100_000_000;

type Scope = 'personal' | 'shared';
type Fail = { ok: false; res: NextResponse };

const json = (body: unknown, status: number) => NextResponse.json(body, { status });

/**
 * Budgets are a member/personal surface: a GUEST session (caged to an ephemeral
 * trip, where budgets are vetoed anyway) never reads or writes them. The proxy
 * already blocks /api/budget for guests; this is the defense in depth.
 */
async function caller(): Promise<{ ok: true; ctx: SessionCtx } | Fail> {
    const ctx = await getSessionCtx();
    if (!ctx) return { ok: false, res: json({ error: 'No autorizado' }, 401) };
    if (ctx.kind === 'guest') return { ok: false, res: json({ error: 'Acción no permitida para invitados' }, 403) };
    return { ok: true, ctx };
}

/**
 * Resolve + authorize the shared space a budget call targets. An explicit
 * `groupId` (query/body) wins over the `active_group` UI cookie; either way the
 * caller is authorized against THAT group with `requireSpaceAccess` (DB
 * membership, guests denied). Writes (`write: true`) also require the space to
 * be ACTIVE (SETTLING/ARCHIVED → 409 SPACE_NOT_WRITABLE) and a type that allows
 * budgets (EPHEMERAL vetoes them).
 */
async function sharedSpace(
    ctx: SessionCtx,
    explicitGroupId: unknown,
    write: boolean,
): Promise<{ ok: true; groupId: string } | Fail> {
    const groupId = typeof explicitGroupId === 'string' && explicitGroupId
        ? explicitGroupId
        : await getActiveGroup(ctx.userId);
    if (!groupId) {
        return { ok: false, res: json({ error: 'No perteneces a ningún espacio compartido', code: 'NO_SPACE' }, 400) };
    }
    const auth = await requireSpaceAccess(ctx, groupId, { allowArchived: !write });
    if (!auth.ok) return { ok: false, res: json({ error: auth.error, code: auth.code }, auth.status) };
    if (write && !allowsBudgetsAndRecurring(auth.space.type as SpaceType)) {
        return {
            ok: false,
            res: json({ error: 'Este tipo de espacio no admite presupuestos', code: 'BUDGETS_NOT_ALLOWED' }, 400),
        };
    }
    return { ok: true, groupId };
}

/**
 * Parse a budget amount in EUROS (number, or an es-ES string like "1.234,56")
 * into integer cents, enforcing (0, MAX_BUDGET_CENTS]. Returns an error message
 * instead of throwing so an absurd value is a 400, never a DB overflow 500.
 */
function parseBudgetAmount(amount: unknown): { ok: true; cents: number } | { ok: false; error: string } {
    let cents: number | null = null;
    if (typeof amount === 'number' && Number.isFinite(amount)) cents = toCents(amount);
    else if (typeof amount === 'string') cents = parseEuroInput(amount);
    if (cents === null || !Number.isSafeInteger(cents)) {
        return { ok: false, error: 'El importe no es válido' };
    }
    if (cents <= 0) return { ok: false, error: 'El importe debe ser de al menos 0,01 €' };
    if (cents > MAX_BUDGET_CENTS) return { ok: false, error: 'El importe máximo de un presupuesto es 1.000.000 €' };
    return { ok: true, cents };
}

export async function GET(request: Request) {
    const who = await caller();
    if (!who.ok) return who.res;
    const userId = who.ctx.userId;

    const { searchParams } = new URL(request.url);
    const scope: Scope = searchParams.get('scope') === 'personal' ? 'personal' : 'shared';

    // Shared budgets need a space; personal budgets work for any user. The space
    // is authorized against its DB membership (read: SETTLING/ARCHIVED allowed).
    let groupId: string | null = null;
    if (scope === 'shared') {
        const explicit = searchParams.get('groupId');
        if (!explicit && !(await getActiveGroup(userId))) return NextResponse.json({ budgets: [] });
        const space = await sharedSpace(who.ctx, explicit, false);
        if (!space.ok) return space.res;
        groupId = space.groupId;
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
}

/**
 * POST /api/budget {category, amount (euros), month?: 'YYYY-MM', scope?, groupId?}
 * Upsert one monthly budget. `groupId` (optional) targets a specific shared
 * space; without it the active space is used. Either way the caller must be an
 * ACTIVE non-guest member of a writable space that allows budgets.
 */
export async function POST(request: Request) {
    try {
        const who = await caller();
        if (!who.ok) return who.res;
        const userId = who.ctx.userId;

        let body: Record<string, unknown>;
        try {
            body = await request.json();
        } catch {
            return json({ error: 'Cuerpo de la petición no válido' }, 400);
        }
        if (!body || typeof body !== 'object') return json({ error: 'Cuerpo de la petición no válido' }, 400);
        const { category, amount, month, groupId: bodyGroupId } = body;
        const scope: Scope = body.scope === 'personal' ? 'personal' : 'shared';

        if (typeof category !== 'string' || !category || amount === undefined || amount === null) {
            return json({ error: 'La categoría y el importe son obligatorios' }, 400);
        }

        const parsed = parseBudgetAmount(amount);
        if (!parsed.ok) return json({ error: parsed.error, code: 'INVALID_AMOUNT' }, 400);
        const amountCents = parsed.cents;

        // Parse month (YYYY-MM) or default to the current month.
        let monthDate: Date;
        if (month !== undefined && month !== null && month !== '') {
            const m = typeof month === 'string' ? /^(\d{4})-(\d{2})$/.exec(month) : null;
            const year = m ? Number(m[1]) : NaN;
            const mon = m ? Number(m[2]) : NaN;
            if (!m || mon < 1 || mon > 12 || year < 2000 || year > 2100) {
                return json({ error: 'El mes no es válido (formato AAAA-MM)' }, 400);
            }
            monthDate = new Date(year, mon - 1, 1);
        } else {
            const now = new Date();
            monthDate = new Date(now.getFullYear(), now.getMonth(), 1);
        }

        // Shared budgets: authorize against the target space (writable, member,
        // no guests). Personal budgets are scoped by ownerId only.
        let groupId: string | null = null;
        if (scope === 'shared') {
            const space = await sharedSpace(who.ctx, bodyGroupId, true);
            if (!space.ok) return space.res;
            groupId = space.groupId;
        }

        // No hardcoded whitelist: the category is validated against the EFFECTIVE
        // set of the scope (null → 400), so a custom category is accepted and an
        // unknown key is rejected.
        const categoryId = await resolveCategoryId(category, scope === 'personal' ? { ownerId: userId } : { groupId });
        if (!categoryId) return json({ error: 'La categoría no existe', code: 'INVALID_CATEGORY' }, 400);

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
    } catch (error) {
        console.error('Error al guardar el presupuesto:', error);
        return json({ error: 'No se pudo guardar el presupuesto' }, 500);
    }
}

/**
 * DELETE /api/budget?id=<budgetId>[&scope=shared|personal] — remove one budget
 * (EQUIL "Mes" sheet → "Eliminar"). Authorized against the BUDGET's own scope,
 * never the active-group cookie: a personal budget must belong to the caller
 * (`ownerId`); a shared one requires ACTIVE non-guest membership in ITS space,
 * which must be writable (SETTLING/ARCHIVED → 409 SPACE_NOT_WRITABLE). A
 * foreign/unknown id is a 404 (no existence leak), and the delete itself stays
 * conditional on the scope (`deleteMany` by id + owner/space).
 */
export async function DELETE(request: Request) {
    try {
        const who = await caller();
        if (!who.ok) return who.res;
        const userId = who.ctx.userId;

        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');
        if (!id) return json({ error: 'Falta el identificador del presupuesto' }, 400);
        const scopeParam = searchParams.get('scope');

        const notFound = () => json({ error: 'Presupuesto no encontrado' }, 404);
        const budget = await prisma.budget.findUnique({
            where: { id },
            select: { id: true, ownerId: true, coupleId: true },
        });
        if (!budget) return notFound();

        let where: { id: string; ownerId: string } | { id: string; coupleId: string };
        if (budget.ownerId) {
            if (budget.ownerId !== userId || scopeParam === 'shared') return notFound();
            where = { id, ownerId: userId };
        } else if (budget.coupleId) {
            if (scopeParam === 'personal') return notFound();
            const auth = await requireSpaceAccess(who.ctx, budget.coupleId);
            if (!auth.ok) {
                // Not a member of that space → indistinguishable from "no such budget".
                if (auth.status === 403 || auth.status === 404) return notFound();
                return json({ error: auth.error, code: auth.code }, auth.status);
            }
            where = { id, coupleId: budget.coupleId };
        } else {
            return notFound();
        }

        const { count } = await prisma.budget.deleteMany({ where });
        if (count === 0) return notFound();
        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error('Error al eliminar el presupuesto:', error);
        return json({ error: 'No se pudo eliminar el presupuesto' }, 500);
    }
}
