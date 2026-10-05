import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { resolveInviteToken } from "@/lib/invite-resolve";
import { sessionKindOf } from "@/lib/invite-policy";
import { MembershipStatus } from "@/generated/prisma/enums";
import { AuthShell, AuthNote } from "@/components/auth/auth-shell";
import { ClaimButton } from "./claim-button";
import { GuestEntry } from "./guest-entry";

/**
 * Public invite consent screen. Reached from an invite link and from the
 * post-login redirect (`/login?code=` → here): no join ever happens without an
 * explicit tap.
 *
 * Resolves (see `resolveInviteToken`): MEMBER links (COUPLE/GROUP), GUEST links
 * (EPHEMERAL trips — enter by name, or "Unirme con mi cuenta" when logged in),
 * and a guest's personal RECOVERY link (IE-03). The legacy 6-hex `Couple.code`
 * is not an invitation any more (IE-04): it resolves to "no encontrado" and
 * never reveals a space name.
 *
 * A registered session is never replaced silently (IE-02): entering as a guest
 * requires an explicit confirmation ("cerrarás tu sesión").
 */

export const dynamic = "force-dynamic";

const linkCta =
    "w-full min-h-14 rounded-[18px] px-4 py-3 text-base font-semibold flex items-center justify-center text-center leading-snug transition-transform active:scale-[0.98]";
const primaryLink = `${linkCta} bg-primary text-primary-foreground`;
const outlineLink = `${linkCta} bg-card border border-[color:var(--line)] text-foreground`;

const CONSENT_NOTE =
    "Al unirte, las demás personas del espacio verán tu nombre y los gastos que registres. No compartimos tus datos con terceros. Puedes salir del espacio cuando quieras desde Espacios.";

