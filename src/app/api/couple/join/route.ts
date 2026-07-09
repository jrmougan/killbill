import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getPrimaryGroup, MAX_GROUP_MEMBERS } from '@/lib/membership';

export async function POST(request: Request) {
    try {
        const session = await getSession();
        if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const userId = session.userId as string;

        const body = await request.json();
        const { code } = body;

        // Phase 4 selector switch: "am I already in a group?" reads the
        // Membership layer. The transactional re-check below stays on coupleId
        // (write-side TOCTOU guard) until the gated User.coupleId drop.
        if (await getPrimaryGroup(userId)) {
            return NextResponse.json({ error: 'Ya perteneces a un grupo' }, { status: 400 });
        }

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
                    where: { userId, status: 'ACTIVE' },
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
                return NextResponse.json({ error: 'Ya perteneces a un grupo' }, { status: 400 });
            }
            if (e instanceof Error && e.message === 'COUPLE_FULL') {
                return NextResponse.json({ error: 'Este grupo ya está completo' }, { status: 400 });
            }
            throw e;
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error al unirse al grupo:', error);
        return NextResponse.json({ error: 'Error al unirse al grupo' }, { status: 500 });
    }
}
