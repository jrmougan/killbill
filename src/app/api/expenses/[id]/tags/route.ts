import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';

async function getExpenseAndVerifyMembership(expenseId: string, userId: string) {
    const expense = await prisma.expense.findUnique({
        where: { id: expenseId },
        include: { couple: { include: { members: true } } },
    });
    if (!expense) return { expense: null, authorized: false };
    const authorized = expense.couple.members.some((m) => m.id === userId);
    return { expense, authorized };
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id: expenseId } = await params;
    const session = await getSession();
    if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = session.userId as string;

    const { expense, authorized } = await getExpenseAndVerifyMembership(expenseId, userId);
    if (!expense) return NextResponse.json({ error: 'Gasto no encontrado' }, { status: 404 });
    if (!authorized) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

    const body = await request.json();
    const { tagId } = body;
    if (!tagId) return NextResponse.json({ error: 'tagId is required' }, { status: 400 });

    // Verify tag belongs to same couple
    const tag = await prisma.tag.findUnique({ where: { id: tagId } });
    if (!tag || tag.coupleId !== expense.coupleId) {
        return NextResponse.json({ error: 'Tag not found or not authorized' }, { status: 404 });
    }

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
    const session = await getSession();
    if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = session.userId as string;

    const { expense, authorized } = await getExpenseAndVerifyMembership(expenseId, userId);
    if (!expense) return NextResponse.json({ error: 'Gasto no encontrado' }, { status: 404 });
    if (!authorized) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

    const body = await request.json();
    const { tagId } = body;
    if (!tagId) return NextResponse.json({ error: 'tagId is required' }, { status: 400 });

    await prisma.expenseTag.delete({
        where: { expenseId_tagId: { expenseId, tagId } },
    });

    return NextResponse.json({ success: true });
}
