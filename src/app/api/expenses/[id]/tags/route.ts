import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionCtx } from '@/lib/authz';
import { getGroupMembers } from '@/lib/membership';

async function getExpenseAndVerifyMembership(expenseId: string, userId: string) {
    const expense = await prisma.expense.findUnique({ where: { id: expenseId } });
    if (!expense) return { expense: null, authorized: false };
    // Personal: owner-only. Shared: current couple membership via the Membership
    // layer (Phase 5 WS1) — no lingering owner access after unlinking.
    const members = expense.coupleId ? await getGroupMembers(expense.coupleId) : [];
    const isMember = members.some((m) => m.id === userId);
    const authorized = expense.visibility === 'PERSONAL' ? expense.ownerId === userId : isMember;
    return { expense, authorized };
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id: expenseId } = await params;
    // getSessionCtx revalidates guest sessions (expelled guest / archived trip)
    // and the tokenVersion of registered ones.
    const ctx = await getSessionCtx();
    if (!ctx) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    const userId = ctx.userId;

    const { expense, authorized } = await getExpenseAndVerifyMembership(expenseId, userId);
    if (!expense) return NextResponse.json({ error: 'Gasto no encontrado' }, { status: 404 });
    if (!authorized) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

    const body = await request.json().catch(() => null);
    const tagId = body?.tagId;
    if (!tagId || typeof tagId !== 'string') return NextResponse.json({ error: 'Falta la etiqueta' }, { status: 400 });

    // The tag must belong to the expense's scope: the same space for a shared
    // expense, the caller's personal tags for a personal one (G-07).
    const tag = await prisma.tag.findUnique({ where: { id: tagId } });
    const sameScope = !!tag && (expense.visibility === 'PERSONAL'
        ? tag.coupleId === null && tag.ownerId === userId
        : tag.coupleId !== null && tag.coupleId === expense.coupleId);
    if (!sameScope) {
        return NextResponse.json({ error: 'Etiqueta no encontrada en este espacio' }, { status: 404 });
    }

    // Idempotent: tagging twice is not an error.
    const already = await prisma.expenseTag.findFirst({ where: { expenseId, tagId }, select: { expenseId: true } });
    if (already) return NextResponse.json({ success: true }, { status: 200 });

    await prisma.expenseTag.create({
        data: { expenseId, tagId },
    });

    return NextResponse.json({ success: true }, { status: 201 });
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id: expenseId } = await params;
    // getSessionCtx revalidates guest sessions (expelled guest / archived trip)
    // and the tokenVersion of registered ones.
    const ctx = await getSessionCtx();
    if (!ctx) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    const userId = ctx.userId;

    const { expense, authorized } = await getExpenseAndVerifyMembership(expenseId, userId);
    if (!expense) return NextResponse.json({ error: 'Gasto no encontrado' }, { status: 404 });
    if (!authorized) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

    const body = await request.json();
    const { tagId } = body;
    if (!tagId) return NextResponse.json({ error: 'Falta la etiqueta' }, { status: 400 });

    // Idempotent delete: a missing expenseTag must not 500.
    const { count } = await prisma.expenseTag.deleteMany({
        where: { expenseId, tagId },
    });
    if (count === 0) {
        return NextResponse.json({ error: 'El gasto no tiene esa etiqueta' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
}
