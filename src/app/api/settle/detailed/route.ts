import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { cookies } from 'next/headers';

export async function POST(request: Request) {
    const cookieStore = await cookies();
    const userId = cookieStore.get('user_id')?.value;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { fromUserId, toUserId, debts, payments, status } = body;

    // types:
    // debts: { expenseId: string, amount: number }[]
    // payments: { type: string, amount: number, description?: string, category?: string, expenseId?: string }[]

    if (!fromUserId || !toUserId || !debts || !payments) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Validation
    const totalDebt = debts.reduce((sum: number, d: any) => sum + d.amount, 0);
    const totalPayment = payments.reduce((sum: number, p: any) => sum + p.amount, 0);

    // Allow small floating point difference
    if (Math.abs(totalDebt - totalPayment) > 0.05) {
        return NextResponse.json({ error: 'Total debts and payments must match', details: { totalDebt, totalPayment } }, { status: 400 });
    }

    // Get Group ID from User
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.groupId) return NextResponse.json({ error: 'No Group' }, { status: 400 });

    try {
        const result = await prisma.$transaction(async (tx) => {
            // Create Settlement
            const settlement = await tx.settlement.create({
                data: {
                    fromUserId,
                    toUserId,
                    groupId: user.groupId!, // Asserted above
                    amount: totalPayment,
                    status: status || "PENDING",
                    debts: {
                        create: debts.map((d: any) => ({
                            expenseId: d.expenseId,
                            amount: d.amount
                        }))
                    },
                    payments: {
                        create: payments.map((p: any) => ({
                            type: p.type,
                            amount: p.amount,
                            description: p.description,
                            category: p.category,
                            expenseId: p.expenseId
                        }))
                    }
                }
            });

            // Update Status of implicatd Expenses (Debts and Credit-Expenses)
            // Mark as PARTIAL (or SETTLED if we tracked full amount, but PARTIAL is safer for now)
            // This allows us to visually indicate activity.
            const expenseIdsToUpdate = [
                ...debts.map((d: any) => d.expenseId),
                ...payments.filter((p: any) => p.expenseId).map((p: any) => p.expenseId!)
            ];

            if (expenseIdsToUpdate.length > 0) {
                await tx.expense.updateMany({
                    where: {
                        id: { in: expenseIdsToUpdate },
                        status: "OPEN"
                    },
                    data: { status: "PARTIAL" }
                });
            }

            return settlement;
        });

        return NextResponse.json({ success: true, settlementId: result.id });
    } catch (e) {
        console.error("Settlement Error:", e);
        return NextResponse.json({ error: 'Failed to process settlement' }, { status: 500 });
    }
}
