import { EqCard } from "@/components/ui/eq";
import type { CategorySlice } from "@/lib/home-format";

/** Green ramp of the top-3 categories (prototype 2a); the rest stays on the track. */
const RAMP = ["var(--accent-hex)", "var(--accent-soft)", "var(--accent-softer)"];

/**
 * "Octubre en Casa" card: month total + a stacked bar of the category split
 * (top-3 in the accent ramp, colours inline) and the top-3 categories with
 * their share, in the same order as the bar.
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
                <span className="min-w-0 text-[13px] text-muted-foreground line-clamp-2 break-words">{title}</span>
                <span className="flex-none whitespace-nowrap text-[17px] font-bold">{total}</span>
            </div>
            <div
                className="flex h-1.5 gap-0.5 overflow-hidden rounded-[3px] bg-[var(--track)]"
                aria-hidden="true"
            >
                {slices.slice(0, 3).map((s, i) => (
                    <div key={s.key} style={{ flex: `${s.cents} 1 0`, backgroundColor: RAMP[i] }} />
                ))}
                {slices.length > 3 && (
                    <div style={{ flex: `${slices.slice(3).reduce((a, s) => a + s.cents, 0)} 1 0` }} />
                )}
            </div>
            <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-muted-foreground">
                {slices.length === 0 ? (
                    <span>Sin gastos todavía</span>
                ) : (
                    slices.slice(0, 3).map((s) => (
                        <span key={s.key}>
                            {s.label} {s.pct}%
                        </span>
                    ))
                )}
            </div>
        </EqCard>
    );
}
