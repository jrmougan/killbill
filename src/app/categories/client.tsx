"use client";

import { useEffect, useState } from "react";
import {
    Plus,
    Pencil,
    Trash2,
    ChevronUp,
    ChevronDown,
    Copy,
    Loader2,
    Info,
    MoreHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EqCard, EqCta, EqHeader } from "@/components/ui/eq";
import { CategoryBadge } from "@/components/category/category-badge";
import { CategoryEditor } from "@/components/category/category-editor";
import { DeleteCategoryModal } from "@/components/category/delete-category-modal";
import { useCategoryList } from "@/components/category/use-category-list";
import { Sheet } from "@/components/ui/sheet";
import { ScopeRadio } from "@/components/category/scope-radio";
import { usePersonalMode } from "@/app/settings/personal-mode";
import { withPersonal } from "@/app/settings/personal-scope";
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
    /** Came from personal mode (`?scope=personal`): open on Personal, back keeps it. */
    personalParam?: boolean;
}

export function CategoriesClient({
    hasGroup,
    groupId,
    spaceStatus,
    role,
    canManageShared,
    sharedInitial,
    personalInitial,
    personalParam = false,
}: CategoriesClientProps) {
    const personalMode = usePersonalMode(personalParam);
    const [scope, setScope] = useState<Scope>(hasGroup && !personalParam ? "shared" : "personal");
    // The nav's remembered personal mode resolves after mount.
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot sync with sessionStorage
        if (personalMode) setScope("personal");
    }, [personalMode]);

    const context: CategoryContext =
        scope === "shared" && groupId ? { kind: "shared", groupId } : { kind: "personal" };

    const seed = scope === "shared" ? sharedInitial : personalInitial;
    const { categories, loading, error, reload } = useCategoryList(context, seed);

    // Personal categories are always self-managed; shared CRUD is gated on the
    // server (OWNER/ADMIN + writable space).
    const canManage = scope === "personal" ? true : canManageShared;

    const [editing, setEditing] = useState<CategoryListItem | null | undefined>(undefined); // undefined = closed, null = create
    const [deleting, setDeleting] = useState<CategoryListItem | null>(null);
    // Custom row whose "more" menu (reorder, duplicate) is open.
    const [menuFor, setMenuFor] = useState<CategoryListItem | null>(null);
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
                ? "El espacio está archivado o cerrando cuentas: las categorías están bloqueadas."
                : "No puedes gestionar las categorías de este espacio."
            : null;

    return (
        <div className="flex flex-col min-h-screen pt-[max(12px,env(safe-area-inset-top))] pb-24">
            <EqHeader title="Categorías" back={withPersonal("/settings", personalMode)} />
            <div className="flex flex-col gap-4 px-5 pt-5">

                {hasGroup && (
                    <ScopeRadio
                        label="Ámbito de las categorías"
                        personal={scope === "personal"}
                        onChange={(p) => { setScope(p ? "personal" : "shared"); setEditing(undefined); setDeleting(null); }}
                    />
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
                            return (
                                <div key={cat.id} className="py-3 flex items-center gap-3 border-b border-[color:var(--line-2)] last:border-b-0">
                                    <CategoryBadge meta={cat} variant="emoji" size={40} radius={12} />
                                    {canManage && !cat.isSystem ? (
                                        // Custom rows: the name opens the editor (44 px tall tap target).
                                        <button
                                            type="button"
                                            onClick={() => setEditing(cat)}
                                            aria-label={`Editar ${cat.label}`}
                                            className="min-w-0 flex-1 min-h-11 text-left rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                        >
                                            <CategoryRowText cat={cat} />
                                        </button>
                                    ) : (
                                        <div className="min-w-0 flex-1">
                                            <CategoryRowText cat={cat} />
                                        </div>
                                    )}

                                    {canManage && (
                                        <div className="flex items-center shrink-0 -mr-2">
                                            {cat.isSystem ? (
                                                <button
                                                    type="button"
                                                    className={rowIconCls}
                                                    onClick={() => duplicate(cat.id)}
                                                    disabled={duplicating !== null}
                                                    aria-label={`Duplicar ${cat.label}`}
                                                    title="Duplicar"
                                                >
                                                    {duplicating === cat.id ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <Copy className="h-[18px] w-[18px]" />}
                                                </button>
                                            ) : (
                                                <>
                                                    <button
                                                        type="button"
                                                        className={rowIconCls}
                                                        onClick={() => setMenuFor(cat)}
                                                        aria-label={`Más opciones de ${cat.label}`}
                                                    >
                                                        <MoreHorizontal className="h-5 w-5" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className={cn(rowIconCls, "hover:text-destructive")}
                                                        onClick={() => setDeleting(cat)}
                                                        aria-label={`Eliminar ${cat.label}`}
                                                    >
                                                        <Trash2 className="h-[18px] w-[18px]" />
                                                    </button>
                                                </>
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

            {menuFor && (() => {
                const idx = customList.findIndex((c) => c.id === menuFor.id);
                const run = (fn: () => void) => () => {
                    setMenuFor(null);
                    fn();
                };
                return (
                    <Sheet title={menuFor.label} onClose={() => setMenuFor(null)}>
                        <div className="bg-card rounded-2xl border border-[color:var(--line-2)] px-4">
                            <MenuRow icon={Pencil} label="Editar" onClick={run(() => setEditing(menuFor))} />
                            <MenuRow icon={ChevronUp} label="Subir" disabled={idx <= 0 || reordering} onClick={run(() => move(menuFor.id, -1))} />
                            <MenuRow
                                icon={ChevronDown}
                                label="Bajar"
                                disabled={idx < 0 || idx >= customList.length - 1 || reordering}
                                onClick={run(() => move(menuFor.id, 1))}
                            />
                            <MenuRow icon={Copy} label="Duplicar" disabled={duplicating !== null} onClick={run(() => duplicate(menuFor.id))} />
                            <MenuRow icon={Trash2} label="Eliminar" danger last onClick={run(() => setDeleting(menuFor))} />
                        </div>
                    </Sheet>
                );
            })()}

            {deleting && (
                <DeleteCategoryModal
                    context={context}
                    category={deleting}
                    categories={categories}
                    onDeleted={onDeleted}
                    onCancel={() => setDeleting(null)}
                />
            )}
        </div>
    );
}

const rowIconCls =
    "h-11 w-11 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors";

function CategoryRowText({ cat }: { cat: CategoryListItem }) {
    return (
        <>
            <span className="block text-[15px] font-semibold text-foreground line-clamp-2 break-words">{cat.label}</span>
            <span className="flex items-center gap-2 mt-0.5">
                <span
                    className="h-3 w-3 rounded-full shrink-0 border border-[color:var(--line)]"
                    style={{ backgroundColor: cat.hex }}
                    aria-hidden
                />
                <span className="text-xs text-muted-foreground">{cat.isSystem ? "Sistema" : "Propia"}</span>
            </span>
        </>
    );
}

function MenuRow({
    icon: Icon,
    label,
    onClick,
    danger,
    disabled,
    last,
}: {
    icon: typeof Pencil;
    label: string;
    onClick: () => void;
    danger?: boolean;
    disabled?: boolean;
    last?: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={cn(
                "w-full flex items-center gap-3 py-3.5 text-left text-[15px] disabled:opacity-40",
                !last && "border-b border-[color:var(--line-2)]",
                danger && "text-destructive",
            )}
        >
            <Icon className={cn("h-[19px] w-[19px]", !danger && "text-muted-foreground")} />
            {label}
        </button>
    );
}
