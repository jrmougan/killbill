import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { forbidden, notFound, requireSpace, route } from '@/lib/http';
import { idParams } from '@/lib/http/schemas';

export const DELETE = route({ auth: 'user', params: idParams }, async ({ ctx, params: { id } }) => {
    const tag = await prisma.tag.findUnique({ where: { id } });
    if (!tag) throw notFound('Etiqueta no encontrada');

    // Fase 1: authorize against the tag's OWN scope, never the active-group cookie.
    // A personal tag (ownerId) is authorized by ownership; a group tag (coupleId)
    // by ACTIVE membership in THAT group (allowArchived: deleting a tag is a
    // housekeeping action valid even on a read-only archived space).
    if (tag.ownerId) {
        if (tag.ownerId !== ctx.userId) throw forbidden('No autorizado');
    } else if (tag.coupleId) {
        await requireSpace(ctx, tag.coupleId, { allowArchived: true });
    } else {
        throw forbidden('No autorizado');
    }

    await prisma.tag.delete({ where: { id } });

    return NextResponse.json({ success: true });
});
