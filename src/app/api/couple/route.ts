import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getActiveGroup, getGroupMembers, ACTIVE_GROUP_COOKIE } from '@/lib/membership';
import { randomBytes } from 'crypto';
import { route } from '@/lib/http';
import { jsonObject } from '@/lib/http/schemas';

const PUBLIC_SPACE_SELECT = {
    id: true,
    name: true,
    type: true,
    status: true,
    createdAt: true,
    archivedAt: true,
    expiresAt: true,
} as const;

/** Legacy create body: an optional name ("" / null / absent → "Mi grupo"). */
const CreateCoupleBody = jsonObject({ name: z.string({ error: 'Nombre no válido' }).nullish() });

export const GET = route({ auth: 'user' }, async ({ ctx }) => {
    const userId = ctx.userId;

    // Resolve the caller's ACTIVE group + members via the Membership layer (F4).
    const groupId = await getActiveGroup(userId);
    if (!groupId) return NextResponse.json({ couple: null, userId });

    // Explicit projection: never the legacy `Couple.code` (not an invitation any
    // more) and members only as the public shape (no password/pin/email).
    const [couple, members] = await Promise.all([
        prisma.couple.findUnique({ where: { id: groupId }, select: PUBLIC_SPACE_SELECT }),
        getGroupMembers(groupId),
    ]);
    if (!couple) return NextResponse.json({ couple: null, userId });

    return NextResponse.json({ couple: { ...couple, members }, userId });
});

/**
 * @deprecated Fase 1: use POST /api/spaces with an explicit `type` instead. This
 * endpoint is kept as an alias that always creates a COUPLE-typed space so old
 * clients keep working.
 */
export const POST = route({ auth: 'user', body: CreateCoupleBody }, async ({ ctx, body }) => {
    const userId = ctx.userId;

    // F4 (multi-group): no blanket "already in a group" block — a user may own or
    // belong to several groups.
    const { name } = body;

    // Generate cryptographically random code for invite
    const code = randomBytes(3).toString('hex').toUpperCase();

    // Create the couple and the creator's OWNER membership atomically. Phase 5
    // (WS1 write-stop): the Membership is the sole linkage — the couple.create no
    // longer connects User.coupleId.
    const couple = await prisma.$transaction(async (tx) => {
        const created = await tx.couple.create({
            select: PUBLIC_SPACE_SELECT,
            data: {
                name: name || "Mi grupo",
                code: code,
                // Deprecated alias: always a COUPLE (also the column default).
                type: 'COUPLE',
                createdById: userId,
            }
        });
        await tx.membership.create({
            data: { groupId: created.id, userId, role: 'OWNER', status: 'ACTIVE' }
        });
        return created;
    });

    // F4: make the newly-created group the active one.
    (await cookies()).set(ACTIVE_GROUP_COOKIE, couple.id, {
        httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365,
    });

    return NextResponse.json({ success: true, couple });
});
