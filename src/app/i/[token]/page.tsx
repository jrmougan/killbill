import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { evaluateInvite, hashInviteToken, inviteInvalidMessage } from "@/lib/invite-token";
import { joinByCodeAllowed } from "@/lib/space-policy";
import { InviteKind, SpaceStatus, SpaceType } from "@/generated/prisma/enums";
import { Button } from "@/components/ui/button";
import { ClaimButton } from "./claim-button";

/**
 * Public invite consent screen (Fase 2). Reached from an invite link and from
 * the post-login redirect that replaced the silent `?code=` auto-join. It shows
 * the space, then either lets an authenticated visitor join EXPLICITLY, or points
 * an anonymous visitor to login/register (carrying the token). It resolves both
 * GroupInvite tokens and the legacy classic `Couple.code` so old links keep
 * working. Guest entry (EPHEMERAL) is Fase 3 and intentionally absent here.
 */

export const dynamic = "force-dynamic";

type Resolved =
    | { ok: false; message: string }
    | { ok: true; spaceName: string };

async function resolveInvite(token: string): Promise<Resolved> {
    const invite = await prisma.groupInvite.findUnique({
        where: { tokenHash: hashInviteToken(token) },
        include: { group: { select: { name: true, type: true, status: true } } },
    });

    if (invite) {
        if (invite.kind !== InviteKind.MEMBER) {
            return { ok: false, message: "Este tipo de invitación no está disponible todavía." };
        }
        const validity = evaluateInvite(invite);
        if (!validity.ok) {
            return { ok: false, message: inviteInvalidMessage(validity.reason) };
        }
        if (!joinByCodeAllowed(invite.group.type as SpaceType, invite.group.status as SpaceStatus)) {
            return { ok: false, message: "Este espacio ya no admite nuevos miembros." };
        }
        return { ok: true, spaceName: invite.group.name ?? "el espacio" };
    }

    const couple = await prisma.couple.findUnique({
        where: { code: token.toUpperCase() },
        select: { name: true, type: true, status: true },
    });
    if (couple) {
        if (!joinByCodeAllowed(couple.type as SpaceType, couple.status as SpaceStatus)) {
            return { ok: false, message: "Este espacio ya no admite nuevos miembros." };
        }
        return { ok: true, spaceName: couple.name ?? "el espacio" };
    }

    return { ok: false, message: "Enlace de invitación no encontrado o caducado." };
}

export default async function InviteConsentPage({
    params,
}: {
    params: Promise<{ token: string }>;
}) {
    const { token } = await params;
    const [resolved, session] = await Promise.all([resolveInvite(token), getSession()]);

    return (
        <div className="flex flex-col items-center justify-center min-h-screen p-6 space-y-8 max-w-md mx-auto">
            <div className="text-center space-y-2">
                <h1 className="text-4xl font-bold tracking-tighter text-primary italic">EQUIL</h1>
                <p className="text-muted-foreground">Invitación a un espacio compartido</p>
            </div>

            {!resolved.ok ? (
                <div className="w-full space-y-4 text-center">
                    <div className="bg-destructive/15 text-destructive text-sm p-3 rounded-md">
                        {resolved.message}
                    </div>
                    <Link href="/dashboard" className="text-primary hover:underline text-sm">
                        Ir a mi panel
                    </Link>
                </div>
            ) : session?.userId ? (
                <div className="w-full space-y-4 text-center">
                    <p className="text-lg">
                        Te han invitado a <span className="font-semibold">{resolved.spaceName}</span>.
                    </p>
                    <ClaimButton token={token} spaceName={resolved.spaceName} />
                    <Link href="/dashboard" className="text-muted-foreground hover:underline text-sm block">
                        Ahora no
                    </Link>
                </div>
            ) : (
                <div className="w-full space-y-4 text-center">
                    <p className="text-lg">
                        Te han invitado a <span className="font-semibold">{resolved.spaceName}</span>. Inicia
                        sesión o crea una cuenta para unirte.
                    </p>
                    <Link href={`/login?code=${encodeURIComponent(token)}`} className="block">
                        <Button size="lg" className="w-full h-12 text-lg">Iniciar sesión</Button>
                    </Link>
                    <Link href={`/register?code=${encodeURIComponent(token)}`} className="block">
                        <Button size="lg" variant="secondary" className="w-full h-12 text-lg">
                            Crear una cuenta
                        </Button>
                    </Link>
                </div>
            )}

            {resolved.ok && (
                <p className="text-[11px] leading-relaxed text-muted-foreground text-center max-w-xs">
                    Al unirte, las demás personas del espacio verán tu nombre y los gastos que
                    registres. No compartimos tus datos con terceros. Puedes salir del espacio cuando
                    quieras desde Ajustes.
                </p>
            )}
        </div>
    );
}
