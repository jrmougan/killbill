"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import { ConfirmSheet } from "./confirm-sheet";

type Block =
    | { code: "LAST_OWNER"; error: string }
    | { code: "HAS_BALANCE"; error: string; balanceCents: number; settleUrl?: string };

/**
 * "Salir del espacio" with the API contract of
 * DELETE /api/spaces/[id]/members/[me]:
 *  - 409 LAST_OWNER → explain that someone else must be made owner first;
 *  - 409 HAS_BALANCE → show the balance, link to settle, and offer "Salir
 *    igualmente" which repeats the call with `?force=1`.
 */
export function LeaveSpace({ spaceId, userId, spaceName }: { spaceId: string; userId: string; spaceName: string }) {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [block, setBlock] = useState<Block | null>(null);
    const [error, setError] = useState<string | null>(null);

    const leave = async (force: boolean) => {
        setBusy(true);
        setError(null);
        try {
            const res = await fetch(`/api/spaces/${spaceId}/members/${userId}${force ? "?force=1" : ""}`, { method: "DELETE" });
            const data = await res.json().catch(() => null);
            if (res.ok) {
                router.push("/dashboard");
                router.refresh();
                return;
            }
            if (res.status === 409 && (data?.code === "LAST_OWNER" || data?.code === "HAS_BALANCE")) {
                setBlock(data as Block);
                return;
            }
            setError(data?.error || "No se pudo salir del espacio");
        } catch {
            setError("Sin conexión. Inténtalo de nuevo.");
        } finally {
            setBusy(false);
        }
    };

    const close = () => {
        setOpen(false);
        setBlock(null);
        setError(null);
    };

    let body: React.ReactNode = <>Dejarás de ver {spaceName} en Inicio. Tu historial de gastos se conserva.</>;
    let confirmLabel = "Salir del espacio";
    let onConfirm: () => void = () => void leave(false);
    let errorMsg: string | null = error;
    let errorHref: string | null = null;
    if (block?.code === "LAST_OWNER") {
        body = <>Eres la única persona propietaria de {spaceName}. Antes de salir, haz propietaria a otra persona desde Miembros (botón ··· junto a su nombre).</>;
        confirmLabel = "Entendido";
        onConfirm = close;
    } else if (block?.code === "HAS_BALANCE") {
        const owes = block.balanceCents < 0;
        body = (
            <>
                {owes
                    ? `Todavía debes ${formatCurrency(Math.abs(block.balanceCents))} en ${spaceName}.`
                    : `Todavía te deben ${formatCurrency(block.balanceCents)} en ${spaceName}.`}{" "}
                Lo mejor es quedar en paz antes de salir. Si sales igualmente, la deuda queda en el historial pero dejarás de verla.
            </>
        );
        confirmLabel = "Salir igualmente";
        onConfirm = () => void leave(true);
        errorMsg = error ?? "Tienes saldo pendiente.";
        errorHref = block.settleUrl ?? `/settle?space=${encodeURIComponent(spaceId)}`;
    }

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                data-testid="leave-space"
                className="w-full min-h-14 rounded-[18px] bg-card border border-[color:var(--line-2)] px-4 flex items-center gap-3 text-[15px] font-semibold text-destructive"
            >
                <LogOut className="h-5 w-5" aria-hidden="true" />
                Salir del espacio
            </button>
            {open && (
                <ConfirmSheet
                    testId="leave-sheet"
                    title={block?.code === "LAST_OWNER" ? "Antes de salir" : "¿Salir del espacio?"}
                    confirmLabel={confirmLabel}
                    tone={block?.code === "LAST_OWNER" ? "primary" : "danger"}
                    busy={busy}
                    error={errorMsg}
                    errorHref={errorHref}
                    onConfirm={onConfirm}
                    onClose={close}
                >
                    {body}
                </ConfirmSheet>
            )}
        </>
    );
}
