"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Copy, Check, RefreshCw, LinkIcon } from "lucide-react";
import { SpaceType } from "@/generated/prisma/enums";

/**
 * Invitation management for a space (Fase 1 scope). For COUPLE/GROUP it shows the
 * classic join code with copy + rotate (POST /api/spaces/[id]/rotate-code).
 *
 * Expirable invite links (GroupInvite, kind MEMBER/GUEST) are a Fase 2/3
 * deliverable — this component ships the surface as a disabled "próximamente"
 * stub so the management view is complete without pretending the endpoints exist.
 */
export function InviteManager({
    spaceId,
    type,
    initialCode,
    canManage,
}: {
    spaceId: string;
    type: SpaceType | string;
    initialCode: string;
    canManage: boolean;
}) {
    const [code, setCode] = useState(initialCode);
    const [copied, setCopied] = useState(false);
    const [rotating, setRotating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const usesCode = type === SpaceType.COUPLE || type === SpaceType.GROUP;

    const copy = () => {
        navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const rotate = async () => {
        if (!confirm("Al rotar el código, el anterior dejará de funcionar. ¿Continuar?")) return;
        setRotating(true);
        setError(null);
        try {
            const res = await fetch(`/api/spaces/${spaceId}/rotate-code`, { method: "POST" });
            const data = await res.json().catch(() => null);
            if (res.ok && data?.code) {
                setCode(data.code);
            } else {
                setError(data?.error || "No se pudo rotar el código");
            }
        } catch {
            setError("Error de conexión");
        } finally {
            setRotating(false);
        }
    };

    return (
        <div className="space-y-3">
            {usesCode ? (
                <div className="rounded-xl bg-secondary border border-[color:var(--line)] p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                            <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">
                                Código de invitación
                            </p>
                            <code className="text-lg font-mono font-bold tracking-tighter text-foreground">{code}</code>
                        </div>
                        <Button
                            size="icon"
                            variant="ghost"
                            onClick={copy}
                            className="h-10 w-10"
                            aria-label="Copiar código"
                        >
                            {copied ? <Check className="h-4 w-4 text-[color:var(--positive)]" /> : <Copy className="h-4 w-4" />}
                        </Button>
                    </div>
                    {canManage && (
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={rotate}
                            isLoading={rotating}
                            className="w-full"
                        >
                            <RefreshCw className="h-4 w-4 mr-2" /> Rotar código
                        </Button>
                    )}
                    {error && <p className="text-xs text-destructive">{error}</p>}
                </div>
            ) : (
                <div className="rounded-xl bg-secondary border border-[color:var(--line)] p-4">
                    <p className="text-sm text-muted-foreground">
                        Este espacio se comparte con enlaces de invitación temporales.
                    </p>
                </div>
            )}

            {/* Expirable links — Fase 2/3 surface, disabled for now. */}
            <div className="rounded-xl border border-dashed border-[color:var(--line-strong)] p-4 flex items-center gap-3 opacity-70">
                <LinkIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">Enlaces de invitación</p>
                    <p className="text-[12px] text-muted-foreground">
                        Enlaces con caducidad y usos limitados — próximamente.
                    </p>
                </div>
            </div>
        </div>
    );
}
