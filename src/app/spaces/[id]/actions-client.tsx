"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Archive, ChevronRight, DoorClosed, DoorOpen, HandCoins, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { SpaceType, SpaceStatus } from "@/generated/prisma/enums";
import { CriticalActionSheet } from "@/components/ui/critical-action-sheet";
import { EqToast, useEqToast } from "@/components/ui/eq";
import { REOPEN_CONSEQUENCES, SETTLING_CONSEQUENCES } from "@/lib/space-ui";

const CONVERT_CONSEQUENCES = ["Podréis ser hasta 20 personas.", "Los gastos, saldos y deudas no cambian.", "No se puede volver a pareja."];

type Pending = "settle" | "reopen" | "convert" | "archive" | null;
type ActionError = { message: string; href: string | null };

const row = "w-full min-h-14 flex items-center gap-3 px-4 py-3 text-left text-[15px] font-semibold disabled:opacity-50";
const card = "rounded-[18px] bg-card border border-[color:var(--line-2)] divide-y divide-[color:var(--line-2)] overflow-hidden";

/**
 * PATCH /api/spaces/[id] from a confirmation sheet. On success the sheet
 * closes and the page is refreshed in place (no navigation); on failure the
 * server message (and its settle link, for 409s) stays in the open sheet.
 */
