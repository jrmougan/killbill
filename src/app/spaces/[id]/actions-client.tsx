"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Archive, ChevronRight, DoorClosed, DoorOpen, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { SpaceType, SpaceStatus } from "@/generated/prisma/enums";
import { ConfirmSheet } from "@/components/space/confirm-sheet";

type Pending = "convert" | "archive" | null;

/**
 * OWNER/ADMIN lifecycle actions for a space: start closing (→SETTLING, via the
 * guided close flow), reopen (SETTLING→ACTIVE), archive (→ARCHIVED, only with
 * closed accounts — the API answers 409 with a settle link otherwise) and the
 * one-way "Convertir en grupo" (COUPLE→GROUP, only while ACTIVE). ARCHIVED is
 * terminal: nothing is offered.
 */
export function SpaceActions({
    spaceId,
    type,
    status,
    settleHref,
}: {
    spaceId: string;
    type: SpaceType | string;
    status: SpaceStatus | string;
    settleHref: string;
}) {
    const router = useRouter();
    const [refreshing, startTransition] = useTransition();
    const [busy, setBusy] = useState<string | null>(null);
    const [confirming, setConfirming] = useState<Pending>(null);
    const [error, setError] = useState<{ message: string; href: string | null } | null>(null);

    const patch = async (body: Record<string, unknown>, key: string) => {
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
                setConfirming(null);
                startTransition(() => router.refresh());
                return;
            }
            setError({ message: data?.error || "No se pudo completar la acción", href: data?.settleUrl ?? null });
        } catch {
            setError({ message: "Sin conexión. Inténtalo de nuevo.", href: null });
        } finally {
            setBusy(null);
        }
    };

    if (status === SpaceStatus.ARCHIVED) return null;

    const disabled = busy !== null || refreshing;
    const row = "w-full min-h-14 flex items-center gap-3 px-4 py-3 text-left text-[15px] font-semibold disabled:opacity-50";

    return (
        <div data-testid="space-actions" className="rounded-[18px] bg-card border border-[color:var(--line-2)] divide-y divide-[color:var(--line-2)] overflow-hidden">
            {status === SpaceStatus.ACTIVE && (
                <button
                    type="button"
                    className={row}
                    onClick={() => patch({ status: SpaceStatus.SETTLING }, "settle")}
                    disabled={disabled}
                    data-testid="space-action-settle"
                >
                    <DoorClosed className="h-5 w-5 text-primary flex-none" aria-hidden="true" />
                    <span className="flex-1">
                        Empezar a cerrar cuentas
                        <span className="block text-[12.5px] font-normal text-muted-foreground">No se podrán añadir gastos; solo liquidar.</span>
                    </span>
                </button>
            )}

            {status === SpaceStatus.SETTLING && (
                <>
                    <Link href={settleHref} className={row} data-testid="space-action-go-settle">
                        <DoorClosed className="h-5 w-5 text-primary flex-none" aria-hidden="true" />
                        <span className="flex-1">Ir a liquidar deudas</span>
                        <ChevronRight className="h-5 w-5 text-[color:var(--ink-4)]" aria-hidden="true" />
                    </Link>
                    <button
                        type="button"
                        className={row}
                        onClick={() => patch({ status: SpaceStatus.ACTIVE }, "reopen")}
                        disabled={disabled}
                        data-testid="space-action-reopen"
                    >
                        <DoorOpen className="h-5 w-5 text-primary flex-none" aria-hidden="true" />
                        <span className="flex-1">Reabrir espacio</span>
                    </button>
                </>
            )}

            {type === SpaceType.COUPLE && status === SpaceStatus.ACTIVE && (
                <button
                    type="button"
                    className={row}
                    onClick={() => {
                        setError(null);
                        setConfirming("convert");
                    }}
                    disabled={disabled}
                    data-testid="space-action-convert"
                >
                    <Users className="h-5 w-5 text-primary flex-none" aria-hidden="true" />
                    <span className="flex-1">
                        Convertir en grupo
                        <span className="block text-[12.5px] font-normal text-muted-foreground">Para compartir con más de 2 personas.</span>
                    </span>
                </button>
            )}

            <button
                type="button"
                className={cn(row, "text-destructive")}
                onClick={() => {
                    setError(null);
                    setConfirming("archive");
                }}
                disabled={disabled}
                data-testid="space-action-archive"
            >
                <Archive className="h-5 w-5 flex-none" aria-hidden="true" />
                <span className="flex-1">
                    Archivar espacio
                    <span className="block text-[12.5px] font-normal text-muted-foreground">Solo cuando estéis en paz.</span>
                </span>
            </button>

            {error && !confirming && (
                <p role="alert" data-testid="space-action-error" className="px-4 py-3 text-xs text-destructive">
                    {error.message}
                </p>
            )}

            {confirming === "archive" && (
                <ConfirmSheet
                    testId="archive-sheet"
                    title="¿Archivar el espacio?"
                    confirmLabel="Archivar"
                    tone="danger"
                    busy={busy === "archive"}
                    error={error?.message}
                    errorHref={error?.href}
                    onConfirm={() => patch({ status: SpaceStatus.ARCHIVED }, "archive")}
                    onClose={() => setConfirming(null)}
                >
                    Quedará en solo lectura como recuerdo y no se podrá reabrir. Solo se puede archivar cuando nadie debe nada y no
                    quedan pagos por confirmar.
                </ConfirmSheet>
            )}
            {confirming === "convert" && (
                <ConfirmSheet
                    testId="convert-sheet"
                    title="¿Convertir en grupo?"
                    confirmLabel="Convertir en grupo"
                    busy={busy === "convert"}
                    error={error?.message}
                    onConfirm={() => patch({ type: SpaceType.GROUP }, "convert")}
                    onClose={() => setConfirming(null)}
                >
                    Podréis ser más de 2 personas. No se puede deshacer.
                </ConfirmSheet>
            )}
        </div>
    );
}
