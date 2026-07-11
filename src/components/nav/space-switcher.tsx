"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setActiveGroup } from "@/app/actions/group";
import { cn } from "@/lib/utils";
import { spaceTypeMeta } from "@/lib/space-ui";
import { SpaceStatus } from "@/generated/prisma/enums";

/**
 * A "space" (espacio) is either the user's PERSONAL economy or a GROUP/familia
 * they belong to. This unifies + replaces the old ScopeSegment (Todo/Común/
 * Personal) + GroupSwitcher dropdown: the header shows the active space (icon
 * tile + name + chevron) and tapping it opens a bottom sheet to switch.
 *
 * Presentation + navigation only — no financial/scope semantics live here:
 *  - Personal  → /dashboard?scope=personal
 *  - Group g   → setActiveGroup(g.id) (revalidates layout) + /dashboard?scope=comun
 */
export type Space = {
    key: string;
    kind: "personal" | "group";
    name: string;
    sub: string;
    /** Space type (COUPLE/GROUP/EPHEMERAL) — drives the icon. Absent for personal. */
    spaceType?: string;
    /** Lifecycle status — ARCHIVED spaces are sectioned separately. */
    status?: string;
};

/** The emoji tile for a space row: personal → 👤, else the type emoji. */
function iconFor(sp: Pick<Space, "kind" | "spaceType">): string {
    if (sp.kind === "personal") return "👤";
    return sp.spaceType ? spaceTypeMeta(sp.spaceType).emoji : "👪";
}

