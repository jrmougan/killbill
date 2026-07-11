import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { formatCurrency } from "@/lib/currency";
import type { ListSummary } from "@/lib/list-read";

/** Index card for a shopping list: name, item counts and the checked total. */
export function ListCard({ list }: { list: ListSummary }) {
    return (
        <Link href={`/lists/${list.id}`} className="block">
            <GlassCard className="p-4 flex items-center gap-3 hover:bg-secondary/50 transition-colors">
                <div className="flex-1 min-w-0">
                    <p className="font-semibold text-foreground truncate">{list.name}</p>
                    {list.description && (
                        <p className="text-xs text-muted-foreground truncate">{list.description}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-0.5">
                        {list.itemCount === 0
                            ? "Sin artículos"
                            : `${list.checkedCount}/${list.itemCount} comprados`}
                        {list.totalCents > 0 && ` · ${formatCurrency(list.totalCents)}`}
                    </p>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
            </GlassCard>
        </Link>
    );
}
