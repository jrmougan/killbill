"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Users, DoorClosed, DoorOpen, Archive, AlertCircle } from "lucide-react";
import { SpaceType, SpaceStatus } from "@/generated/prisma/enums";

/**
 * OWNER/ADMIN lifecycle actions for a space (Fase 1): convert COUPLE→GROUP,
 * start closing (→SETTLING), reopen (SETTLING→ACTIVE) and archive (→ARCHIVED).
 * All go through PATCH /api/spaces/[id] except the close flow, which lives at
 * /spaces/[id]/close (settle-up + checklist). Here we surface quick transitions.
 */
export function SpaceActions({
    spaceId,
    type,
    status,
}: {
    spaceId: string;
    type: SpaceType | string;
    status: SpaceStatus | string;
}) {
    const router = useRouter();
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const patch = async (body: Record<string, unknown>, key: string, confirmMsg?: string) => {
        if (confirmMsg && !confirm(confirmMsg)) return;
        setBusy(key);
        setError(null);
        try {
            const res = await fetch(`/api/spaces/${spaceId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const data = await res.json().catch(() => null);
            if (res.ok) {
                router.refresh();
            } else {
                setError(data?.error || "No se pudo completar la acción");
            }
        } catch {
            setError("Error de conexión");
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className="space-y-3">
            {type === SpaceType.COUPLE && (
                <Button
                    variant="secondary"
                    className="w-full justify-start h-12"
                    onClick={() =>
                        patch(
                            { type: SpaceType.GROUP },
                            "convert",
                            "¿Convertir esta pareja en grupo? Podrás añadir más de 2 personas. No se puede deshacer.",
                        )
                    }
                    isLoading={busy === "convert"}
                >
                    <Users className="h-4 w-4 mr-2 text-primary" /> Convertir en grupo
                </Button>
            )}

            {status === SpaceStatus.ACTIVE && (
                <Button
                    variant="secondary"
                    className="w-full justify-start h-12"
                    onClick={() => patch({ status: SpaceStatus.SETTLING }, "settle")}
                    isLoading={busy === "settle"}
                >
                    <DoorClosed className="h-4 w-4 mr-2 text-primary" /> Empezar a cerrar cuentas
                </Button>
            )}

            {status === SpaceStatus.SETTLING && (
                <Button
                    variant="secondary"
                    className="w-full justify-start h-12"
                    onClick={() => patch({ status: SpaceStatus.ACTIVE }, "reopen")}
                    isLoading={busy === "reopen"}
                >
                    <DoorOpen className="h-4 w-4 mr-2 text-primary" /> Reabrir espacio
                </Button>
            )}

            {status !== SpaceStatus.ARCHIVED && (
                <Button
                    variant="ghost"
                    className="w-full justify-start h-12 bg-[var(--negative-tint)] text-destructive border border-[color:var(--line)]"
                    onClick={() =>
                        patch(
                            { status: SpaceStatus.ARCHIVED },
                            "archive",
                            "¿Archivar el espacio? Quedará en solo lectura como recuerdo. No se puede reabrir.",
                        )
                    }
                    isLoading={busy === "archive"}
                >
                    <Archive className="h-4 w-4 mr-2" /> Archivar espacio
                </Button>
            )}

            {error && (
                <p className="flex items-center gap-1.5 text-xs text-destructive">
                    <AlertCircle className="h-3.5 w-3.5" /> {error}
                </p>
            )}
        </div>
    );
}
