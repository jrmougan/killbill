"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/**
 * Explicit-consent join button (Fase 2). Renders on `/i/[token]` for an already
 * authenticated visitor: clicking it POSTs the token to /api/invites/claim, which
 * performs the transactional join. On success we navigate to the dashboard. This
 * is the deliberate replacement for the old silent `?code=` auto-join.
 */
export function ClaimButton({ token, spaceName }: { token: string; spaceName: string }) {
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
                body: JSON.stringify({ token }),
            });
            const data = await res.json();
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
        <div className="w-full space-y-3">
            {error && (
                <div className="bg-destructive/15 text-destructive text-sm p-3 rounded-md text-center">
                    {error}
                </div>
            )}
            <Button
                onClick={join}
                size="lg"
                className="w-full h-12 text-lg"
                isLoading={pending}
            >
                Unirte a {spaceName} como miembro
            </Button>
        </div>
    );
}
