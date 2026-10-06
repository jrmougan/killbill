import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getActiveGroup } from '@/lib/membership';
import { badRequest, conflict, readJson, requireSpace, route, validate } from '@/lib/http';
import { jsonObject } from '@/lib/http/schemas';

/** Longest tag name accepted (keeps chips readable and well under the column limit). */
const MAX_TAG_NAME_LEN = 40;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_COLOR = '#8b5cf6';

const BODY_INVALID = 'Cuerpo de la petición no válido';
const NAME_REQUIRED = 'El nombre de la etiqueta es obligatorio';
const COLOR_INVALID = 'El color no es válido';

const CreateTagBody = jsonObject(
    {
        name: z
            .string({ error: NAME_REQUIRED })
            .trim()
            .min(1, NAME_REQUIRED)
            .max(MAX_TAG_NAME_LEN, `El nombre de la etiqueta no puede superar los ${MAX_TAG_NAME_LEN} caracteres`),
        /** null / "" / absent → the default colour. */
        color: z
            .union([z.string().regex(HEX_COLOR, COLOR_INVALID), z.literal(''), z.null()], { error: COLOR_INVALID })
            .optional()
            .transform((v) => v || DEFAULT_COLOR),
        /** Only `true` makes it personal (lenient, as always). */
        personal: z.unknown().optional().transform((v) => v === true),
        /** A non-empty string targets that space; anything else → the active space. */
        groupId: z.unknown().optional().transform((v) => (typeof v === 'string' && v ? v : null)),
    },
    BODY_INVALID,
);

function isUniqueViolation(e: unknown): boolean {
    return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}

/**
 * GET /api/tags — the caller's PERSONAL tags plus the tags of its active space.
 * A GUEST session only ever sees the tags of the space it is caged to (no
 * personal surface).
 */
export const GET = route({ auth: 'user-or-guest' }, async ({ ctx }) => {
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
});

/**
 * POST /api/tags {name, color?, personal?, groupId?}
 * A tag is EITHER personal (`ownerId`) or space-scoped (`coupleId`). A space tag
 * targets `groupId` when given (else the active space) and requires ACTIVE,
 * non-guest membership in that writable space. Guests never create tags.
 * Errors: 400 invalid input, 403 guest/non-member, 409 duplicate name.
 */
export const POST = route(
    { auth: 'user', errorMessage: 'No se pudo crear la etiqueta', logLabel: 'Error al crear la etiqueta:' },
    async ({ req, ctx }) => {
        const userId = ctx.userId;
        // Unparseable JSON keeps its historical message (so not options.body).
        const raw = await readJson(req).catch(() => {
            throw badRequest(BODY_INVALID);
        });
        const { name, color, personal, groupId: bodyGroupId } = validate(CreateTagBody, raw);

        const duplicate = () => conflict(`Ya existe una etiqueta llamada «${name}»`, 'TAG_EXISTS');

        try {
            if (personal) {
                // Personal tags have no DB unique (coupleId is NULL), so check explicitly.
                const existing = await prisma.tag.findFirst({ where: { ownerId: userId, name }, select: { id: true } });
                if (existing) throw duplicate();
                const tag = await prisma.tag.create({ data: { name, color, ownerId: userId } });
                return NextResponse.json({ tag }, { status: 201 });
            }

            const groupId = bodyGroupId || (await getActiveGroup(userId));
            if (!groupId) throw badRequest('No perteneces a ningún espacio compartido', 'NO_SPACE');
            await requireSpace(ctx, groupId);

            const existing = await prisma.tag.findFirst({ where: { coupleId: groupId, name }, select: { id: true } });
            if (existing) throw duplicate();
            const tag = await prisma.tag.create({ data: { name, color, coupleId: groupId } });
            return NextResponse.json({ tag }, { status: 201 });
        } catch (error) {
            // Concurrent create of the same name loses the @@unique([name, coupleId]) race.
            if (isUniqueViolation(error)) throw duplicate();
            throw error;
        }
    },
);
