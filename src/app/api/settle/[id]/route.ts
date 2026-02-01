import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;

    const session = await getSession();
    if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = session.userId as string;

    const body = await request.json();
    const { method, expenseIds } = body;

    const settlement = await prisma.settlement.findUnique({
        where: { id },
        include: { couple: { include: { members: true } } }
    });

    if (!settlement) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (settlement.fromUserId !== userId) {
        return NextResponse.json({ error: 'Only the creator can edit' }, { status: 403 });
    }

    try {
        await prisma.$transaction(async (tx) => {
            // 1. Unlink current expenses
            await tx.expense.updateMany({
                where: { settlementId: id },
                data: { settlementId: null }
            });

            let newAmount = 0;

            if (expenseIds && Array.isArray(expenseIds) && expenseIds.length > 0) {
                // 2. Link new expenses
                await tx.expense.updateMany({
                    where: {
                        id: { in: expenseIds },
                        coupleId: settlement.coupleId
                    },
                    data: { settlementId: id }
                });

                // 3. Recalculate amount
                const linkedExpenses = await tx.expense.findMany({
                    where: { id: { in: expenseIds } },
                    include: { splits: true }
                });

                // Calculate total amount based on splits or 50/50
                const numMembers = settlement.couple.members.length;
                newAmount = linkedExpenses.reduce((sum, exp) => {
                    if (exp.splits.length > 0) {
                        const mySplit = exp.splits.find(s => s.userId === userId);
                        return sum + (mySplit?.amount || 0);
                    }
                    return sum + (exp.amount / numMembers);
                }, 0);
            }

            // 4. Update settlement
            await tx.settlement.update({
                where: { id },
                data: {
                    method: method || settlement.method,
                    amount: newAmount,
                    // If edited, maybe reset status to PENDING if it was REJECTED? 
                    // Let's keep it simple for now.
                    status: "PENDING"
                }
            });
        });

        return NextResponse.json({ success: true });
    } catch (e) {
        console.error(e);
        return NextResponse.json({ error: 'Update failed' }, { status: 500 });
    }
}
