"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Pencil, Receipt, Trash2, ListX } from "lucide-react";
import { EqChip, EqCta, EqHeader, EqLabel, useEqToast } from "@/components/ui/eq";
import { cn } from "@/lib/utils";
import { AISLES, getAisle } from "@/lib/aisles";
import type { HubList, HubSelected } from "@/app/lists/load";
import { AddItemInput } from "./add-item-input";
import { ShoppingItemRow, type ItemPatch, type ShoppingItem } from "./shopping-item-row";
import { ItemEditSheet } from "./item-edit-sheet";
import { Sheet, SheetField } from "./sheet";
import { buildFinishExpenseUrl } from "./finish-url";

interface ListsHubProps {
    groupId: string | null;
    groupLists: HubList[];
    personalLists: HubList[];
    selected: HubSelected | null;
}

/** Near-live poll of the selected list (no realtime infra). Refreshes only when visible. */
const POLL_MS = 6000;

const AISLE_ORDER = new Map(AISLES.map((a) => [a.key, a.sortOrder]));

/** Group items by aisle, ordered by the shop layout; the null-aisle group last. */
function groupByAisle(items: ShoppingItem[]): { key: string | null; items: ShoppingItem[] }[] {
    const groups = new Map<string | null, ShoppingItem[]>();
    for (const it of items) {
        const key = it.aisle && getAisle(it.aisle) ? it.aisle : null;
        const bucket = groups.get(key);
        if (bucket) bucket.push(it);
        else groups.set(key, [it]);
    }
    return [...groups.entries()]
        .map(([key, its]) => ({ key, items: its }))
        .sort((a, b) => {
            const oa = a.key ? (AISLE_ORDER.get(a.key) ?? 100) : 1000;
            const ob = b.key ? (AISLE_ORDER.get(b.key) ?? 100) : 1000;
            return oa - ob;
        });
}

async function errorOf(res: Response, fallback: string): Promise<string> {
    const data = await res.json().catch(() => ({}));
    return typeof data?.error === "string" ? data.error : fallback;
}

type SheetState =
    | { kind: "new" }
    | { kind: "menu" }
    | { kind: "rename" }
    | { kind: "delete" }
    | { kind: "item"; id: string }
    | null;

/**
 * Listas: chips for every list (Común, then Personal) and the selected list as
 * the main experience — add, tick off by aisle, "En el carro", and the
 * "Terminar y apuntar gasto" shortcut (clears the checked items and opens the
 * add-expense form prefilled; a list NEVER creates an expense by itself).
 */
