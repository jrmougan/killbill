import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getPrimaryGroup } from '@/lib/membership';
import { materializeDueRecurringExpenses } from '@/lib/recurring';

export async function POST() {
    const session = await getSession();
    if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = session.userId as string;

    // Phase 4 selector switch: resolve my group via the Membership layer.
    const groupId = await getPrimaryGroup(userId);
    if (!groupId) return NextResponse.json({ error: 'No Couple' }, { status: 400 });

    const created = await materializeDueRecurringExpenses(groupId);

    return NextResponse.json({ created });
}
