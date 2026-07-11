"use client";

import { useState } from "react";
import Link from "next/link";
import {
    ArrowLeft,
    Plus,
    Pencil,
    Trash2,
    ChevronUp,
    ChevronDown,
    Loader2,
    Info,
    X,
} from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { CategoryBadge } from "@/components/category/category-badge";
import { CategoryEditor } from "@/components/category/category-editor";
import { DeleteCategoryModal } from "@/components/category/delete-category-modal";
import { useCategoryList } from "@/components/category/use-category-list";
import {
    type CategoryContext,
    type CategoryListItem,
    categoriesEndpoint,
} from "@/lib/category-context";

type Scope = "shared" | "personal";

interface CategoriesClientProps {
    hasGroup: boolean;
    groupId: string | null;
    /** Status of the active space (for the CRUD-blocked messaging). */
    spaceStatus: string | null;
    /** Caller's role in the active space. */
    role: string | null;
    /** Server-resolved: OWNER/ADMIN + ACTIVE space + type allows (decision #6). */
    canManageShared: boolean;
    sharedInitial: CategoryListItem[];
    personalInitial: CategoryListItem[];
}

/** Lightweight centered modal (no shared component exists yet — mirror promote-button). */
function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
    return (
        <div className="fixed inset-0 bg-[color:var(--ink)]/40 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-6 animate-in fade-in duration-200">
            <div className="bg-card border border-[color:var(--line)] rounded-t-2xl sm:rounded-2xl p-5 max-w-md w-full max-h-[90vh] overflow-y-auto space-y-4 animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200">
                <div className="flex justify-end -mb-2">
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={onClose} aria-label="Cerrar">
                        <X className="h-4 w-4" />
                    </Button>
                </div>
                {children}
            </div>
        </div>
    );
}

