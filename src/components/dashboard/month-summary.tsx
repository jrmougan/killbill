import { EqCard } from "@/components/ui/eq";
import type { CategorySlice } from "@/lib/home-format";

/**
 * "Octubre en Casa" card: month total + a stacked bar of the category split
 * (colours inline from each category's `hex` — never a dynamic tailwind class)
 * and the top-3 categories with their share.
 */
export function MonthSummary({
    title,
    total,
    slices,
}: {
    title: string;
    total: string;
    slices: CategorySlice[];
}) {
    return (
        <EqCard data-testid="month-summary" className="p-4 flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] text-muted-foreground truncate">{title}</span>
                <span className="text-[17px] font-bold">{total}</span>
            </div>
            <div
                className="flex h-1.5 gap-0.5 overflow-hidden rounded-[3px] bg-[var(--track)]"
                aria-hidden="true"
            >
                {slices.map((s) => (
                    <div key={s.key} style={{ flex: `${s.cents} 1 0`, backgroundColor: s.hex }} />
                ))}
            </div>
            <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-muted-foreground">
                {slices.length === 0 ? (
                    <span>Sin gastos todavía</span>
                ) : (
                    slices.slice(0, 3).map((s) => (
                        <span key={s.key} className="flex items-center gap-1.5">
                            <span className="h-[7px] w-[7px] rounded-sm" style={{ backgroundColor: s.hex }} aria-hidden="true" />
                            {s.label} {s.pct}%
                        </span>
                    ))
                )}
            </div>
        </EqCard>
    );
}
