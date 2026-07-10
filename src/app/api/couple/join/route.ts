import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { MAX_GROUP_MEMBERS, ACTIVE_GROUP_COOKIE } from '@/lib/membership';

export async function POST(request: Request) {
    try {
        const session = await getSession();
        if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const userId = session.userId as string;

        const body = await request.json();
        const { code } = body;

        // F4 (multi-group): a user may belong to several groups, so there is no
        // blanket "already in a group" block — only a per-group idempotency guard.
        const couple = await prisma.couple.findUnique({
            where: { code: code.toUpperCase() },
            select: { id: true }
        });

        if (!couple) return NextResponse.json({ error: 'Código inválido' }, { status: 404 });

        // Re-check membership and the caller's couple inside a transaction to close the
        // TOCTOU window where two users could join simultaneously and exceed the cap of 2.
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

                const memberCount = await tx.membership.count({
                    where: { groupId: couple.id, status: 'ACTIVE' },
                });
                if (memberCount >= MAX_GROUP_MEMBERS) throw new Error('COUPLE_FULL');

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
            if (e instanceof Error && e.message === 'COUPLE_FULL') {
                return NextResponse.json({ error: 'Este grupo ya está completo' }, { status: 400 });
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