export function ListsHub({ groupId, groupLists, personalLists, selected }: ListsHubProps) {
    const router = useRouter();
    const [items, setItems] = useState<ShoppingItem[]>(selected?.items ?? []);
    const [sheet, setSheet] = useState<SheetState>(null);
    const [finishing, setFinishing] = useState(false);
    const [toast, showToast] = useEqToast(2400);

    // Server re-renders (poll / focus / navigation to another list) are the
    // source of truth: resync the local optimistic copy.
    useEffect(() => {
        setItems(selected?.items ?? []);
    }, [selected]);

    useEffect(() => {
        const refresh = () => {
            if (document.visibilityState === "visible") router.refresh();
        };
        window.addEventListener("focus", refresh);
        const timer = setInterval(refresh, POLL_MS);
        return () => {
            window.removeEventListener("focus", refresh);
            clearInterval(timer);
        };
    }, [router]);

    const apiBase = selected
        ? selected.groupId
            ? `/api/spaces/${selected.groupId}/lists/${selected.id}`
            : `/api/me/lists/${selected.id}`
        : null;

    const pending = useMemo(() => items.filter((i) => !i.checked), [items]);
    const done = useMemo(() => items.filter((i) => i.checked), [items]);
    const groups = useMemo(() => groupByAisle(pending), [pending]);
    const showAisleHeaders = groups.length > 1 || groups[0]?.key != null;
    const editingItem = sheet?.kind === "item" ? items.find((i) => i.id === sheet.id) : undefined;

    const chipCount = (l: HubList) => (l.id === selected?.id ? pending.length : l.pendingCount);
    const openList = (id: string) => {
        if (id !== selected?.id) router.push(`/lists/${id}`);
    };

    const handleAdd = useCallback(
        async (input: { name: string }): Promise<boolean> => {
            if (!apiBase) return false;
            try {
                const res = await fetch(`${apiBase}/items`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(input),
                });
                if (!res.ok) {
                    showToast(await errorOf(res, "No se pudo añadir el producto"));
                    return false;
                }
                const { item } = await res.json();
                setItems((prev) => [
                    ...prev,
                    {
                        id: item.id,
                        name: item.name,
                        quantity: item.quantity ?? null,
                        unit: item.unit ?? null,
                        note: item.note ?? null,
                        aisle: item.aisle ?? null,
                        checked: false,
                    },
                ]);
                router.refresh();
                return true;
            } catch {
                showToast("No se pudo añadir el producto");
                return false;
            }
        },
        [apiBase, router, showToast],
    );

    // Optimistic toggle; the API is idempotent (condition-by-id updateMany), so a
    // retried or duplicated tap from another member never flips the state twice.
    const handleToggle = useCallback(
        async (item: ShoppingItem) => {
            if (!apiBase) return;
            const checked = !item.checked;
            const set = (value: boolean) =>
                setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, checked: value } : i)));
            set(checked);
            try {
                const res = await fetch(`${apiBase}/items/${item.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ checked }),
                });
                if (!res.ok) {
                    set(!checked);
                    showToast(await errorOf(res, "No se pudo actualizar el producto"));
                } else {
                    router.refresh();
                }
            } catch {
                set(!checked);
                showToast("No se pudo actualizar el producto");
            }
        },
        [apiBase, router, showToast],
    );

    const handleSave = useCallback(
        async (item: ShoppingItem, patch: ItemPatch): Promise<string | null> => {
            if (!apiBase) return "Lista no disponible";
            try {
                const res = await fetch(`${apiBase}/items/${item.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(patch),
                });
                if (!res.ok) return await errorOf(res, "No se pudo guardar el producto");
                const { item: u } = await res.json();
                setItems((prev) =>
                    prev.map((i) =>
                        i.id === item.id
                            ? { ...i, name: u.name, quantity: u.quantity ?? null, unit: u.unit ?? null, note: u.note ?? null, aisle: u.aisle ?? null }
                            : i,
                    ),
                );
                router.refresh();
                return null;
            } catch {
                return "No se pudo guardar el producto";
            }
        },
        [apiBase, router],
    );

    const handleDeleteItem = useCallback(
        async (item: ShoppingItem): Promise<string | null> => {
            if (!apiBase) return "Lista no disponible";
            try {
                const res = await fetch(`${apiBase}/items/${item.id}`, { method: "DELETE" });
                if (!res.ok) return await errorOf(res, "No se pudo eliminar el producto");
                setItems((prev) => prev.filter((i) => i.id !== item.id));
                router.refresh();
                return null;
            } catch {
                return "No se pudo eliminar el producto";
            }
        },
        [apiBase, router],
    );

    const clearChecked = useCallback(async (): Promise<boolean> => {
        if (!apiBase) return false;
        try {
            const res = await fetch(`${apiBase}/clear-checked`, { method: "POST" });
            if (!res.ok) {
                showToast(await errorOf(res, "No se pudo vaciar el carro"));
                return false;
            }
            setItems((prev) => prev.filter((i) => !i.checked));
            return true;
        } catch {
            showToast("No se pudo vaciar el carro");
            return false;
        }
    }, [apiBase, showToast]);

    // Shortcut WITHOUT link: clear the cart, then open the add-expense form
    // prefilled (concept = list name, groceries category, this list's space).
    const finish = async () => {
        if (!selected || finishing) return;
        if (done.length === 0) {
            showToast("Marca lo que has cogido");
            return;
        }
        setFinishing(true);
        const ok = await clearChecked();
        if (!ok) {
            setFinishing(false);
            return;
        }
        router.push(buildFinishExpenseUrl(selected));
    };

    const chip = (l: HubList, scopeLabel: string) => (
        <EqChip
            key={l.id}
            selected={l.id === selected?.id}
            onClick={() => openList(l.id)}
            aria-label={`${l.name}, ${scopeLabel}, ${chipCount(l)} pendientes`}
        >
            {l.name} · {chipCount(l)}
        </EqChip>
    );

    return (
        <div className="flex flex-col min-h-screen pb-[calc(170px+env(safe-area-inset-bottom))]">
            <div className="pt-[max(12px,env(safe-area-inset-top))] flex flex-col gap-3">
                <EqHeader title="Listas">
                    {selected && (
                        <button
                            type="button"
                            onClick={() => setSheet({ kind: "menu" })}
                            aria-label={`Opciones de ${selected.name}`}
                            className="h-9 w-9 -mr-1.5 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                        >
                            <MoreHorizontal className="h-[22px] w-[22px]" />
                        </button>
                    )}
                </EqHeader>
                <div className="eq-scroll flex items-center gap-1.5 overflow-x-auto px-5">
                    {groupLists.map((l) => chip(l, "común"))}
                    {groupId && personalLists.length > 0 && (
                        <span className="flex-none flex items-center gap-1.5 pl-1 pr-0.5 text-[11.5px] font-semibold text-[color:var(--ink-3)]">
                            <span className="h-5 w-px bg-[var(--line)]" aria-hidden />
                            Personal
                        </span>
                    )}
                    {personalLists.map((l) => chip(l, "personal"))}
                    <EqChip tone="add" onClick={() => setSheet({ kind: "new" })}>
                        + Nueva
                    </EqChip>
                </div>
            </div>

            {selected ? (
                <div className="flex flex-col gap-3 px-5 pt-4">
                    <AddItemInput key={selected.id} onAdd={handleAdd} />

                    {pending.length > 0 && (
                        <section aria-label="Pendientes" className="bg-card rounded-[18px] border border-[color:var(--line-2)] px-4">
                            {groups.map((g, gi) => {
                                const meta = g.key ? getAisle(g.key) : undefined;
                                return (
                                    <Fragment key={g.key ?? "__none__"}>
                                        {showAisleHeaders && (
                                            <p
                                                className={cn(
                                                    "flex items-center gap-1.5 pb-0.5 text-[11.5px] font-semibold text-[color:var(--ink-3)]",
                                                    gi === 0 ? "pt-3" : "pt-3.5 border-t border-[color:var(--line-2)]"
                                                )}
                                            >
                                                <span aria-hidden>{meta?.emoji ?? "🧺"}</span>
                                                {meta?.label ?? "Sin pasillo"}
                                            </p>
                                        )}
                                        {g.items.map((it, i) => (
                                            <ShoppingItemRow
                                                key={it.id}
                                                item={it}
                                                divider={i < g.items.length - 1}
                                                onToggle={() => handleToggle(it)}
                                                onEdit={() => setSheet({ kind: "item", id: it.id })}
                                            />
                                        ))}
                                    </Fragment>
                                );
                            })}
                        </section>
                    )}

                    {items.length === 0 && (
                        <p className="py-6 text-center text-sm text-muted-foreground">Lista vacía. Añade el primer producto.</p>
                    )}

                    {done.length > 0 && (
                        <section aria-label="En el carro" className="flex flex-col">
                            <EqLabel className="pt-1 pb-1">En el carro · {done.length}</EqLabel>
                            <div className="px-4">
                                {done.map((it) => (
                                    <ShoppingItemRow
                                        key={it.id}
                                        item={it}
                                        onToggle={() => handleToggle(it)}
                                        onEdit={() => setSheet({ kind: "item", id: it.id })}
                                    />
                                ))}
                            </div>
                        </section>
                    )}
                </div>
            ) : (
                <div className="px-5 pt-10 flex flex-col items-center gap-3 text-center">
                    <p className="text-4xl" aria-hidden>🧺</p>
                    <p className="text-[15px] font-semibold">Aún no tienes listas</p>
                    <p className="text-sm text-muted-foreground max-w-[260px]">
                        Crea una para apuntar lo que falta y tacharlo juntos en la tienda.
                    </p>
                    <EqCta className="mt-2 w-auto px-6 h-12 rounded-2xl text-[15px]" onClick={() => setSheet({ kind: "new" })}>
                        Crear lista
                    </EqCta>
                </div>
            )}

            {selected && (
                <div className="fixed inset-x-0 z-30 sm:max-w-md sm:mx-auto bottom-[calc(74px+env(safe-area-inset-bottom))] px-5 pt-2.5 pb-3 bg-gradient-to-t from-background via-background to-transparent">
                    <EqCta
                        variant="ink"
                        onClick={finish}
                        // Dimmed but still actionable: with nothing checked it nudges via toast.
                        aria-busy={finishing}
                        className={cn("h-[50px] rounded-2xl text-[15px]", (done.length === 0 || finishing) && "opacity-35")}
                    >
                        <Receipt className="h-[18px] w-[18px]" />
                        Terminar y apuntar gasto
                    </EqCta>
                </div>
            )}

            {toast && (
                <output
                    className="eq-in fixed left-1/2 bottom-[calc(160px+env(safe-area-inset-bottom))] -translate-x-1/2 z-50 whitespace-nowrap rounded-[14px] bg-foreground px-4 py-[11px] text-sm font-medium text-white shadow-[0_10px_24px_-8px_rgba(0,0,0,0.4)]"
                >
                    {toast}
                </output>
            )}

            {sheet?.kind === "new" && (
                <NewListSheet
                    groupId={groupId}
                    onClose={() => setSheet(null)}
                    onCreated={(id) => {
                        setSheet(null);
                        router.push(`/lists/${id}`);
                    }}
                />
            )}

            {selected && apiBase && sheet?.kind === "menu" && (
                <Sheet title={selected.name} onClose={() => setSheet(null)}>
                    <div className="bg-card rounded-2xl border border-[color:var(--line-2)] px-4">
                        <MenuRow icon={Pencil} label="Renombrar lista" onClick={() => setSheet({ kind: "rename" })} />
                        <MenuRow
                            icon={ListX}
                            label={`Vaciar el carro${done.length ? ` (${done.length})` : ""}`}
                            disabled={done.length === 0}
                            onClick={async () => {
                                // Close first so an error toast is not hidden under the modal.
                                setSheet(null);
                                if (await clearChecked()) {
                                    showToast("Carro vaciado");
                                    router.refresh();
                                }
                            }}
                        />
                        <MenuRow icon={Trash2} label="Eliminar lista" danger last onClick={() => setSheet({ kind: "delete" })} />
                    </div>
                    <p className="mt-3 px-1 text-xs text-muted-foreground">
                        {selected.groupId ? "Lista común: la ve todo el espacio." : "Lista personal: solo la ves tú."}
                    </p>
                </Sheet>
            )}

            {selected && apiBase && sheet?.kind === "rename" && (
                <RenameSheet
                    apiBase={apiBase}
                    name={selected.name}
                    onClose={() => setSheet(null)}
                    onDone={() => {
                        setSheet(null);
                        router.refresh();
                    }}
                />
            )}

            {selected && apiBase && sheet?.kind === "delete" && (
                <DeleteListSheet
                    apiBase={apiBase}
                    name={selected.name}
                    onClose={() => setSheet(null)}
                    onDeleted={() => {
                        setSheet(null);
                        router.push("/lists");
                        router.refresh();
                    }}
                />
            )}

            {editingItem && (
                <ItemEditSheet
                    key={editingItem.id}
                    item={editingItem}
                    onClose={() => setSheet(null)}
                    onSave={(patch) => handleSave(editingItem, patch)}
                    onDelete={() => handleDeleteItem(editingItem)}
                />
            )}
        </div>
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
                danger && "text-destructive"
            )}
        >
            <Icon className={cn("h-[19px] w-[19px]", !danger && "text-muted-foreground")} />
            {label}
        </button>
    );
}

