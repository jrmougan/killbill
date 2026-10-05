import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionCtx } from '@/lib/authz';

/** Longest display name accepted (the column is VARCHAR(191); keep it human). */
const MAX_PROFILE_NAME_LEN = 60;
/** Avatar is an emoji or an `/uploads/...` path; VARCHAR(191) column. */
const MAX_AVATAR_LEN = 191;

const json = (body: unknown, status: number) => NextResponse.json(body, { status });

/**
 * PATCH /api/user/profile {name, avatar?} — edit the caller's own profile.
 * Registered sessions only: a GUEST (shadow user) has no profile surface (it
 * upgrades through /api/guest/upgrade). Input is validated so an oversized value
 * is a Spanish 400, never a DB "value too long" 500.
 */
export async function PATCH(request: Request) {
    const ctx = await getSessionCtx();
    if (!ctx) return json({ error: 'No autorizado' }, 401);
    if (ctx.kind === 'guest') return json({ error: 'Acción no permitida para invitados' }, 403);

    let body: Record<string, unknown>;
    try {
        body = await request.json();
    } catch {
        return json({ error: 'Cuerpo de la petición no válido' }, 400);
    }
    if (!body || typeof body !== 'object') return json({ error: 'Cuerpo de la petición no válido' }, 400);

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return json({ error: 'El nombre es obligatorio' }, 400);
    if (name.length > MAX_PROFILE_NAME_LEN) {
        return json({ error: `El nombre no puede superar los ${MAX_PROFILE_NAME_LEN} caracteres` }, 400);
    }

    let avatar: string | undefined;
    if (body.avatar !== undefined && body.avatar !== null && body.avatar !== '') {
        if (typeof body.avatar !== 'string' || body.avatar.length > MAX_AVATAR_LEN) {
            return json({ error: 'El avatar no es válido' }, 400);
        }
        avatar = body.avatar;
    }

    try {
        const user = await prisma.user.update({
            where: { id: ctx.userId },
            data: { name, avatar },
            select: { id: true, name: true, email: true, avatar: true, isAdmin: true },
        });
        return NextResponse.json({ success: true, user });
    } catch (error) {
        console.error('Error al actualizar el perfil:', error);
        return json({ error: 'No se pudo guardar el perfil. Inténtalo de nuevo.' }, 500);
    }
}
