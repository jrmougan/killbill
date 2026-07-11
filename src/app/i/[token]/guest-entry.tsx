"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/**
 * "Entrar como invitado" (Fase 3). Renders on `/i/[token]` for a GUEST invite:
 * the visitor types only a name and enters — no email, no password. On success
 * the API opens a guest session and returns a ONE-TIME personal recovery link,
 * which we surface immediately ("Guarda tu enlace personal") before moving on,
 * so the guest can restore access from another device.
 */
export function GuestEntry({ token, spaceName }: { token: string; spaceName: string }) {
    const router = useRouter();
    const [name, setName] = useState("");
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [recoveryToken, setRecoveryToken] = useState<string | null>(null);

    async function enter() {
        const trimmed = name.trim();
        if (!trimmed) {
            setError("Escribe tu nombre para entrar");
            return;
        }
        setPending(true);
        setError(null);
        try {
            const res = await fetch("/api/invites/claim", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token, name: trimmed }),
            });
            const data = await res.json();
            if (!res.ok) {
                setError(data.error ?? "No se pudo entrar como invitado");
                setPending(false);
                return;
            }
            setRecoveryToken(data.recoveryToken ?? null);
            setPending(false);
        } catch {
            setError("Error de red. Inténtalo de nuevo.");
            setPending(false);
        }
    }

    // Interstitial: show the one-time recovery link before entering the space.
    if (recoveryToken) {
        const recoveryUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/i/${encodeURIComponent(recoveryToken)}`;
        return (
            <div className="w-full space-y-4 text-center">
                <p className="text-lg font-semibold">Guarda tu enlace personal</p>
                <p className="text-sm text-muted-foreground">
                    Es la única forma de volver a entrar desde otro dispositivo. No se mostrará de nuevo.
                </p>
                <div className="bg-muted text-xs p-3 rounded-md break-all select-all font-mono">
                    {recoveryUrl}
                </div>
                <Button
                    size="lg"
                    className="w-full h-12 text-lg"
                    onClick={() => {
                        router.push("/dashboard");
                        router.refresh();
                    }}
                >
                    Guardado, entrar a {spaceName}
                </Button>
            </div>
        );
    }

    return (
        <div className="w-full space-y-3">
            {error && (
                <div className="bg-destructive/15 text-destructive text-sm p-3 rounded-md text-center">
                    {error}
                </div>
            )}
            <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Tu nombre"
                maxLength={40}
                className="w-full h-12 px-4 rounded-md border border-input bg-background text-lg"
            />
            <Button onClick={enter} size="lg" className="w-full h-12 text-lg" isLoading={pending}>
                Entrar como invitado
            </Button>
        </div>
    );
}
