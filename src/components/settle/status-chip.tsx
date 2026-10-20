import { cn } from "@/lib/utils";
import { getSettlementChipLabel } from "@/lib/settlement-labels";

/**
 * Small status pill for a settlement (Pendiente de confirmar / Confirmado /
 * Rechazado, or "No recibido" when `side="payer"` looks at a rejected one).
 */
export function SettlementStatusChip({ status, side, className }: { status: string; side?: "payer" | "receiver"; className?: string }) {
    return (
        <span
            data-status={status}
            className={cn(
                "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
                status === "CONFIRMED" && "bg-[var(--positive-tint)] text-[color:var(--positive)]",
                status === "REJECTED" && "bg-[var(--negative-tint)] text-[color:var(--negative-ink)]",
                status !== "CONFIRMED" && status !== "REJECTED" && "bg-[var(--track)] text-muted-foreground",
                className
            )}
        >
            {getSettlementChipLabel(status, side)}
        </span>
    );
}
