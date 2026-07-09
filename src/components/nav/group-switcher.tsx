"use client";

import { useState, useTransition } from "react";
import { ChevronDown, Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { setActiveGroup } from "@/app/actions/group";
import { cn } from "@/lib/utils";

/**
 * Switch the active group (multi-group, F4). Only renders when the user belongs
 * to more than one group. Picking a group sets the `active_group` cookie via a
 * server action and refreshes so every group-scoped surface re-renders.
 */
export function GroupSwitcher({ groups, activeGroupId }: { groups: { id: string; name: string | null }[]; activeGroupId: string }) {
    const [open, setOpen] = useState(false);
    const [pending, startTransition] = useTransition();
    const router = useRouter();

    if (groups.length <= 1) return null;
    const active = groups.find((g) => g.id === activeGroupId);

    const pick = (id: string) => {
        if (id === activeGroupId) { setOpen(false); return; }
        startTransition(async () => {
            await setActiveGroup(id);
            setOpen(false);
            router.refresh();
        });
    };

    return (
        <div className="relative">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground transition-colors"
            >
                <span className="truncate max-w-[160px]">{active?.name ?? "Grupo"}</span>
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
            </button>
            {open && (
                <>
                    <button type="button" aria-label="Cerrar" className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
                    <div className="absolute z-50 mt-1 left-0 min-w-[190px] rounded-xl bg-card border border-[color:var(--line)] shadow-[0_10px_28px_-10px_rgba(0,0,0,0.15)] py-1">
                        {groups.map((g) => (
                            <button
                                key={g.id}
                                type="button"
                                onClick={() => pick(g.id)}
                                disabled={pending}
                                className={cn(
                                    "flex items-center justify-between w-full px-3 py-2.5 text-sm hover:bg-secondary transition-colors disabled:opacity-50",
                                    g.id === activeGroupId ? "text-foreground font-medium" : "text-muted-foreground"
                                )}
                            >
                                <span className="truncate">{g.name ?? "Grupo"}</span>
                                {g.id === activeGroupId && <Check className="h-4 w-4 text-primary shrink-0 ml-2" />}
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}
