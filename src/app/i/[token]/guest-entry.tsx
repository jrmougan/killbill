"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy } from "lucide-react";
import { EqCta } from "@/components/ui/eq";
import { AuthError, AuthField } from "@/components/auth/auth-shell";

/**
 * Guest access on `/i/[token]` (EPHEMERAL trips).
 *
 * - `mode="invite"`: the visitor types only a name and enters — no email, no
 *   password. The API opens a guest session and returns a ONE-TIME personal
 *   recovery link, shown immediately ("Guarda tu enlace personal").
 * - `mode="recovery"`: the visitor opened their personal recovery link on a new
 *   device; one tap re-opens the guest session as `guestName`.
 *
 * `replacesSessionOf` is set when a REGISTERED session is present: entering as a
 * guest would close it, so the action is collapsed behind "Entrar como
 * invitado", spells out the consequence and sends `replaceSession: true` only
 * after that explicit confirmation (IE-02). The API refuses with 409 otherwise.
 */
export function GuestEntry({
    token,
    spaceName,
    mode = "invite",
    guestName,
    replacesSessionOf,
}: {
    token: string;
    spaceName: string;
    mode?: "invite" | "recovery";
    guestName?: string;
    replacesSessionOf?: string | null;
}) {
    const router = useRouter();
    const confirmNeeded = replacesSessionOf != null;
    const [open, setOpen] = useState(!confirmNeeded);
    const [name, setName] = useState("");
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [recoveryToken, setRecoveryToken] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const goIn = () => {
        router.push("/dashboard");
        router.refresh();
    };

    async function enter() {
        const trimmed = name.trim();
        if (mode === "invite" && !trimmed) {
            setError("Escribe tu nombre para entrar");
            return;
        }
        setPending(true);
        setError(null);
        try {
            const res = await fetch("/api/invites/claim", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    token,
                    ...(mode === "invite" ? { name: trimmed } : {}),
                    ...(confirmNeeded ? { replaceSession: true } : {}),
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(data.error ?? "No se pudo entrar como invitado");
                setPending(false);
                return;
            }
            if (data.recoveryToken) {
                setRecoveryToken(data.recoveryToken);
                setPending(false);
                return;
            }
            goIn();
        } catch {
            setError("Error de red. Inténtalo de nuevo.");
            setPending(false);
        }
    }

    // Interstitial: show the one-time recovery link before entering the space.
    if (recoveryToken) {
        const recoveryUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/i/${encodeURIComponent(recoveryToken)}`;
        const copy = async () => {
            try {
                await navigator.clipboard.writeText(recoveryUrl);
                setCopied(true);
            } catch {
                /* clipboard unavailable: the link stays selectable */
            }
        };
        return (
            <div className="flex flex-col gap-3 eq-in" data-testid="guest-recovery">
                <h2 className="text-lg font-semibold">Guarda tu enlace personal</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                    Es la única forma de volver a entrar desde otro dispositivo. No se mostrará de nuevo.
                </p>
                <div className="rounded-[14px] border border-[color:var(--line)] bg-card p-3.5 font-mono text-xs break-all select-all">
                    {recoveryUrl}
                </div>
                <EqCta variant="outline" onClick={copy}>
                    {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                    {copied ? "Enlace copiado" : "Copiar enlace"}
                </EqCta>
                <EqCta onClick={goIn} className="h-auto min-h-14 px-4 py-3 leading-snug text-balance">
                    Guardado, entrar
                </EqCta>
            </div>
        );
    }

    if (!open) {
        return (
            <EqCta variant="outline" onClick={() => setOpen(true)} aria-expanded={false}>
                {mode === "recovery" ? `Entrar como ${guestName ?? "invitado"}` : "Entrar como invitado"}
            </EqCta>
        );
    }

    const cta = confirmNeeded
        ? "Cerrar sesión y entrar como invitado"
        : mode === "recovery"
            ? `Entrar como ${guestName ?? "invitado"}`
            : "Entrar como invitado";

    return (
        <div className="flex flex-col gap-3 eq-in">
            {confirmNeeded && (
                <div
                    role="note"
                    className="rounded-[14px] border border-[color:var(--line)] bg-card px-3.5 py-3 text-sm leading-relaxed text-pretty"
                >
                    Si entras como invitado se <strong>cerrará tu sesión</strong>
                    {replacesSessionOf ? <> de <strong className="break-all">{replacesSessionOf}</strong></> : null}.
                    Tus espacios no se borran: podrás volver a iniciar sesión cuando quieras.
                </div>
            )}
            {error && <AuthError>{error}</AuthError>}
            {mode === "invite" && (
                <AuthField
                    label="Tu nombre"
                    hint={`Así te verán en ${spaceName}.`}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") void enter();
                    }}
                    maxLength={40}
                    autoComplete="given-name"
                    data-testid="guest-name"
                />
            )}
            <EqCta
                onClick={enter}
                disabled={pending}
                aria-busy={pending}
                variant={confirmNeeded ? "ink" : "primary"}
                className="h-auto min-h-14 px-4 py-3 leading-snug text-balance"
                data-testid="guest-enter"
            >
                {pending ? "Entrando…" : cta}
            </EqCta>
        </div>
    );
}
