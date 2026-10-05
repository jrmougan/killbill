"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EqCta } from "@/components/ui/eq";
import { AuthError } from "@/components/auth/auth-shell";

/**
 * Explicit-consent join button for a REGISTERED visitor on `/i/[token]`. POSTs
 * the token to /api/invites/claim (MEMBER link, or `asMember` for a trip's GUEST
 * link: "Unirme con mi cuenta") and moves to Inicio on success. The label is
 * short and the button wraps instead of overflowing (T-14); the space name lives
 * in the page title.
 */
export function ClaimButton({
    token,
    asMember = false,
    label = "Unirme",
}: {
    token: string;
    asMember?: boolean;
    label?: string;
}) {
    const router = useRouter();
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function join() {
        setPending(true);
        setError(null);
        try {
            const res = await fetch("/api/invites/claim", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(asMember ? { token, asMember: true } : { token }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(data.error ?? "No se pudo unir al espacio");
                setPending(false);
                return;
            }
            router.push("/dashboard");
            router.refresh();
        } catch {
            setError("Error de red. Inténtalo de nuevo.");
            setPending(false);
        }
    }

    return (
        <div className="flex flex-col gap-3">
            {error && <AuthError>{error}</AuthError>}
            <EqCta
                data-testid="invite-join"
                onClick={join}
                disabled={pending}
                aria-busy={pending}
                className="h-auto min-h-14 px-4 py-3 text-center leading-snug text-balance"
            >
                {pending ? "Uniéndote…" : label}
            </EqCta>
        </div>
    );
}
