import { NextResponse } from 'next/server';
import { getSessionCtx, requireSpaceAccess } from '@/lib/authz';
import { getActiveGroup } from '@/lib/membership';
import { materializeDueRecurringExpenses } from '@/lib/recurring';

export async function POST() {
    const ctx = await getSessionCtx();
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = ctx.userId;

    // Phase 4 selector switch: resolve my group via the Membership layer.
    const groupId = await getActiveGroup(userId);
    if (!groupId) return NextResponse.json({ error: 'No Couple' }, { status: 400 });

    // Fase 1: materializing recurring expenses WRITES new expenses, so require an
    // ACTIVE (writable) space — no catch-up bursts into a SETTLING/ARCHIVED space.
    const auth = await requireSpaceAccess(ctx, groupId);
    if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });

    const created = await materializeDueRecurringExpenses(groupId);

    return NextResponse.json({ created });
}
