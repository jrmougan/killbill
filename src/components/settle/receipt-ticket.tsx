import { cn } from "@/lib/utils";
import React from "react";

// Zig-zag bottom edge (prototype): a row of 7px half-circles punched out of the
// card bottom with a repeating radial-gradient mask.
const ZIGZAG = "radial-gradient(circle 7px at 50% 100%, transparent 98%, #000) 0 0/16px 100% repeat-x";

/** White "receipt" card with a scalloped bottom edge. */
export function ReceiptTicket({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div
            className={cn(
                "bg-card border border-[color:var(--line)] rounded-t-[10px] px-5 pt-[22px] pb-7 flex flex-col gap-3 text-sm",
                className
            )}
            style={{ WebkitMask: ZIGZAG, mask: ZIGZAG }}
            {...props}
        >
            {children}
        </div>
    );
}

export function TicketRule() {
    return <div aria-hidden className="border-t border-dashed border-[color:rgba(0,0,0,0.18)]" />;
}

export function TicketRow({
    label,
    value,
    muted,
    strong = true,
    testId,
}: {
    label: React.ReactNode;
    value: React.ReactNode;
    muted?: boolean;
    strong?: boolean;
    testId?: string;
}) {
    return (
        <div className={cn("flex justify-between gap-3", muted && "text-muted-foreground")} data-testid={testId}>
            <span className="min-w-0">{label}</span>
            <span className={cn("tabular-nums flex-none", strong && !muted && "font-semibold")}>{value}</span>
        </div>
    );
}
