import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function DELETE(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const session = await getSession();
    if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = session.userId as string;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.coupleId) return NextResponse.json({ error: 'No Couple' }, { status: 400 });

    const tag = await prisma.tag.findUnique({ where: { id } });
    if (!tag) return NextResponse.json({ error: 'Tag not found' }, { status: 404 });

    if (tag.coupleId !== user.coupleId) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
    }

    await prisma.tag.delete({ where: { id } });

    return NextResponse.json({ success: true });
}
