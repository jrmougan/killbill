import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getActiveGroup } from '@/lib/membership';
import { getSessionCtx, requireSpaceAccess } from '@/lib/authz';

/** Longest tag name accepted (keeps chips readable and well under the column limit). */
const MAX_TAG_NAME_LEN = 40;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_COLOR = '#8b5cf6';

const json = (body: unknown, status: number) => NextResponse.json(body, { status });

function isUniqueViolation(e: unknown): boolean {
    return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}

/**
 * GET /api/tags — the caller's PERSONAL tags plus the tags of its active space.
 * A GUEST session only ever sees the tags of the space it is caged to (no
 * personal surface).
 */
export async function GET() {
    const ctx = await getSessionCtx();
    if (!ctx) return json({ error: 'No autorizado' }, 401);

    if (ctx.kind === 'guest') {
        const tags = ctx.groupId
            ? await prisma.tag.findMany({ where: { coupleId: ctx.groupId }, orderBy: { name: 'asc' } })
            : [];
        return NextResponse.json({ tags });
    }

    const userId = ctx.userId;
    const groupId = await getActiveGroup(userId);
    const tags = await prisma.tag.findMany({
        where: groupId
            ? { OR: [{ coupleId: groupId }, { ownerId: userId }] }
            : { ownerId: userId },
        orderBy: { name: 'asc' },
    });

    return NextResponse.json({ tags });
}

/**
 * POST /api/tags {name, color?, personal?, groupId?}
 * A tag is EITHER personal (`ownerId`) or space-scoped (`coupleId`). A space tag
 * targets `groupId` when given (else the active space) and requires ACTIVE,
 * non-guest membership in that writable space. Guests never create tags.
 * Errors: 400 invalid input, 403 guest/non-member, 409 duplicate name.
 */
export async function POST(request: Request) {
    const ctx = await getSessionCtx();
    if (!ctx) return json({ error: 'No autorizado' }, 401);
    if (ctx.kind === 'guest') return json({ error: 'Acción no permitida para invitados' }, 403);
    const userId = ctx.userId;

    let body: Record<string, unknown>;
    try {
        body = await request.json();
    } catch {
        return json({ error: 'Cuerpo de la petición no válido' }, 400);
    }
    if (!body || typeof body !== 'object') return json({ error: 'Cuerpo de la petición no válido' }, 400);

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return json({ error: 'El nombre de la etiqueta es obligatorio' }, 400);
    if (name.length > MAX_TAG_NAME_LEN) {
        return json({ error: `El nombre de la etiqueta no puede superar los ${MAX_TAG_NAME_LEN} caracteres` }, 400);
    }
    let color = DEFAULT_COLOR;
    if (body.color !== undefined && body.color !== null && body.color !== '') {
        if (typeof body.color !== 'string' || !HEX_COLOR.test(body.color)) {
            return json({ error: 'El color no es válido' }, 400);
        }
        color = body.color;
    }

    const duplicate = () =>
        json({ error: `Ya existe una etiqueta llamada «${name}»`, code: 'TAG_EXISTS' }, 409);

    try {
        if (body.personal === true) {
            // Personal tags have no DB unique (coupleId is NULL), so check explicitly.
            const existing = await prisma.tag.findFirst({ where: { ownerId: userId, name }, select: { id: true } });
            if (existing) return duplicate();
            const tag = await prisma.tag.create({ data: { name, color, ownerId: userId } });
            return json({ tag }, 201);
        }

        const groupId = typeof body.groupId === 'string' && body.groupId
            ? body.groupId
            : await getActiveGroup(userId);
        if (!groupId) {
            return json({ error: 'No perteneces a ningún espacio compartido', code: 'NO_SPACE' }, 400);
        }
        const auth = await requireSpaceAccess(ctx, groupId);
        if (!auth.ok) return json({ error: auth.error, code: auth.code }, auth.status);

        const existing = await prisma.tag.findFirst({ where: { coupleId: groupId, name }, select: { id: true } });
        if (existing) return duplicate();
        const tag = await prisma.tag.create({ data: { name, color, coupleId: groupId } });
        return json({ tag }, 201);
    } catch (error) {
        // Concurrent create of the same name loses the @@unique([name, coupleId]) race.
        if (isUniqueViolation(error)) return duplicate();
        console.error('Error al crear la etiqueta:', error);
        return json({ error: 'No se pudo crear la etiqueta' }, 500);
    }
}
