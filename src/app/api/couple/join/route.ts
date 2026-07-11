import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { ACTIVE_GROUP_COOKIE } from '@/lib/membership';
import { SPACE_CAPS, joinByCodeAllowed } from '@/lib/space-policy';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import type { SpaceType, SpaceStatus } from '@/generated/prisma/enums';

export async function POST(request: Request) {
    try {
        // Rate limit by client IP: the classic 6-hex code is brute-forceable, so
        // cap join attempts (10 / 5 min) regardless of which code is tried.
        const ip = getClientIp(request.headers);
        if (!rateLimit(`couple-join:${ip}`, 10, 5 * 60 * 1000).allowed) {
            return NextResponse.json(
                { error: 'Demasiados intentos. Inténtalo de nuevo más tarde.' },
                { status: 429 },
            );
        }

        const session = await getSession();
        if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const userId = session.userId as string;

        const body = await request.json();
        const { code } = body;

        // F4 (multi-group): a user may belong to several groups, so there is no
        // blanket "already in a group" block — only a per-group idempotency guard.
        const couple = await prisma.couple.findUnique({
            where: { code: code.toUpperCase() },
            select: { id: true, type: true, status: true }
        });

        if (!couple) return NextResponse.json({ error: 'Código inválido' }, { status: 404 });

        // Fase 1: join-by-code is only allowed for ACTIVE COUPLE/GROUP spaces.
        // EPHEMERAL uses expirable invite links; SETTLING/ARCHIVED are closed.
        if (!joinByCodeAllowed(couple.type as SpaceType, couple.status as SpaceStatus)) {
            return NextResponse.json(
                { error: 'Este espacio no admite unirse por código' },
                { status: 400 },
            );
        }

        // Re-check membership and the caller's couple inside a transaction to close the
        // TOCTOU window where two users could join simultaneously and exceed the cap.
        try {
            await prisma.$transaction(async (tx) => {
                // Phase 5 (WS1 write-stop): the TOCTOU guards read the Membership
                // layer and the Membership row is the sole write (User.coupleId is
                // no longer written).
                const existing = await tx.membership.findFirst({
                    where: { userId, groupId: couple.id, status: 'ACTIVE' },
                    select: { id: true },
                });
                if (existing) throw new Error('ALREADY_IN_COUPLE');

                // Fase 1: cap is per space type (COUPLE=2, GROUP/EPHEMERAL=20).
                const memberCount = await tx.membership.count({
                    where: { groupId: couple.id, status: 'ACTIVE' },
                });
                if (memberCount >= SPACE_CAPS[couple.type as SpaceType]) throw new Error('SPACE_FULL');

                // Upsert handles a previous LEFT rejoin.
                await tx.membership.upsert({
                    where: { groupId_userId: { groupId: couple.id, userId } },
                    create: { groupId: couple.id, userId, role: 'MEMBER', status: 'ACTIVE' },
                    update: { status: 'ACTIVE', leftAt: null },
                });
            });
        } catch (e) {
            if (e instanceof Error && e.message === 'ALREADY_IN_COUPLE') {
                return NextResponse.json({ error: 'Ya estás en este grupo' }, { status: 400 });
            }
            if (e instanceof Error && e.message === 'SPACE_FULL') {
                return NextResponse.json(
                    { error: 'Este espacio ya está completo', code: 'SPACE_FULL' },
                    { status: 400 },
                );
            }
            throw e;
        }

        // F4: make the just-joined group the active one.
        (await cookies()).set(ACTIVE_GROUP_COOKIE, couple.id, {
            httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365,
        });

        return NextResponse.json({ success: true, couple: { id: couple.id } });
    } catch (error) {
        console.error('Error al unirse al grupo:', error);
        return NextResponse.json({ error: 'Error al unirse al grupo' }, { status: 500 });
    }
}
