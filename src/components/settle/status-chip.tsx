import { cn } from "@/lib/utils";
import { getSettlementStatusLabel } from "@/lib/settlement-labels";

/** Small status pill for a settlement (Pendiente / Confirmado / Rechazado). */
export function SettlementStatusChip({ status, className }: { status: string; className?: string }) {
    return (
        <span
            data-status={status}
            className={cn(
                "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
                status === "CONFIRMED" && "bg-[var(--positive-tint)] text-[color:var(--positive)]",
                status === "REJECTED" && "bg-[var(--negative-tint)] text-[color:var(--negative)]",
                status !== "CONFIRMED" && status !== "REJECTED" && "bg-[var(--track)] text-muted-foreground",
                className
            )}
        >
            {getSettlementStatusLabel(status)}
        </span>
    );
}