function NewListSheet({
    groupId,
    onClose,
    onCreated,
}: {
    groupId: string | null;
    onClose: () => void;
    onCreated: (id: string) => void;
}) {
    const [name, setName] = useState("");
    const [personal, setPersonal] = useState(!groupId);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const create = async () => {
        const trimmed = name.trim();
        if (busy || !trimmed) return;
        setBusy(true);
        setError(null);
        try {
            const res = await fetch(personal || !groupId ? "/api/me/lists" : `/api/spaces/${groupId}/lists`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: trimmed }),
            });
            if (!res.ok) {
                setError(await errorOf(res, "No se pudo crear la lista."));
                setBusy(false);
                return;
            }
            const { list } = await res.json();
            onCreated(list.id);
        } catch {
            setError("No se pudo crear la lista.");
            setBusy(false);
        }
    };

    return (
        <Sheet title="Nueva lista" onClose={onClose}>
            <div className="flex flex-col gap-3">
                <SheetField
                    label="Nombre"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") create();
                    }}
                    placeholder={personal ? "p. ej. Farmacia" : "p. ej. Mercadona"}
                    // oxlint-disable-next-line jsx-a11y/no-autofocus -- the sheet was just opened to type this name
                    autoFocus
                />
                {groupId && (
                    <div className="flex flex-col gap-1.5">
                        <EqLabel className="pl-1">Para</EqLabel>
                        <div className="flex gap-1.5">
                            <EqChip tone="accent" selected={!personal} onClick={() => setPersonal(false)}>
                                Común
                            </EqChip>
                            <EqChip tone="accent" selected={personal} onClick={() => setPersonal(true)}>
                                Personal
                            </EqChip>
                        </div>
                        <p className="pl-1 text-xs text-muted-foreground">
                            {personal ? "Solo tú ves esta lista." : "Compartida con el espacio."}
                        </p>
                    </div>
                )}
                {error && <p className="text-sm text-destructive">{error}</p>}
                <EqCta className="mt-1" onClick={create} disabled={busy || !name.trim()}>
                    Crear lista
                </EqCta>
            </div>
        </Sheet>
    );
}

