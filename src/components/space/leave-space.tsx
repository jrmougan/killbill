"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import { setFlashToast } from "@/lib/flash-toast";
import { CriticalActionSheet } from "@/components/ui/critical-action-sheet";
import { AskToConfirmButton } from "@/components/settle/settlement-actions";

/** My own PENDING payment in this space (not in the ledger until confirmed). */
export type LeavePendingPayment = { id: string; toName: string; amountCents: number; method: string };

/** Within ±1 cent the balance is closed (same tolerance as `hasOpenBalance`). */
const isOpen = (cents: number) => Math.abs(cents) > 1;

function joinNames(names: string[]): string {
    return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

/**
 * "Salir del espacio" (CF-19). The page precomputes my balance, who I owe,
 * my own PENDING payment and whether I'm the last owner/person, so the FIRST
 * sheet already tells the truth instead of waiting for a 409:
 *  - last owner with others left → "Elegir persona propietaria" (opens the ···
 *    of the first candidate in Miembros);
 *  - open balance → "Saldar deuda" as the main action; "Salir sin saldar" is a
 *    second step that needs an explicit checkbox before `?force=1`;
 *  - settled → a danger sheet with what leaving means.
 * The 409s of DELETE /api/spaces/[id]/members/[me] are still handled (the
 * page data may be stale): they switch the sheet to the matching state.
 */
export function LeaveSpace({
    spaceId,
    userId,
    spaceName,
    balanceCents = 0,
    creditors = [],
    pendingPayment = null,
    lastOwner = false,
    lastPerson = false,
    settleHref,
}: {
    spaceId: string;
    userId: string;
    spaceName: string;
    /** My net balance in this space (cents, + I'm owed). */
    balanceCents?: number;
    /** Who I pay in the simplified plan (names), when I owe. */
    creditors?: string[];
    pendingPayment?: LeavePendingPayment | null;
    /** I'm the only OWNER and other people remain (409 LAST_OWNER). */
    lastOwner?: boolean;
    /** Nobody else is left: leaving hides the space for everyone. */
    lastPerson?: boolean;
    settleHref?: string;
}) {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [step, setStep] = useState<"review" | "force">("review");
    const [ack, setAck] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // What a 409 told us when the page data was stale.
    const [serverOwner, setServerOwner] = useState(false);
    const [serverBalance, setServerBalance] = useState<number | null>(null);
    const [serverSettleUrl, setServerSettleUrl] = useState<string | null>(null);

    const isLastOwner = lastOwner || serverOwner;
    const balance = serverBalance ?? balanceCents;
    const owes = isOpen(balance) && balance < 0;
    const owed = isOpen(balance) && balance > 0;
    const amount = formatCurrency(Math.abs(balance));
    const settleUrl = serverSettleUrl ?? settleHref ?? `/settle?space=${encodeURIComponent(spaceId)}`;

    const leave = async (force: boolean) => {
        setBusy(true);
        setError(null);
        try {
            const res = await fetch(`/api/spaces/${spaceId}/members/${userId}${force ? "?force=1" : ""}`, { method: "DELETE" });
            const data = await res.json().catch(() => null);
            if (res.ok) {
                setFlashToast(`Has salido de ${spaceName}. Tu historial se conserva.`);
                router.push("/dashboard");
                router.refresh();
                return;
            }
            if (res.status === 409 && data?.code === "LAST_OWNER") {
                setServerOwner(true);
                setStep("review");
                return;
            }
            if (res.status === 409 && data?.code === "HAS_BALANCE" && typeof data.balanceCents === "number") {
                setServerBalance(data.balanceCents);
                if (typeof data.settleUrl === "string") setServerSettleUrl(data.settleUrl);
                setStep("review");
                return;
            }
            setError(data?.error || "No se pudo salir del espacio");
        } catch {
            setError("Sin conexión. Inténtalo de nuevo.");
        } finally {
            setBusy(false);
        }
    };

    const openSheet = () => {
        setStep("review");
        setAck(false);
        setError(null);
        setOpen(true);
    };
    const close = () => setOpen(false);

    /** Closes the sheet and opens the ··· of the first member who can be made owner. */
    const pickOwner = () => {
        setOpen(false);
        setTimeout(() => {
            document.getElementById("members-title")?.scrollIntoView({ block: "start", behavior: "smooth" });
            document.querySelector<HTMLButtonElement>("[data-owner-candidate]")?.click();
        }, 0);
    };

    let sheet: React.ReactNode = null;
    if (open && isLastOwner) {
        sheet = (
            <CriticalActionSheet
                testId="leave-sheet"
                title="Antes de salir"
                consequences={[
                    `Eres la única persona propietaria de ${spaceName}. Antes de salir, haz propietaria a otra persona.`,
                ]}
                confirmLabel="Elegir persona propietaria"
                error={error}
                onConfirm={pickOwner}
                onClose={close}
            />
        );
    } else if (open && (owes || owed) && step === "review") {
        const who = joinNames(creditors);
        // Balances only count ACTIVE members: once I leave, my debt is no longer shown under my name.
        const consequence = owes
            ? `Tienes una deuda de ${amount} en ${spaceName}. Si sales sin saldarla, dejará de aparecer a tu nombre y ${who || "el resto"} no podrá${creditors.length > 1 ? "n" : ""} saldarla en la app.`
            : `Te deben ${amount} en ${spaceName}. Si sales ahora, dejarás de verlo y no podrás reclamarlo desde la app.`;
        sheet = (
            <CriticalActionSheet
                testId="leave-sheet"
                title={owes ? "Antes de salir, salda tu deuda" : "Antes de salir, cobra lo que te deben"}
                consequences={[consequence]}
                confirmLabel="Saldar deuda"
                secondary={{ label: "Salir sin saldar", tone: "danger", onClick: () => { setAck(false); setError(null); setStep("force"); } }}
                busy={busy}
                error={error}
                onConfirm={() => router.push(settleUrl)}
                onClose={close}
            >
                {owes && pendingPayment && (
                    <div className="flex flex-col gap-2" data-testid="leave-pending">
                        <p>
                            Ya marcaste un pago de {formatCurrency(pendingPayment.amountCents)} a {pendingPayment.toName}. Falta que lo confirme.
                        </p>
                        <AskToConfirmButton
                            id={pendingPayment.id}
                            toName={pendingPayment.toName}
                            amountCents={pendingPayment.amountCents}
                            method={pendingPayment.method}
                            spaceName={spaceName}
                        />
                    </div>
                )}
            </CriticalActionSheet>
        );
    } else if (open && (owes || owed)) {
        sheet = (
            <CriticalActionSheet
                testId="leave-sheet"
                tone="danger"
                title="¿Salir sin saldar?"
                consequences={[
                    owes
                        ? creditors.length > 1
                            ? `Tu deuda de ${amount} dejará de aparecer a tu nombre: ${joinNames(creditors)} verán que les deben dinero, pero no podrán cobrarlo en la app.`
                            : `Tu deuda de ${amount} dejará de aparecer a tu nombre: ${joinNames(creditors) || "el resto"} verá que le deben ${amount}, pero no podrá cobrarlo en la app.`
                        : `Dejarás de ver los ${amount} que te deben.`,
                    `Dejarás de ver ${spaceName} en Inicio. Tu historial de gastos se conserva.`,
                ]}
                confirmLabel="Salir sin saldar"
                confirmDisabled={!ack}
                disabledReason="Marca la casilla para continuar."
                secondary={{ label: "Volver", onClick: () => setStep("review") }}
                busy={busy}
                error={error}
                onConfirm={() => {
                    if (ack) void leave(true);
                }}
                onClose={close}
            >
                <label className="flex min-h-11 items-start gap-3 text-foreground">
                    <input
                        type="checkbox"
                        checked={ack}
                        onChange={(e) => setAck(e.target.checked)}
                        disabled={busy}
                        data-testid="leave-ack"
                        className="mt-0.5 h-5 w-5 flex-none accent-[color:var(--destructive)]"
                    />
                    <span>Entiendo que la deuda de {amount} queda sin saldar</span>
                </label>
            </CriticalActionSheet>
        );
    } else if (open) {
        sheet = (
            <CriticalActionSheet
                testId="leave-sheet"
                tone="danger"
                title={`¿Salir de ${spaceName}?`}
                consequences={[
                    lastPerson
                        ? `Eres la última persona en ${spaceName}. Al salir, nadie podrá verlo.`
                        : `Dejarás de ver ${spaceName} en Inicio. Para volver necesitarás un enlace nuevo.`,
                    "Tu historial de gastos se conserva.",
                ]}
                confirmLabel="Salir del espacio"
                busy={busy}
                error={error}
                onConfirm={() => void leave(false)}
                onClose={close}
            />
        );
    }

    return (
        <>
            <button
                type="button"
                onClick={openSheet}
                data-testid="leave-space"
                className="w-full min-h-14 rounded-[18px] bg-card border border-[color:var(--line-2)] px-4 flex items-center gap-3 text-[15px] font-semibold text-destructive"
            >
                <LogOut className="h-5 w-5" aria-hidden="true" />
                Salir del espacio
            </button>
            {sheet}
        </>
    );
}
