import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getClientIp } from "@/lib/rate-limit";
import { evaluateInvite, hashInviteToken, inviteInvalidMessage } from "@/lib/invite-token";
import { InviteKind, SpaceStatus, SpaceType } from "@/generated/prisma/enums";
import { allowsGuests, joinByCodeAllowed } from "@/lib/space-policy";
import { ephemeralSpacesEnabled } from "@/lib/flags";
import { enforceRateLimit, toErrorResponse } from "@/lib/http";

/**
 * Public, minimal preview of an invite link (Fase 2). Powers the consent screen
 * `/i/[token]` BEFORE the visitor authenticates, so it exposes only the space
 * name/type and whether the link is still redeemable — never member data.
 *
 * Rate-limited by client IP: an invite token is a bearer secret and this is the
 * one unauthenticated lookup, so it must not be a brute-force oracle.
 *
 * The legacy 6-hex `Couple.code` is NOT resolved (no short codes): it was
 * guessable, so an unknown token never reveals a space name.
 *
 * Not wrapped in route(): there is no session to resolve (the visitor is
 * anonymous by design), so the rate limit stays the very first thing it does.
 */
export async function GET(
    request: Request,
    { params }: { params: Promise<{ token: string }> },
) {
    try {
        const { token } = await params;

        const ip = getClientIp(request.headers);
        enforceRateLimit(`invite-preview:${ip}`, 30, 5 * 60 * 1000);

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
            // GUEST links (EPHEMERAL) render a "join as guest" screen, gated by the flag.
            if (invite.kind === InviteKind.GUEST) {
                if (!ephemeralSpacesEnabled()) {
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
                const guestable =
                    allowsGuests(invite.group.type as SpaceType) &&
                    (invite.group.status as SpaceStatus) === SpaceStatus.ACTIVE;
                return NextResponse.json(
                    {
                        valid: guestable,
                        reason: guestable ? undefined : "NOT_JOINABLE",
                        error: guestable ? undefined : "Este espacio ya no admite invitados",
                        kind: InviteKind.GUEST,
                        space: { name: invite.group.name, type: invite.group.type },
                    },
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

        return NextResponse.json(
            { valid: false, reason: "NOT_FOUND", error: "Enlace de invitación no encontrado" },
            { status: 404, headers },
        );
    } catch (error) {
        // 429 (with Retry-After) from enforceRateLimit; anything else is a logged 500.
        return toErrorResponse(error, {
            fallbackMessage: "Error al comprobar la invitación",
            logLabel: "Error previewing invite:",
        });
    }
}
