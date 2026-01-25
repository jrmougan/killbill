import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { cookies } from 'next/headers';

export async function POST(request: Request) {
    const cookieStore = await cookies();
    const userId = cookieStore.get('user_id')?.value;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { code } = body;

    const couple = await prisma.couple.findUnique({
        where: { code: code.toUpperCase() },
        include: { members: true }
    });

    if (!couple) return NextResponse.json({ error: 'Código inválido' }, { status: 404 });
    if (couple.members.length >= 2) return NextResponse.json({ error: 'Esta pareja ya está completa' }, { status: 400 });

    await prisma.user.update({
        where: { id: userId },
        data: { coupleId: couple.id }
    });

    return NextResponse.json({ success: true });
}
