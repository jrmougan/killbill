import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function POST(request: Request) {
    try {
        const session = await getSession();
        if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const userId = session.userId as string;

        const body = await request.json();
        const { code } = body;

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { coupleId: true }
        });

        if (user?.coupleId) {
            return NextResponse.json({ error: 'Ya perteneces a una pareja' }, { status: 400 });
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
                const fresh = await tx.user.findUnique({ where: { id: userId }, select: { coupleId: true } });
                if (fresh?.coupleId) throw new Error('ALREADY_IN_COUPLE');

                const memberCount = await tx.user.count({ where: { coupleId: couple.id } });
                if (memberCount >= 2) throw new Error('COUPLE_FULL');

                await tx.user.update({
                    where: { id: userId },
                    data: { coupleId: couple.id }
                });
            });
        } catch (e) {
            if (e instanceof Error && e.message === 'ALREADY_IN_COUPLE') {
                return NextResponse.json({ error: 'Ya perteneces a una pareja' }, { status: 400 });
            }
            if (e instanceof Error && e.message === 'COUPLE_FULL') {
                return NextResponse.json({ error: 'Esta pareja ya está completa' }, { status: 400 });
            }
            throw e;
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error al unirse a la pareja:', error);
        return NextResponse.json({ error: 'Error al unirse a la pareja' }, { status: 500 });
    }
}
