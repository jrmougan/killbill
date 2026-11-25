import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getGroupMembers } from '@/lib/membership';
import { forbidden, notFound, parseJson, route } from '@/lib/http';
import { idParams, jsonObject } from '@/lib/http/schemas';

const MISSING_TAG = 'Falta la etiqueta';
const TagBody = jsonObject({ tagId: z.string({ error: MISSING_TAG }).min(1, MISSING_TAG) }, MISSING_TAG);

/** 404 / 403 unless the caller may tag this expense. */
async function loadAuthorizedExpense(expenseId: string, userId: string) {
    const expense = await prisma.expense.findUnique({ where: { id: expenseId } });
    if (!expense) throw notFound('Gasto no encontrado');
    // Personal: owner-only. Shared: current couple membership via the Membership
    // layer (Phase 5 WS1) — no lingering owner access after unlinking.
    const members = expense.coupleId ? await getGroupMembers(expense.coupleId) : [];
    const isMember = members.some((m) => m.id === userId);
    const authorized = expense.visibility === 'PERSONAL' ? expense.ownerId === userId : isMember;
    if (!authorized) throw forbidden('No autorizado');
    return expense;
}

// getSessionCtx (in route()) revalidates guest sessions (expelled guest /
// archived trip) and the tokenVersion of registered ones. The body is parsed
// AFTER the expense authz so a stranger learns nothing from validation errors.
export const POST = route(
    { auth: 'user-or-guest', params: idParams },
    async ({ req, ctx, params: { id: expenseId } }) => {
        const userId = ctx.userId;
        const expense = await loadAuthorizedExpense(expenseId, userId);
        const { tagId } = await parseJson(req, TagBody);

        // The tag must belong to the expense's scope: the same space for a shared
        // expense, the caller's personal tags for a personal one (G-07).
        const tag = await prisma.tag.findUnique({ where: { id: tagId } });
        const sameScope = !!tag && (expense.visibility === 'PERSONAL'
            ? tag.coupleId === null && tag.ownerId === userId
            : tag.coupleId !== null && tag.coupleId === expense.coupleId);
        if (!sameScope) throw notFound('Etiqueta no encontrada en este espacio');

        // Idempotent: tagging twice is not an error.
        const already = await prisma.expenseTag.findFirst({ where: { expenseId, tagId }, select: { expenseId: true } });
        if (already) return NextResponse.json({ success: true }, { status: 200 });

        await prisma.expenseTag.create({
            data: { expenseId, tagId },
        });

        return NextResponse.json({ success: true }, { status: 201 });
    },
);

export const DELETE = route(
    { auth: 'user-or-guest', params: idParams },
    async ({ req, ctx, params: { id: expenseId } }) => {
        await loadAuthorizedExpense(expenseId, ctx.userId);
        const { tagId } = await parseJson(req, TagBody);

        // Idempotent delete: a missing expenseTag must not 500.
        const { count } = await prisma.expenseTag.deleteMany({
            where: { expenseId, tagId },
        });
        if (count === 0) throw notFound('El gasto no tiene esa etiqueta');

        return NextResponse.json({ success: true });
    },
);