export function SpaceSwitcher({
    spaces,
    activeSpaceKey,
    locked = false,
}: {
    spaces: Space[];
    activeSpaceKey: string;
    /** Guest mode: a guest is caged to one space, so the switcher is display-only. */
    locked?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [pending, startTransition] = useTransition();
    const router = useRouter();

    const active = spaces.find((s) => s.key === activeSpaceKey) ?? spaces[0];
    const activeIsGroup = active?.kind === "group";

    // Section the sheet: live spaces (personal + non-archived) vs archived ones.
    const liveSpaces = spaces.filter((s) => s.status !== SpaceStatus.ARCHIVED);
    const archivedSpaces = spaces.filter((s) => s.status === SpaceStatus.ARCHIVED);

    const select = (sp: Space) => {
        if (sp.key === activeSpaceKey) {
            setOpen(false);
            return;
        }
        if (sp.kind === "personal") {
            router.push("/dashboard?scope=personal");
            router.refresh();
            setOpen(false);
            return;
        }
        startTransition(async () => {
            await setActiveGroup(sp.key);
            router.push("/dashboard?scope=comun");
            router.refresh();
            setOpen(false);
        });
    };

    return (
        <>
            {/* Header space button (left child of the header) */}
            <button
                type="button"
                onClick={locked ? undefined : () => setOpen(true)}
                aria-label={locked ? "Espacio activo" : "Cambiar de espacio"}
                disabled={locked}
                className={cn(
                    "flex items-center gap-[9px] py-1 text-left transition-opacity",
                    locked ? "cursor-default" : "active:opacity-60"
                )}
            >
                <span
                    className={cn(
                        "w-10 h-10 rounded-[12px] shrink-0 flex items-center justify-center text-[19px]",
                        activeIsGroup ? "bg-[var(--positive-tint)]" : "bg-[var(--accent-tint)]"
                    )}
                >
                    {active ? iconFor(active) : "👤"}
                </span>
                <span className="min-w-0">
                    <span className="flex items-center gap-[5px]">
                        <span className="text-[17px] font-bold tracking-[-0.02em] text-foreground truncate">
                            {active?.name}
                        </span>
                        {!locked && (
                            <svg
                                width="15"
                                height="15"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="shrink-0 text-muted-foreground"
                                aria-hidden="true"
                            >
                                <path d="m6 9 6 6 6-6" />
                            </svg>
                        )}
                    </span>
                    <span className="block text-[12px] text-muted-foreground mt-px">
                        {active?.sub}
                    </span>
                </span>
            </button>

            {/* Bottom sheet — never opens while locked (guest). */}
            {open && !locked && (
                <div className="fixed inset-0 z-[80] flex flex-col justify-end">
                    {/* Scrim — tapping it closes the sheet. */}
                    <button
                        type="button"
                        aria-label="Cerrar"
                        onClick={() => setOpen(false)}
                        className="absolute inset-0 bg-[rgba(20,18,15,0.4)] backdrop-blur-[2px] animate-in fade-in duration-200 cursor-default"
                    />
                    <div
                        className="relative bg-background rounded-t-[26px] px-5 pt-[10px] pb-[calc(28px+env(safe-area-inset-bottom))] animate-in slide-in-from-bottom-8 duration-300 ease-out"
                    >
                        {/* Grab handle */}
                        <div className="w-10 h-[5px] rounded-[3px] bg-[rgba(38,35,29,0.15)] mx-auto mb-[18px]" />

                        <h2 className="text-[12px] font-bold tracking-[0.06em] uppercase text-muted-foreground mb-3">
                            Cambiar de espacio
                        </h2>

                        <div className="flex flex-col gap-2">
                            {liveSpaces.map((sp) => {
                                const isActive = sp.key === activeSpaceKey;
                                const isGroup = sp.kind === "group";
                                return (
                                    <button
                                        key={sp.key}
                                        type="button"
                                        onClick={() => select(sp)}
                                        disabled={pending}
                                        className={cn(
                                            "w-full flex items-center gap-[13px] px-[15px] py-[14px] rounded-[16px] bg-card cursor-pointer border active:scale-[0.99] transition-transform disabled:opacity-60",
                                            isActive
                                                ? "border-[color:var(--accent-border)]"
                                                : "border-[color:var(--line-2)]"
                                        )}
                                    >
                                        <span
                                            className={cn(
                                                "w-11 h-11 rounded-[13px] shrink-0 flex items-center justify-center text-[20px]",
                                                isGroup ? "bg-[var(--positive-tint)]" : "bg-[var(--accent-tint)]"
                                            )}
                                        >
                                            {iconFor(sp)}
                                        </span>
                                        <span className="flex-1 text-left min-w-0">
                                            <span className="block text-[15px] font-semibold text-foreground truncate">
                                                {sp.name}
                                            </span>
                                            <span className="block text-[12px] text-muted-foreground mt-px truncate">
                                                {sp.sub}
                                            </span>
                                        </span>
                                        {isActive && (
                                            <svg
                                                width="20"
                                                height="20"
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                stroke="var(--accent-hex)"
                                                strokeWidth="2.4"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                className="shrink-0"
                                                aria-hidden="true"
                                            >
                                                <path d="M20 6 9 17l-5-5" />
                                            </svg>
                                        )}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Archived spaces — read-only "recuerdo del viaje", listed apart. */}
                        {archivedSpaces.length > 0 && (
                            <>
                                <h2 className="text-[12px] font-bold tracking-[0.06em] uppercase text-muted-foreground mt-5 mb-3">
                                    Archivados
                                </h2>
                                <div className="flex flex-col gap-2">
                                    {archivedSpaces.map((sp) => (
                                        <button
                                            key={sp.key}
                                            type="button"
                                            onClick={() => select(sp)}
                                            disabled={pending}
                                            className="w-full flex items-center gap-[13px] px-[15px] py-[14px] rounded-[16px] bg-card cursor-pointer border border-[color:var(--line-2)] opacity-70 active:scale-[0.99] transition-transform disabled:opacity-50"
                                        >
                                            <span className="w-11 h-11 rounded-[13px] shrink-0 flex items-center justify-center text-[20px] bg-secondary grayscale">
                                                {iconFor(sp)}
                                            </span>
                                            <span className="flex-1 text-left min-w-0">
                                                <span className="block text-[15px] font-semibold text-foreground truncate">
                                                    {sp.name}
                                                </span>
                                                <span className="block text-[12px] text-muted-foreground mt-px truncate">
                                                    Archivado
                                                </span>
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}

                        {/* Create / join a space */}
                        <a
                            href="/spaces/new"
                            className="mt-3 w-full flex items-center gap-[11px] px-4 py-[15px] rounded-[14px] border border-dashed border-[color:var(--line-strong)] active:scale-[0.99] transition-transform"
                        >
                            <svg
                                width="20"
                                height="20"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="shrink-0 text-muted-foreground"
                                aria-hidden="true"
                            >
                                <path d="M12 5v14M5 12h14" />
                            </svg>
                            <span className="text-[14px] font-semibold text-[color:var(--body-ink)]">
                                Crear o unirse a un espacio
                            </span>
                        </a>
                    </div>
                </div>
            )}
        </>
    );
}
