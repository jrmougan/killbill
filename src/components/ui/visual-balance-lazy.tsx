"use client";

import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";

interface VisualBalanceProps {
    balance: number;
    user1: { name: string; avatar: string | null };
    user2: { name: string; avatar: string | null };
    className?: string;
}

// Skeleton placeholder while the real component loads
function VisualBalanceSkeleton({ className }: { className?: string }) {
    return (
        <div className={cn("relative flex flex-col items-center justify-center py-12", className)}>
            {/* The Pivot Structure */}
            <div className="absolute bottom-0 w-12 h-1 bg-[color:var(--line-strong)] rounded-full" />
            <div className="absolute bottom-0 w-1 h-32 bg-[color:var(--line)]" />

            <div className="relative w-full max-w-[280px] h-40 flex items-center justify-center">
                <div className="relative w-full flex items-center justify-center">
                    {/* The Beam */}
                    <div className="w-full h-[2px] bg-[color:var(--line-strong)] rounded-full" />

                    {/* User 1 Placeholder */}
                    <div className="absolute left-0 -translate-x-1/2 flex flex-col items-center">
                        <div className="w-16 h-16 rounded-full bg-secondary animate-pulse" />
                        <span className="text-[10px] font-bold uppercase tracking-tighter mt-2 text-muted-foreground">...</span>
                    </div>

                    {/* User 2 Placeholder */}
                    <div className="absolute right-0 translate-x-1/2 flex flex-col items-center">
                        <div className="w-16 h-16 rounded-full bg-secondary animate-pulse" />
                        <span className="text-[10px] font-bold uppercase tracking-tighter mt-2 text-muted-foreground">...</span>
                    </div>
                </div>
            </div>

            {/* Scale Center Pivot Point */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-[color:var(--ink-3)]" />
        </div>
    );
}

export const VisualBalanceLazy = dynamic<VisualBalanceProps>(
    () => import("./visual-balance").then(mod => mod.VisualBalance),
    {
        ssr: false,
        loading: () => <VisualBalanceSkeleton />
    }
);
