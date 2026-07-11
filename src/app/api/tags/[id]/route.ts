import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionCtx, requireSpaceAccess } from '@/lib/authz';

export async function DELETE(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const ctx = await getSessionCtx();
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const tag = await prisma.tag.findUnique({ where: { id } });
    if (!tag) return NextResponse.json({ error: 'Tag not found' }, { status: 404 });

    // Fase 1: authorize against the tag's OWN scope, never the active-group cookie.
    // A personal tag (ownerId) is authorized by ownership; a group tag (coupleId)
    // by ACTIVE membership in THAT group (allowArchived: deleting a tag is a
    // housekeeping action valid even on a read-only archived space).
    if (tag.ownerId) {
        if (tag.ownerId !== ctx.userId) {
            return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
        }
    } else if (tag.coupleId) {
        const auth = await requireSpaceAccess(ctx, tag.coupleId, { allowArchived: true });
        if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
    } else {
        return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
    }

    await prisma.tag.delete({ where: { id } });

    return NextResponse.json({ success: true });
}
