import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { badRequest, readJson, route, validate } from '@/lib/http';
import { jsonObject } from '@/lib/http/schemas';

/** Longest display name accepted (the column is VARCHAR(191); keep it human). */
const MAX_PROFILE_NAME_LEN = 60;
/** Avatar is an emoji or an `/uploads/...` path; VARCHAR(191) column. */
const MAX_AVATAR_LEN = 191;

const BODY_INVALID = 'Cuerpo de la petición no válido';
const NAME_REQUIRED = 'El nombre es obligatorio';
const AVATAR_INVALID = 'El avatar no es válido';

const ProfileBody = jsonObject(
    {
        name: z
            .string({ error: NAME_REQUIRED })
            .trim()
            .min(1, NAME_REQUIRED)
            .max(MAX_PROFILE_NAME_LEN, `El nombre no puede superar los ${MAX_PROFILE_NAME_LEN} caracteres`),
        /** null / "" / absent → keep the current avatar. */
        avatar: z
            .union([z.string().max(MAX_AVATAR_LEN, AVATAR_INVALID), z.null()], { error: AVATAR_INVALID })
            .optional()
            .transform((v) => v || undefined),
    },
    BODY_INVALID,
);

/**
 * PATCH /api/user/profile {name, avatar?} — edit the caller's own profile.
 * Registered sessions only: a GUEST (shadow user) has no profile surface (it
 * upgrades through /api/guest/upgrade). Input is validated so an oversized value
 * is a Spanish 400, never a DB "value too long" 500.
 */
export const PATCH = route(
    {
        auth: 'user',
        errorMessage: 'No se pudo guardar el perfil. Inténtalo de nuevo.',
        logLabel: 'Error al actualizar el perfil:',
    },
    async ({ req, ctx }) => {
        // Unparseable JSON keeps its historical message (so not options.body).
        const raw = await readJson(req).catch(() => {
            throw badRequest(BODY_INVALID);
        });
        const { name, avatar } = validate(ProfileBody, raw);

        const user = await prisma.user.update({
            where: { id: ctx.userId },
            data: { name, avatar },
            select: { id: true, name: true, email: true, avatar: true, isAdmin: true },
        });
        return NextResponse.json({ success: true, user });
    },
);
