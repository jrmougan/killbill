'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { ACTIVE_GROUP_COOKIE } from '@/lib/membership';

/**
 * Set the caller's active group (multi-group, F4). Validates the user has an
 * ACTIVE membership in the target group, stores it in the `active_group` cookie,
 * and revalidates so every group-scoped surface re-renders in the new context.
 */
export async function setActiveGroup(groupId: string): Promise<{ ok: boolean }> {
    const session = await getSession();
    if (!session?.userId) return { ok: false };
    const userId = session.userId as string;

    const membership = await prisma.membership.findFirst({
        where: { userId, groupId, status: 'ACTIVE' },
        select: { id: true },
    });
    if (!membership) return { ok: false };

    const cookieStore = await cookies();
    cookieStore.set(ACTIVE_GROUP_COOKIE, groupId, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 365, // 1 year
    });

    revalidatePath('/', 'layout');
    return { ok: true };
}