function RenameSheet({
    apiBase,
    name: initial,
    onClose,
    onDone,
}: {
    apiBase: string;
    name: string;
    onClose: () => void;
    onDone: () => void;
}) {
    const [name, setName] = useState(initial);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const save = async () => {
        const trimmed = name.trim();
        if (busy || !trimmed) return;
        setBusy(true);
        setError(null);
        try {
            const res = await fetch(apiBase, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: trimmed }),
            });
            if (!res.ok) {
                setError(await errorOf(res, "No se pudo renombrar la lista."));
                setBusy(false);
                return;
            }
            onDone();
        } catch {
            setError("No se pudo renombrar la lista.");
            setBusy(false);
        }
    };

    return (
        <Sheet title="Renombrar lista" onClose={onClose}>
            <div className="flex flex-col gap-3">
                <SheetField
                    label="Nombre"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") save();
                    }}
                    // oxlint-disable-next-line jsx-a11y/no-autofocus -- the sheet was just opened to type this name
                    autoFocus
                />
                {error && <p className="text-sm text-destructive">{error}</p>}
                <EqCta onClick={save} disabled={busy || !name.trim()}>
                    Guardar
                </EqCta>
            </div>
        </Sheet>
    );
}

function DeleteListSheet({
    apiBase,
    name,
    onClose,
    onDeleted,
}: {
    apiBase: string;
    name: string;
    onClose: () => void;
    onDeleted: () => void;
}) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const remove = async () => {
        if (busy) return;
        setBusy(true);
        setError(null);
        try {
            const res = await fetch(apiBase, { method: "DELETE" });
            if (!res.ok) {
                setError(await errorOf(res, "No se pudo eliminar la lista."));
                setBusy(false);
                return;
            }
            onDeleted();
        } catch {
            setError("No se pudo eliminar la lista.");
            setBusy(false);
        }
    };

    return (
        <Sheet title={`¿Eliminar «${name}»?`} onClose={onClose}>
            <p className="text-sm text-muted-foreground mb-4">Se borrará la lista con todos sus productos. No afecta a ningún gasto.</p>
            {error && <p className="text-sm text-destructive mb-3">{error}</p>}
            <div className="flex gap-2.5">
                <EqCta variant="outline" className="flex-1 h-12 rounded-2xl text-[15px]" onClick={onClose}>
                    Cancelar
                </EqCta>
                <EqCta className="flex-1 h-12 rounded-2xl text-[15px] bg-destructive" onClick={remove} disabled={busy}>
                    Eliminar
                </EqCta>
            </div>
        </Sheet>
    );
}
