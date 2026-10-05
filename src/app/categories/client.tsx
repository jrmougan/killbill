"use client";

import { useState } from "react";
import {
    Plus,
    Pencil,
    Trash2,
    ChevronUp,
    ChevronDown,
    Copy,
    Loader2,
    Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EqCard, EqCta, EqHeader } from "@/components/ui/eq";
import { cn } from "@/lib/utils";
import { CategoryBadge } from "@/components/category/category-badge";
import { CategoryEditor } from "@/components/category/category-editor";
import { DeleteCategoryModal } from "@/components/category/delete-category-modal";
import { useCategoryList } from "@/components/category/use-category-list";
import { Sheet } from "@/components/shopping/sheet";
import {
    type CategoryContext,
    type CategoryListItem,
    categoriesEndpoint,
    duplicateCategoryEndpoint,
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
    const [duplicating, setDuplicating] = useState<string | null>(null);

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

    // Duplicate any category (system or custom) into an editable custom of this
    // context (Fase 6). The server derives a fresh non-reserved key + "(copia)"
    // label and copies emoji/icon/color.
    const duplicate = async (id: string) => {
        if (duplicating) return;
        setDuplicating(id);
        try {
            const res = await fetch(duplicateCategoryEndpoint(context), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sourceId: id }),
            });
            if (res.ok) await reload();
        } finally {
            setDuplicating(null);
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
        <div className="flex flex-col min-h-screen pt-[max(12px,env(safe-area-inset-top))] pb-24">
            <EqHeader title="Categorías" back="/settings" />
            <div className="flex flex-col gap-4 px-5 pt-5">

                {hasGroup && (
                    <div className="flex rounded-xl bg-[var(--track)] p-[3px]">
                        {([["shared", "Común"], ["personal", "Personal"]] as const).map(([key, label]) => (
                            <button
                                key={key}
                                type="button"
                                onClick={() => { setScope(key); setEditing(undefined); setDeleting(null); }}
                                aria-pressed={scope === key}
                                className={cn(
                                    "flex-1 rounded-[10px] py-2 text-sm font-semibold transition-colors",
                                    scope === key ? "bg-card text-foreground" : "text-muted-foreground"
                                )}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                )}

                {canManage && (
                    <EqCta className="h-12 rounded-2xl text-[15px]" onClick={() => setEditing(null)}>
                        <Plus className="h-4 w-4" /> Nueva categoría
                    </EqCta>
                )}

                {sharedBlockedReason && (
                    <div className="flex items-start gap-2 rounded-[14px] bg-card border border-[color:var(--line-2)] px-3 py-2.5 text-xs text-muted-foreground">
                        <Info className="h-4 w-4 shrink-0 mt-px" />
                        <span>{sharedBlockedReason}</span>
                    </div>
                )}

                {loading ? (
                    <div className="flex items-center justify-center py-12 text-muted-foreground">
                        <Loader2 className="h-6 w-6 animate-spin" />
                    </div>
                ) : error ? (
                    <EqCard className="p-6 text-center space-y-3">
                        <p className="text-sm text-destructive">{error}</p>
                        <Button variant="ghost" onClick={reload}>Reintentar</Button>
                    </EqCard>
                ) : (
                    <EqCard className="px-4">
                        {categories.map((cat) => {
                            const customIdx = cat.isSystem ? -1 : customList.findIndex((c) => c.id === cat.id);
                            const canMoveUp = canManage && customIdx > 0;
                            const canMoveDown = canManage && customIdx >= 0 && customIdx < customList.length - 1;
                            return (
                                <div key={cat.id} className="py-3 flex items-center gap-3 border-b border-[color:var(--line-2)] last:border-b-0">
                                    <CategoryBadge meta={cat} variant="emoji" size={40} radius={12} />
                                    <div className="min-w-0 flex-1">
                                        <p className="text-[15px] font-semibold text-foreground truncate">{cat.label}</p>
                                        <div className="flex items-center gap-2 mt-0.5">
                                            <span
                                                className="h-3 w-3 rounded-full shrink-0 border border-[color:var(--line)]"
                                                style={{ backgroundColor: cat.hex }}
                                                aria-hidden
                                            />
                                            {cat.isSystem ? (
                                                <span className="text-xs text-muted-foreground">Sistema</span>
                                            ) : (
                                                <span className="text-[11px] text-muted-foreground/70 font-mono">{cat.hex}</span>
                                            )}
                                        </div>
                                    </div>

                                    {canManage && (
                                        <div className="flex items-center gap-0.5 shrink-0">
                                            {!cat.isSystem && (
                                                <>
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
                                                </>
                                            )}
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                className="h-8 w-8 text-muted-foreground hover:text-foreground disabled:opacity-40"
                                                onClick={() => duplicate(cat.id)}
                                                disabled={duplicating !== null}
                                                aria-label={`Duplicar ${cat.label}`}
                                                title="Duplicar"
                                            >
                                                {duplicating === cat.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
                                            </Button>
                                            {!cat.isSystem && (
                                                <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                                    onClick={() => setDeleting(cat)}
                                                    aria-label={`Borrar ${cat.label}`}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}

                    </EqCard>
                )}
                {!loading && !error && customList.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center px-4">
                        {canManage
                            ? "Aún no hay categorías propias. Crea una con «Nueva categoría»."
                            : "Este contexto solo tiene las categorías del sistema."}
                    </p>
                )}
            </div>

            {editing !== undefined && (
                <Sheet title={editing ? "Editar categoría" : "Nueva categoría"} onClose={closeEditor}>
                    <CategoryEditor
                        context={context}
                        existing={editing}
                        onSaved={onSaved}
                        onCancel={closeEditor}
                    />
                </Sheet>
            )}

            {deleting && (
                <Sheet label="Borrar categoría" onClose={() => setDeleting(null)}>
                    <DeleteCategoryModal
                        context={context}
                        category={deleting}
                        categories={categories}
                        onDeleted={onDeleted}
                        onCancel={() => setDeleting(null)}
                    />
                </Sheet>
            )}
        </div>
    );
}
