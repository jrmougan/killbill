import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getPrimaryGroup } from '@/lib/membership';

export async function GET() {
    const session = await getSession();
    if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = session.userId as string;

    // Phase 4 selector switch: resolve my group via the Membership layer.
    const groupId = await getPrimaryGroup(userId);
    if (!groupId) return NextResponse.json({ tags: [] });

    const tags = await prisma.tag.findMany({
        where: { coupleId: groupId },
        orderBy: { name: 'asc' },
    });

    return NextResponse.json({ tags });
}

export async function POST(request: Request) {
    try {
        const session = await getSession();
        if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const userId = session.userId as string;

        const groupId = await getPrimaryGroup(userId);
        if (!groupId) return NextResponse.json({ error: 'No Couple' }, { status: 400 });

        const body = await request.json();
        const { name, color } = body;

        if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });

        const tag = await prisma.tag.create({
            data: {
                name,
                color: color || '#8b5cf6',
                coupleId: groupId,
            },
        });

        return NextResponse.json({ tag }, { status: 201 });
    } catch (error) {
        console.error('Error al crear la etiqueta:', error);
        return NextResponse.json({ error: 'Error al crear la etiqueta' }, { status: 500 });
    }
}