export default async function InviteConsentPage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    const [resolved, session] = await Promise.all([resolveInviteToken(token), getSession()]);
    const kind = sessionKindOf(session);
    const sessionUserId = kind === "none" ? null : (session!.userId as string);
    const sessionEmail = kind === "registered" && typeof session?.email === "string" ? session.email : null;
    const enc = encodeURIComponent(token);

    // IE-24: a registered member reopening a (possibly used-up) link of their own
    // space sees "ya eres miembro" instead of a misleading "sin usos".
    const spaceId = resolved.spaceId;
    if (kind === "registered" && spaceId && sessionUserId) {
        const membership = await prisma.membership.findUnique({
            where: { groupId_userId: { groupId: spaceId, userId: sessionUserId } },
            select: { status: true },
        });
        if (membership?.status === MembershipStatus.ACTIVE) {
            const name = resolved.ok ? resolved.spaceName : (resolved.spaceName ?? "este espacio");
            return (
                <AuthShell
                    title={<>Ya eres miembro de {name}</>}
                    subtitle="No tienes que hacer nada más."
                    footer={<Link href="/dashboard" className={primaryLink}>Ir a Inicio</Link>}
                />
            );
        }
    }

    if (!resolved.ok) {
        return (
            <AuthShell
                title="Este enlace no funciona"
                subtitle={resolved.message}
                footer={
                    <>
                        <AuthNote>Pide a quien te invitó un enlace nuevo.</AuthNote>
                        <Link href={kind === "none" ? "/login" : "/dashboard"} className={outlineLink}>
                            {kind === "none" ? "Iniciar sesión" : "Ir a Inicio"}
                        </Link>
                    </>
                }
            />
        );
    }

    // ── Guest recovery link (personal, multi-device) ─────────────────────────
    if (resolved.kind === "RECOVERY") {
        return (
            <AuthShell
                title={<>Vuelve a {resolved.spaceName}</>}
                subtitle={<>Entrarás como <strong className="text-foreground">{resolved.guestName}</strong> en este dispositivo.</>}
            >
                <GuestEntry
                    token={token}
                    spaceName={resolved.spaceName}
                    mode="recovery"
                    guestName={resolved.guestName}
                    replacesSessionOf={kind === "registered" ? (sessionEmail ?? "") : null}
                />
            </AuthShell>
        );
    }

    // ── Trip (EPHEMERAL) guest link ──────────────────────────────────────────
    if (resolved.kind === "GUEST") {
        if (kind === "guest" && session?.groupId === resolved.spaceId) {
            return (
                <AuthShell
                    title={<>Ya estás en {resolved.spaceName}</>}
                    subtitle="Has entrado como invitado en este dispositivo."
                    footer={<Link href="/dashboard" className={primaryLink}>Ir a Inicio</Link>}
                />
            );
        }

        if (kind === "registered") {
            return (
                <AuthShell
                    title={<>Te han invitado a {resolved.spaceName}</>}
                    subtitle={
                        sessionEmail
                            ? <>Has iniciado sesión como <strong className="text-foreground break-all">{sessionEmail}</strong>. Únete con tu cuenta para tener el viaje junto a tus otros espacios.</>
                            : "Únete con tu cuenta para tener el viaje junto a tus otros espacios."
                    }
                    footer={
                        <>
                            <AuthNote>{CONSENT_NOTE}</AuthNote>
                            <Link href="/dashboard" className="text-sm font-semibold text-muted-foreground px-2 py-2">
                                Ahora no
                            </Link>
                        </>
                    }
                >
                    {resolved.accountJoinable && (
                        <ClaimButton token={token} asMember label="Unirme con mi cuenta" />
                    )}
                    <GuestEntry token={token} spaceName={resolved.spaceName} replacesSessionOf={sessionEmail ?? ""} />
                </AuthShell>
            );
        }

        return (
            <AuthShell
                title={<>Te han invitado a {resolved.spaceName}</>}
                subtitle={
                    kind === "guest"
                        ? "Entra solo con tu nombre. Saldrás del viaje en el que estás ahora: guarda antes su enlace personal."
                        : "Entra solo con tu nombre, sin crear una cuenta."
                }
                footer={
                    <>
                        <AuthNote>{CONSENT_NOTE}</AuthNote>
                        <p className="text-sm text-muted-foreground">
                            ¿Prefieres una cuenta?{" "}
                            <Link href={`/register?code=${enc}`} className="font-semibold text-primary">
                                Regístrate
                            </Link>
                            {" · "}
                            <Link href={`/login?code=${enc}`} className="font-semibold text-primary">
                                Inicia sesión
                            </Link>
                        </p>
                    </>
                }
            >
                <GuestEntry token={token} spaceName={resolved.spaceName} />
            </AuthShell>
        );
    }

    // ── Member link (COUPLE / GROUP) ─────────────────────────────────────────
    if (kind === "guest") {
        return (
            <AuthShell
                title={<>Te han invitado a {resolved.spaceName}</>}
                subtitle="Ahora estás como invitado. Crea tu cuenta para poder unirte a otros espacios."
                footer={<Link href="/dashboard" className="text-sm font-semibold text-muted-foreground px-2 py-2">Volver a Inicio</Link>}
            >
                <Link href="/guest/upgrade" className={primaryLink}>Crear mi cuenta</Link>
            </AuthShell>
        );
    }

    if (kind === "registered") {
        return (
            <AuthShell
                title={<>Te han invitado a {resolved.spaceName}</>}
                subtitle="Únete para compartir gastos en este espacio."
                footer={
                    <>
                        <AuthNote>{CONSENT_NOTE}</AuthNote>
                        <Link href="/dashboard" className="text-sm font-semibold text-muted-foreground px-2 py-2">
                            Ahora no
                        </Link>
                    </>
                }
            >
                <ClaimButton token={token} label="Unirme al espacio" />
            </AuthShell>
        );
    }

    return (
        <AuthShell
            title={<>Te han invitado a {resolved.spaceName}</>}
            subtitle="Inicia sesión o crea una cuenta para unirte."
            footer={<AuthNote>{CONSENT_NOTE}</AuthNote>}
        >
            <Link href={`/login?code=${enc}`} className={primaryLink}>Iniciar sesión</Link>
            <Link href={`/register?code=${enc}`} className={outlineLink}>Crear una cuenta</Link>
        </AuthShell>
    );
}
