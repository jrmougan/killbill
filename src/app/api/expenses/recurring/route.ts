import { NextResponse } from 'next/server';
import { getActiveGroup } from '@/lib/membership';
import { materializeDueRecurringExpenses } from '@/lib/recurring';
import { badRequest, requireSpace, route } from '@/lib/http';

// Guests are denied (route auth 'user' — same 403 requireSpaceAccess gave them).
export const POST = route({ auth: 'user' }, async ({ ctx }) => {
    // Phase 4 selector switch: resolve my group via the Membership layer.
    const groupId = await getActiveGroup(ctx.userId);
    if (!groupId) throw badRequest('No perteneces a ningún espacio');

    // Fase 1: materializing recurring expenses WRITES new expenses, so require an
    // ACTIVE (writable) space — no catch-up bursts into a SETTLING/ARCHIVED space.
    await requireSpace(ctx, groupId);

    const created = await materializeDueRecurringExpenses(groupId);

    return NextResponse.json({ created });
});
