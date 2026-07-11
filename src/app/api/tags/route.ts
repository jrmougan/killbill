import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getActiveGroup } from '@/lib/membership';

export async function GET() {
    const session = await getSession();
    if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = session.userId as string;

    // Phase 4 selector switch: resolve my group via the Membership layer.
    // Fase 1: a user always sees their PERSONAL tags (ownerId), plus the tags of
    // their active group when they belong to one. A user with no group still gets
    // their personal tags (personal-mode is operative).
    const groupId = await getActiveGroup(userId);

    const tags = await prisma.tag.findMany({
        where: groupId
            ? { OR: [{ coupleId: groupId }, { ownerId: userId }] }
            : { ownerId: userId },
        orderBy: { name: 'asc' },
    });

    return NextResponse.json({ tags });
}

export async function POST(request: Request) {
    try {
        const session = await getSession();
        if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const userId = session.userId as string;

        const body = await request.json();
        const { name, color, personal } = body;

        if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });

        // Fase 1: a tag is EITHER group-scoped (coupleId, XOR ownerId) OR personal
        // (ownerId, so a PERSONAL expense can carry a tag). `personal: true` forces
        // the personal variant; otherwise it's a group tag and requires a group.
        const isPersonal = personal === true;
        if (!isPersonal) {
            const groupId = await getActiveGroup(userId);
            if (!groupId) return NextResponse.json({ error: 'No Couple' }, { status: 400 });

            const tag = await prisma.tag.create({
                data: {
                    name,
                    color: color || '#8b5cf6',
                    coupleId: groupId,
                },
            });
            return NextResponse.json({ tag }, { status: 201 });
        }

        const tag = await prisma.tag.create({
            data: {
                name,
                color: color || '#8b5cf6',
                ownerId: userId,
            },
        });
        return NextResponse.json({ tag }, { status: 201 });
    } catch (error) {
        console.error('Error al crear la etiqueta:', error);
        return NextResponse.json({ error: 'Error al crear la etiqueta' }, { status: 500 });
    }
}
