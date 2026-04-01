import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function GET() {
    const session = await getSession();
    if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = session.userId as string;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.coupleId) return NextResponse.json({ tags: [] });

    const tags = await prisma.tag.findMany({
        where: { coupleId: user.coupleId },
        orderBy: { name: 'asc' },
    });

    return NextResponse.json({ tags });
}

export async function POST(request: Request) {
    const session = await getSession();
    if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = session.userId as string;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.coupleId) return NextResponse.json({ error: 'No Couple' }, { status: 400 });

    const body = await request.json();
    const { name, color } = body;

    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });

    const tag = await prisma.tag.create({
        data: {
            name,
            color: color || '#8b5cf6',
            coupleId: user.coupleId,
        },
    });

    return NextResponse.json({ tag }, { status: 201 });
}
