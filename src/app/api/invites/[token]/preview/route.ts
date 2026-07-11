import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { evaluateInvite, hashInviteToken, inviteInvalidMessage } from "@/lib/invite-token";
import { InviteKind, SpaceStatus, SpaceType } from "@/generated/prisma/enums";
import { joinByCodeAllowed } from "@/lib/space-policy";

/**
 * Public, minimal preview of an invite link (Fase 2). Powers the consent screen
 * `/i/[token]` BEFORE the visitor authenticates, so it exposes only the space
 * name/type and whether the link is still redeemable — never member data.
 *
 * Rate-limited by client IP: an invite token is a bearer secret and this is the
 * one unauthenticated lookup, so it must not be a brute-force oracle.
 *
 * Backward compatibility: old `/login?code=X` links carried a classic 6-hex
 * `Couple.code`. Those now route through consent (`/i/X`), so this resolver falls
 * back to a classic code lookup when the token isn't a GroupInvite.
 */
export async function GET(
    request: Request,
    { params }: { params: Promise<{ token: string }> },
) {
    const { token } = await params;

    const ip = getClientIp(request.headers);
    if (!rateLimit(`invite-preview:${ip}`, 30, 5 * 60 * 1000).allowed) {
        return NextResponse.json(
            { error: "Demasiadas solicitudes. Inténtalo de nuevo más tarde." },
            { status: 429 },
        );
    }

    const headers = { "Referrer-Policy": "no-referrer" };

    if (!token) {
        return NextResponse.json({ error: "Enlace inválido" }, { status: 400, headers });
    }

    // 1) GroupInvite by hash (never by plaintext).
    const invite = await prisma.groupInvite.findUnique({
        where: { tokenHash: hashInviteToken(token) },
        include: { group: { select: { id: true, name: true, type: true, status: true } } },
    });

    if (invite) {
        // MEMBER links only in this phase; GUEST (EPHEMERAL) is Fase 3.
        if (invite.kind !== InviteKind.MEMBER) {
            return NextResponse.json(
                { valid: false, reason: "UNSUPPORTED", error: "Tipo de invitación no disponible" },
                { status: 200, headers },
            );
        }
        const validity = evaluateInvite(invite);
        if (!validity.ok) {
            return NextResponse.json(
                { valid: false, reason: validity.reason, error: inviteInvalidMessage(validity.reason) },
                { status: 200, headers },
            );
        }
        const joinable = joinByCodeAllowed(invite.group.type as SpaceType, invite.group.status as SpaceStatus);
        return NextResponse.json(
            {
                valid: joinable,
                reason: joinable ? undefined : "NOT_JOINABLE",
                error: joinable ? undefined : "Este espacio ya no admite nuevos miembros",
                kind: InviteKind.MEMBER,
                space: { name: invite.group.name, type: invite.group.type },
            },
            { status: 200, headers },
        );
    }

    // 2) Classic Couple.code fallback (legacy /login?code=X links).
    const couple = await prisma.couple.findUnique({
        where: { code: token.toUpperCase() },
        select: { name: true, type: true, status: true },
    });
    if (couple) {
        const joinable = joinByCodeAllowed(couple.type as SpaceType, couple.status as SpaceStatus);
        return NextResponse.json(
            {
                valid: joinable,
                reason: joinable ? undefined : "NOT_JOINABLE",
                error: joinable ? undefined : "Este espacio ya no admite nuevos miembros",
                kind: InviteKind.MEMBER,
                legacyCode: true,
                space: { name: couple.name, type: couple.type },
            },
            { status: 200, headers },
        );
    }

    return NextResponse.json(
        { valid: false, reason: "NOT_FOUND", error: "Enlace de invitación no encontrado" },
        { status: 404, headers },
    );
}
