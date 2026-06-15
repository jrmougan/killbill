import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { materializeDueRecurringExpenses } from '@/lib/recurring';

export async function POST() {
    const session = await getSession();
    if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = session.userId as string;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.coupleId) return NextResponse.json({ error: 'No Couple' }, { status: 400 });

    const created = await materializeDueRecurringExpenses(user.coupleId);

    return NextResponse.json({ created });
}