export function CategoriesClient({
    hasGroup,
    groupId,
    spaceStatus,
    role,
    canManageShared,
    sharedInitial,
    personalInitial,
}: CategoriesClientProps) {
    const [scope, setScope] = useState<Scope>(hasGroup ? "shared" : "personal");

    const context: CategoryContext =
        scope === "shared" && groupId ? { kind: "shared", groupId } : { kind: "personal" };

    const seed = scope === "shared" ? sharedInitial : personalInitial;
    const { categories, loading, error, reload } = useCategoryList(context, seed);

    // Personal categories are always self-managed; shared CRUD is gated on the
    // server (OWNER/ADMIN + writable space).
    const canManage = scope === "personal" ? true : canManageShared;

    const [editing, setEditing] = useState<CategoryListItem | null | undefined>(undefined); // undefined = closed, null = create
    const [deleting, setDeleting] = useState<CategoryListItem | null>(null);
    const [reordering, setReordering] = useState(false);

    const customList = categories.filter((c) => !c.isSystem);

    const closeEditor = () => setEditing(undefined);
    const onSaved = () => {
        closeEditor();
        reload();
    };
    const onDeleted = () => {
        setDeleting(null);
        reload();
    };

    // Move a custom category up/down among the custom rows, then persist the full
    // custom order (reorderCategoriesForScope expects exactly the scope's custom
    // ids). System rows are fixed in V1 (decision #2).
    const move = async (id: string, dir: -1 | 1) => {
        if (reordering) return;
        const idx = customList.findIndex((c) => c.id === id);
        const swap = idx + dir;
        if (idx < 0 || swap < 0 || swap >= customList.length) return;
        const ordered = [...customList];
        [ordered[idx], ordered[swap]] = [ordered[swap], ordered[idx]];
        setReordering(true);
        try {
            await fetch(categoriesEndpoint(context), {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ order: ordered.map((c) => c.id) }),
            });
            await reload();
        } finally {
            setReordering(false);
        }
    };

    const sharedBlockedReason =
        scope === "shared" && !canManageShared
            ? role !== "OWNER" && role !== "ADMIN"
                ? "Solo un administrador del espacio puede crear o editar las categorías comunes."
                : spaceStatus !== "ACTIVE"
                ? "El espacio está archivado o liquidándose: las categorías están bloqueadas."
                : "No puedes gestionar las categorías de este espacio."
            : null;

    return (
        <div className="flex flex-col min-h-screen p-4 space-y-6 max-w-md mx-auto pb-24">
            <header className="flex items-center gap-4 pt-2">
                <Link href="/settings">
                    <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-secondary">
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                </Link>
                <h1 className="text-xl font-bold text-foreground">Categorías</h1>
            </header>

            {hasGroup && (
                <div className="flex gap-1.5 p-1 rounded-xl bg-secondary border border-[color:var(--line)]">
                    {([["shared", "Común"], ["personal", "Personal"]] as const).map(([key, label]) => (
                        <button
                            key={key}
                            type="button"
                            onClick={() => { setScope(key); setEditing(undefined); setDeleting(null); }}
                            aria-pressed={scope === key}
                            className={`flex-1 h-10 rounded-lg text-sm font-semibold transition-all ${scope === key ? "bg-primary text-white shadow" : "text-muted-foreground"}`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            )}

            {canManage && (
                <Button className="w-full gap-2" onClick={() => setEditing(null)}>
                    <Plus className="h-4 w-4" /> Nueva categoría
                </Button>
            )}

            {sharedBlockedReason && (
                <div className="flex items-start gap-2 rounded-xl bg-secondary border border-[color:var(--line)] px-3 py-2.5 text-xs text-muted-foreground">
                    <Info className="h-4 w-4 shrink-0 mt-px" />
                    <span>{sharedBlockedReason}</span>
                </div>
            )}

            {loading ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin" />
                </div>
            ) : error ? (
                <GlassCard className="p-6 text-center space-y-3">
                    <p className="text-sm text-destructive">{error}</p>
                    <Button variant="ghost" onClick={reload}>Reintentar</Button>
                </GlassCard>
            ) : (
                <section className="space-y-2.5">
                    {categories.map((cat) => {
                        const customIdx = cat.isSystem ? -1 : customList.findIndex((c) => c.id === cat.id);
                        const canMoveUp = canManage && customIdx > 0;
                        const canMoveDown = canManage && customIdx >= 0 && customIdx < customList.length - 1;
                        return (
                            <GlassCard key={cat.id} className="p-3 flex items-center gap-3">
                                <CategoryBadge meta={cat} variant="emoji" size={40} radius={10} />
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold text-foreground truncate">{cat.label}</p>
                                    <div className="flex items-center gap-2 mt-0.5">
                                        <span
                                            className="h-3 w-3 rounded-full shrink-0 border border-[color:var(--line)]"
                                            style={{ backgroundColor: cat.hex }}
                                            aria-hidden
                                        />
                                        {cat.isSystem ? (
                                            <span className="px-1.5 py-px rounded bg-secondary text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                                Sistema
                                            </span>
                                        ) : (
                                            <span className="text-[11px] text-muted-foreground/70 font-mono">{cat.hex}</span>
                                        )}
                                    </div>
                                </div>

                                {canManage && !cat.isSystem && (
                                    <div className="flex items-center gap-0.5 shrink-0">
                                        <div className="flex flex-col">
                                            <button
                                                type="button"
                                                onClick={() => move(cat.id, -1)}
                                                disabled={!canMoveUp || reordering}
                                                aria-label={`Subir ${cat.label}`}
                                                className="text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                                            >
                                                <ChevronUp className="h-4 w-4" />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => move(cat.id, 1)}
                                                disabled={!canMoveDown || reordering}
                                                aria-label={`Bajar ${cat.label}`}
                                                className="text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                                            >
                                                <ChevronDown className="h-4 w-4" />
                                            </button>
                                        </div>
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                            onClick={() => setEditing(cat)}
                                            aria-label={`Editar ${cat.label}`}
                                        >
                                            <Pencil className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                            onClick={() => setDeleting(cat)}
                                            aria-label={`Borrar ${cat.label}`}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                )}
                            </GlassCard>
                        );
                    })}

                    {customList.length === 0 && (
                        <p className="text-xs text-muted-foreground text-center px-4 pt-2">
                            {canManage
                                ? "Aún no hay categorías propias. Crea una con «Nueva categoría»."
                                : "Este contexto solo tiene las categorías del sistema."}
                        </p>
                    )}
                </section>
            )}

            {editing !== undefined && (
                <Modal onClose={closeEditor}>
                    <h2 className="text-base font-bold text-foreground">
                        {editing ? "Editar categoría" : "Nueva categoría"}
                    </h2>
                    <CategoryEditor
                        context={context}
                        existing={editing}
                        onSaved={onSaved}
                        onCancel={closeEditor}
                    />
                </Modal>
            )}

            {deleting && (
                <Modal onClose={() => setDeleting(null)}>
                    <DeleteCategoryModal
                        context={context}
                        category={deleting}
                        categories={categories}
                        onDeleted={onDeleted}
                        onCancel={() => setDeleting(null)}
                    />
                </Modal>
            )}
        </div>
    );
}