function useSpacePatch(spaceId: string) {
    const router = useRouter();
    const [refreshing, startTransition] = useTransition();
    const [busy, setBusy] = useState<string | null>(null);
    const [confirming, setConfirming] = useState<Pending>(null);
    const [error, setError] = useState<ActionError | null>(null);

    const patch = async (body: Record<string, unknown>, key: string, onDone?: () => void) => {
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
                onDone?.();
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

    const open = (p: Pending) => {
        setError(null);
        setConfirming(p);
    };

    return { patch, busy, confirming, open, close: () => setConfirming(null), error, disabled: busy !== null || refreshing };
}

/**
 * OWNER/ADMIN lifecycle actions for a space ("Gestión"): start closing
 * (ACTIVE→SETTLING), reopen (SETTLING→ACTIVE) and the one-way "Convertir en
 * grupo" (COUPLE→GROUP, only while ACTIVE). Every transition is reviewed in a
 * `CriticalActionSheet`; none navigates — the page refreshes in place and a
 * toast points to the next step. Archiving lives in the danger zone
 * (`ArchiveSpaceAction`). ARCHIVED is terminal: nothing is offered.
 */
export function SpaceActions({
    spaceId,
    spaceName,
    type,
    status,
    settleHref,
}: {
    spaceId: string;
    spaceName: string;
    type: SpaceType | string;
    status: SpaceStatus | string;
    settleHref: string;
}) {
    const { patch, busy, confirming, open, close, error, disabled } = useSpacePatch(spaceId);
    const [toast, showToast, toastAction] = useEqToast(3500);

    if (status === SpaceStatus.ARCHIVED) return null;

    return (
        <div data-testid="space-actions" className={card}>
            {status === SpaceStatus.ACTIVE && (
                <button type="button" className={row} onClick={() => open("settle")} disabled={disabled} data-testid="space-action-settle">
                    <DoorClosed className="h-5 w-5 text-primary flex-none" aria-hidden="true" />
                    <span className="flex-1">
                        Empezar a cerrar cuentas
                        <span className="block text-[12.5px] font-normal text-muted-foreground">No se podrán añadir gastos; solo saldar deudas.</span>
                    </span>
                </button>
            )}

            {status === SpaceStatus.SETTLING && (
                <>
                    <Link href={settleHref} className={row} data-testid="space-action-go-settle">
                        <HandCoins className="h-5 w-5 text-primary flex-none" aria-hidden="true" />
                        <span className="flex-1">Saldar deudas</span>
                        <ChevronRight className="h-5 w-5 text-[color:var(--ink-4)]" aria-hidden="true" />
                    </Link>
                    <button type="button" className={row} onClick={() => open("reopen")} disabled={disabled} data-testid="space-action-reopen">
                        <DoorOpen className="h-5 w-5 text-primary flex-none" aria-hidden="true" />
                        <span className="flex-1">
                            Reabrir espacio
                            <span className="block text-[12.5px] font-normal text-muted-foreground">
                                Vuelve a permitir gastos. Los pagos ya registrados se mantienen.
                            </span>
                        </span>
                    </button>
                </>
            )}

            {type === SpaceType.COUPLE && status === SpaceStatus.ACTIVE && (
                <button type="button" className={row} onClick={() => open("convert")} disabled={disabled} data-testid="space-action-convert">
                    <Users className="h-5 w-5 text-primary flex-none" aria-hidden="true" />
                    <span className="flex-1">
                        Convertir en grupo
                        <span className="block text-[12.5px] font-normal text-muted-foreground">Para compartir con más de 2 personas.</span>
                    </span>
                </button>
            )}

            {confirming === "settle" && (
                <CriticalActionSheet
                    testId="settle-sheet"
                    title={`¿Cerrar las cuentas de ${spaceName}?`}
                    consequences={SETTLING_CONSEQUENCES}
                    confirmLabel="Empezar a cerrar cuentas"
                    busy={busy === "settle"}
                    error={error?.message}
                    errorHref={error?.href}
                    onConfirm={() =>
                        patch({ status: SpaceStatus.SETTLING }, "settle", () =>
                            showToast("Estáis cerrando cuentas. Ahora saldad las deudas.", {
                                label: "Ver qué falta",
                                href: `/spaces/${spaceId}/close`,
                            }),
                        )
                    }
                    onClose={close}
                />
            )}
            {confirming === "reopen" && (
                <CriticalActionSheet
                    testId="reopen-sheet"
                    title={`¿Reabrir ${spaceName}?`}
                    consequences={REOPEN_CONSEQUENCES}
                    confirmLabel="Reabrir espacio"
                    busy={busy === "reopen"}
                    error={error?.message}
                    errorHref={error?.href}
                    onConfirm={() =>
                        patch({ status: SpaceStatus.ACTIVE }, "reopen", () => showToast("Espacio reabierto: ya podéis añadir gastos."))
                    }
                    onClose={close}
                />
            )}
            {confirming === "convert" && (
                <CriticalActionSheet
                    testId="convert-sheet"
                    title={`¿Convertir ${spaceName} en grupo?`}
                    consequences={CONVERT_CONSEQUENCES}
                    reversible={false}
                    confirmLabel="Convertir en grupo"
                    busy={busy === "convert"}
                    error={error?.message}
                    onConfirm={() => patch({ type: SpaceType.GROUP }, "convert", () => showToast(`${spaceName} ya es un grupo`))}
                    onClose={close}
                />
            )}
            {toast && <EqToast action={toastAction}>{toast}</EqToast>}
        </div>
    );
}

/**
 * Inline "Convertir en grupo" next to "La pareja está completa" (Invitaciones,
 * OWNER/ADMIN of an ACTIVE full couple): the same sheet and toast as Gestión.
 * Stays mounted after the conversion (`visible` turns false) so the toast is
 * not lost when the refreshed page no longer offers it.
 */
export function ConvertToGroupInline({ spaceId, spaceName, visible }: { spaceId: string; spaceName: string; visible: boolean }) {
    const { patch, busy, confirming, open, close, error, disabled } = useSpacePatch(spaceId);
    const [toast, showToast] = useEqToast(3500);

    return (
        <>
            {visible && (
                <button
                    type="button"
                    onClick={() => open("convert")}
                    disabled={disabled}
                    data-testid="invite-convert"
                    className="-mt-2.5 self-start min-h-11 flex items-center text-[13px] font-semibold text-primary disabled:opacity-50"
                >
                    Convertir en grupo
                </button>
            )}
            {confirming === "convert" && (
                <CriticalActionSheet
                    testId="convert-sheet"
                    title={`¿Convertir ${spaceName} en grupo?`}
                    consequences={CONVERT_CONSEQUENCES}
                    reversible={false}
                    confirmLabel="Convertir en grupo"
                    busy={busy === "convert"}
                    error={error?.message}
                    onConfirm={() => patch({ type: SpaceType.GROUP }, "convert", () => showToast(`${spaceName} ya es un grupo`))}
                    onClose={close}
                />
            )}
            {toast && <EqToast>{toast}</EqToast>}
        </>
    );
}

/**
 * "Archivar espacio" (danger zone, OWNER/ADMIN, only while SETTLING). The
 * sheet always opens; when the page already knows the space can't be archived
 * (`blockReason`), the CTA is disabled with the reason and a way to /close.
 * A 409 from the server (state changed meanwhile) is still painted.
 */
export function ArchiveSpaceAction({
    spaceId,
    spaceName,
    blockReason,
}: {
    spaceId: string;
    spaceName: string;
    blockReason: string | null;
}) {
    const { patch, busy, confirming, open, close, error, disabled } = useSpacePatch(spaceId);

    return (
        <>
            <div className={card}>
                <button
                    type="button"
                    className={cn(row, "text-destructive")}
                    onClick={() => open("archive")}
                    disabled={disabled}
                    data-testid="space-action-archive"
                >
                    <Archive className="h-5 w-5 flex-none" aria-hidden="true" />
                    <span className="flex-1">
                        Archivar espacio
                        <span className="block text-[12.5px] font-normal text-muted-foreground">Solo cuando no queden deudas ni pagos por confirmar.</span>
                    </span>
                </button>
            </div>
            {confirming === "archive" && (
                <CriticalActionSheet
                    testId="archive-sheet"
                    title={`¿Archivar ${spaceName}?`}
                    tone="danger"
                    consequences={[
                        "Quedará solo para consultar: nadie podrá añadir gastos, saldar ni cambiar nada.",
                        "Los gastos y los pagos se conservan.",
                    ]}
                    reversible={false}
                    confirmLabel="Archivar para siempre"
                    confirmDisabled={!!blockReason}
                    disabledReason={blockReason}
                    secondary={blockReason ? { label: "Ver qué falta", href: `/spaces/${spaceId}/close` } : undefined}
                    busy={busy === "archive"}
                    error={error?.message}
                    errorHref={error?.href}
                    onConfirm={() => patch({ status: SpaceStatus.ARCHIVED }, "archive")}
                    onClose={close}
                />
            )}
        </>
    );
}
