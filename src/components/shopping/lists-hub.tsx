"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, MoreHorizontal, Pencil, Receipt, Trash2, ListX, X } from "lucide-react";
import { EqChip, EqCta, EqHeader, EqLabel, EqToast, useEqToast } from "@/components/ui/eq";
import { CriticalActionSheet } from "@/components/ui/critical-action-sheet";
import { setFlashToast } from "@/lib/flash-toast";
import { cn } from "@/lib/utils";
import { AISLES, getAisle } from "@/lib/aisles";
import type { HubList, HubSelected } from "@/app/lists/load";
import { AddItemInput } from "./add-item-input";
import { ShoppingItemRow, type ItemPatch, type ShoppingItem } from "./shopping-item-row";
import { ItemEditSheet } from "./item-edit-sheet";
import { Sheet, SheetField } from "./sheet";
import { buildFinishExpenseUrl } from "./finish-url";
import { findDuplicate, bumpedQuantity } from "./duplicates";
import { formatQuantity } from "@/lib/list-quantity";
import { ScopeRadio } from "@/components/category/scope-radio";

interface ListsHubProps {
    groupId: string | null;
    /** Lifecycle of `groupId`: ARCHIVED → its Común lists are read-only. */
    groupStatus?: string | null;
    groupLists: HubList[];
    personalLists: HubList[];
    selected: HubSelected | null;
}

/**
 * Near-live poll of the selected list (no realtime infra). Each tick asks the
 * cheap `…/version` endpoint and only re-renders the screen (router.refresh)
 * when the stamp moved. Only while visible.
 */
const POLL_MS = 6000;
/** How long an unconfirmed optimistic toggle survives stale server renders. */
const PENDING_TOGGLE_MS = 10_000;

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

/** "1 producto" / "3 productos". */
function productsLabel(n: number): string {
    return n === 1 ? "1 producto" : `${n} productos`;
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
    | { kind: "clear" }
    | { kind: "item"; id: string }
    | null;

/**
 * Listas: chips for every list (Común, then Personal) and the selected list as
 * the main experience — add, tick off by aisle, "En el carro", and the
 * "Terminar y apuntar gasto" shortcut (clears the checked items and opens the
 * add-expense form prefilled; a list NEVER creates an expense by itself).
 */
export function ListsHub({ groupId, groupStatus = null, groupLists, personalLists, selected }: ListsHubProps) {
    const router = useRouter();
    const [items, setItems] = useState<ShoppingItem[]>(selected?.items ?? []);
    const [sheet, setSheet] = useState<SheetState>(null);
    const [finishing, setFinishing] = useState(false);
    const [dup, setDup] = useState<{ name: string; item: ShoppingItem } | null>(null);
    const [toast, showToast, toastAction] = useEqToast(3200);
    // Lists are planning, not spending: they stay editable while the space is
    // SETTLING. Only an ARCHIVED space makes its Común lists read-only.
    const archived = !!selected?.groupId && groupStatus === "ARCHIVED";
    const settling = !!selected?.groupId && groupStatus === "SETTLING";

    // Optimistic toggles not yet reflected by a server render. A refresh started
    // BEFORE the PATCH (mount / focus / poll) can land after the tap with the old
    // `checked`; without this it would silently undo the tick on screen.
    const pendingToggles = useRef(new Map<string, { checked: boolean; at: number }>());

    // Server re-renders (poll / focus / navigation to another list) are the
    // source of truth: resync the local optimistic copy, keeping in-flight
    // toggles until a render confirms them (or they go stale).
    useEffect(() => {
        const pending = pendingToggles.current;
        const now = Date.now();
        setItems((selected?.items ?? []).map((i) => {
            const p = pending.get(i.id);
            if (!p) return i;
            if (p.checked === i.checked || now - p.at > PENDING_TOGGLE_MS) {
                pending.delete(i.id);
                return i;
            }
            return { ...i, checked: p.checked };
        }));
    }, [selected]);

    const apiBase = selected
        ? selected.groupId
            ? `/api/spaces/${selected.groupId}/lists/${selected.id}`
            : `/api/me/lists/${selected.id}`
        : null;

    // The list on screen and its stamp (from the last server render), read by
    // the poll without re-subscribing the listeners on every render.
    const shown = useRef({ apiBase, version: selected?.version ?? null });
    useEffect(() => {
        shown.current = { apiBase, version: selected?.version ?? null };
    }, [apiBase, selected]);

    useEffect(() => {
        const visible = () => document.visibilityState === "visible";
        const refresh = () => {
            if (visible()) router.refresh();
        };
        const poll = async () => {
            if (!visible()) return;
            // No list on screen: nothing cheap to compare, re-read the hub.
            const { apiBase: base, version: current } = shown.current;
            if (!base) return router.refresh();
            try {
                const res = await fetch(`${base}/version`, { cache: "no-store" });
                // Gone / no longer accessible / server error: let the page decide (redirects).
                if (!res.ok) return router.refresh();
                const { version } = await res.json();
                if (version !== current) router.refresh();
            } catch {
                /* offline: retry on the next tick */
            }
        };
        // Browser back restores the list from the router cache / bfcache: re-read
        // it right away instead of showing already-cleared items until the poll.
        refresh();
        window.addEventListener("focus", refresh);
        window.addEventListener("pageshow", refresh);
        document.addEventListener("visibilitychange", refresh);
        const timer = setInterval(() => void poll(), POLL_MS);
        return () => {
            window.removeEventListener("focus", refresh);
            window.removeEventListener("pageshow", refresh);
            document.removeEventListener("visibilitychange", refresh);
            clearInterval(timer);
        };
    }, [router]);

    const pending = useMemo(() => items.filter((i) => !i.checked), [items]);
    const done = useMemo(() => items.filter((i) => i.checked), [items]);
    const groups = useMemo(() => groupByAisle(pending), [pending]);
    const showAisleHeaders = groups.length > 1 || groups[0]?.key != null;
    const editingItem = sheet?.kind === "item" ? items.find((i) => i.id === sheet.id) : undefined;

    const chipCount = (l: HubList) => (l.id === selected?.id ? pending.length : l.pendingCount);
    const openList = (id: string) => {
        if (id !== selected?.id) router.push(`/lists/${id}`);
    };

    const addItem = useCallback(
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

    // Soft duplicate guard: a pending item with the same name asks first
    // ("Ya está en la lista") — add anyway or bump its quantity.
    const handleAdd = useCallback(
        async (input: { name: string }): Promise<boolean> => {
            const existing = findDuplicate(items, input.name);
            if (existing) {
                setDup({ name: input.name, item: existing });
                return true;
            }
            setDup(null);
            return addItem(input);
        },
        [items, addItem],
    );

    // Optimistic toggle; the API is idempotent (condition-by-id updateMany), so a
    // retried or duplicated tap from another member never flips the state twice.
    const handleToggle = useCallback(
        async (item: ShoppingItem) => {
            if (!apiBase) return;
            const checked = !item.checked;
            const set = (value: boolean) =>
                setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, checked: value } : i)));
            const revert = () => {
                pendingToggles.current.delete(item.id);
                set(!checked);
            };
            pendingToggles.current.set(item.id, { checked, at: Date.now() });
            set(checked);
            try {
                const res = await fetch(`${apiBase}/items/${item.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ checked }),
                });
                if (!res.ok) {
                    revert();
                    showToast(await errorOf(res, "No se pudo actualizar el producto"));
                } else {
                    router.refresh();
                }
            } catch {
                revert();
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

    // "Deshacer" after deleting a product: the result is identical, so it is
    // re-created with the same name, quantity, unit, note and aisle (and
    // ticked again if it was in the cart).
    const restoreItem = useCallback(
        async (item: ShoppingItem) => {
            if (!apiBase) return;
            try {
                const res = await fetch(`${apiBase}/items`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name: item.name, quantity: item.quantity, unit: item.unit, note: item.note, aisle: item.aisle }),
                });
                if (!res.ok) {
                    showToast(await errorOf(res, "No se pudo recuperar el producto"));
                    return;
                }
                const { item: created } = await res.json();
                if (item.checked) {
                    await fetch(`${apiBase}/items/${created.id}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ checked: true }),
                    }).catch(() => undefined);
                }
                setItems((prev) => [...prev, { ...item, id: created.id }]);
                router.refresh();
            } catch {
                showToast("No se pudo recuperar el producto");
            }
        },
        [apiBase, router, showToast],
    );

    const handleDeleteItem = useCallback(
        async (item: ShoppingItem): Promise<string | null> => {
            if (!apiBase) return "Lista no disponible";
            try {
                const res = await fetch(`${apiBase}/items/${item.id}`, { method: "DELETE" });
                if (!res.ok) return await errorOf(res, "No se pudo eliminar el producto");
                setItems((prev) => prev.filter((i) => i.id !== item.id));
                router.refresh();
                showToast(`«${item.name}» eliminado`, { label: "Deshacer", onAction: () => void restoreItem(item) });
                return null;
            } catch {
                return "No se pudo eliminar el producto";
            }
        },
        [apiBase, router, showToast, restoreItem],
    );

    /**
     * Deletes the checked items on screen (`ids`): one another member ticked after
     * the last poll is not in them and survives. Resolves to an error message, or
     * the number actually deleted (an item unticked meanwhile is kept).
     */
    const clearChecked = useCallback(async (ids: string[]): Promise<{ error: string } | { cleared: number }> => {
        if (!apiBase) return { error: "Lista no disponible" };
        try {
            const res = await fetch(`${apiBase}/clear-checked`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids }),
            });
            if (!res.ok) return { error: await errorOf(res, "No se pudieron borrar los tachados") };
            const data = (await res.json().catch(() => null)) as { cleared?: unknown } | null;
            const sent = new Set(ids);
            setItems((prev) => prev.filter((i) => !(i.checked && sent.has(i.id))));
            return { cleared: typeof data?.cleared === "number" ? data.cleared : ids.length };
        } catch {
            return { error: "No se pudieron borrar los tachados" };
        }
    }, [apiBase]);

    // Shortcut WITHOUT link: clear the cart, then open the add-expense form
    // prefilled (concept = list name, groceries category, this list's space).
    const finish = async () => {
        if (!selected || finishing) return;
        if (done.length === 0) {
            showToast("Marca lo que has cogido");
            return;
        }
        setFinishing(true);
        const res = await clearChecked(done.map((i) => i.id));
        if ("error" in res) {
            setFinishing(false);
            showToast(res.error);
            return;
        }
        if (settling) {
            // No new expenses while settling: just close the shop run.
            setFinishing(false);
            const n = res.cleared;
            const what = n === 0 ? "Ya no quedaban tachados" : n === 1 ? "1 producto quitado de la lista" : `${n} productos quitados de la lista`;
            showToast(`${what}. Estáis cerrando cuentas: apunta el gasto cuando se reabra el espacio.`);
            router.refresh();
            return;
        }
        router.push(buildFinishExpenseUrl(selected));
    };

    // Deep links (/lists/<id>) may select a chip that starts off-screen in the scroller.
    const chipsRef = useRef<HTMLDivElement>(null);
    const selectedId = selected?.id;
    useEffect(() => {
        const el = chipsRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
        el?.scrollIntoView?.({ inline: "nearest", block: "nearest" });
    }, [selectedId]);

    const chip = (l: HubList, scopeLabel: string) => (
        <EqChip
            key={l.id}
            selected={l.id === selected?.id}
            touch
            onClick={() => openList(l.id)}
            aria-label={`${l.name}, ${scopeLabel}, ${chipCount(l)} pendientes`}
            // Capped width: a long name truncates but the pending count stays visible.
            className="flex items-center max-w-[min(75vw,280px)]"
        >
            <span className="truncate min-w-0">{l.name}</span>
            <span className="flex-none whitespace-pre"> · {chipCount(l)}</span>
        </EqChip>
    );

    return (
        <div className="flex flex-col min-h-screen pb-[calc(190px+env(safe-area-inset-bottom))]">
            <div className="pt-[max(12px,env(safe-area-inset-top))] flex flex-col gap-3">
                <EqHeader title="Listas">
                    {selected && !archived && (
                        <button
                            type="button"
                            onClick={() => setSheet({ kind: "menu" })}
                            aria-label={`Opciones de ${selected.name}`}
                            className="h-11 w-11 -my-1 -mr-2.5 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                        >
                            <MoreHorizontal className="h-[22px] w-[22px]" />
                        </button>
                    )}
                </EqHeader>
                <div ref={chipsRef} className="eq-scroll -my-1 flex items-center gap-1.5 overflow-x-auto px-5">
                    {groupLists.map((l) => chip(l, "común"))}
                    {groupId && personalLists.length > 0 && (
                        <span className="flex-none flex items-center gap-1.5 pl-1 pr-0.5 text-[11.5px] font-semibold text-[color:var(--ink-3)]">
                            <span className="h-5 w-px bg-[var(--line)]" aria-hidden />
                            Personal
                        </span>
                    )}
                    {personalLists.map((l) => chip(l, "personal"))}
                    <EqChip tone="add" touch onClick={() => setSheet({ kind: "new" })}>
                        + Nueva
                    </EqChip>
                </div>
            </div>

            {selected ? (
                <div className="flex flex-col gap-3 px-5 pt-4">
                    {archived && (
                        <output
                            data-testid="list-readonly-banner"
                            className="flex items-start gap-2.5 rounded-[14px] border border-[color:var(--line-2)] bg-card px-3.5 py-3 text-[13px]"
                        >
                            <Lock className="h-4 w-4 flex-none mt-px text-muted-foreground" aria-hidden />
                            <span className="min-w-0">
                                <span className="block font-semibold">Espacio archivado</span>
                                <span className="block text-muted-foreground">Esta lista es de solo lectura.</span>
                            </span>
                        </output>
                    )}
                    {!archived && <AddItemInput key={selected.id} onAdd={handleAdd} />}
                    {dup && !archived && (
                        <div
                            role="alert"
                            data-testid="duplicate-warning"
                            className="flex flex-col gap-2.5 rounded-[14px] border border-[color:var(--line)] bg-card px-3.5 py-3"
                        >
                            <div className="flex items-start gap-2">
                                <p className="flex-1 min-w-0 text-sm [overflow-wrap:anywhere]">
                                    <span className="font-semibold">«{dup.item.name}»</span> ya está en la lista
                                    {itemQuantityLabel(dup.item)}.
                                </p>
                                <button
                                    type="button"
                                    aria-label="Descartar"
                                    onClick={() => setDup(null)}
                                    className="-mr-3 -mt-2.5 -mb-1.5 h-11 w-11 flex-none flex items-center justify-center text-muted-foreground"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                            <div className="-my-1 flex gap-2">
                                <EqChip
                                    tone="accent"
                                    selected
                                    touch
                                    onClick={async () => {
                                        const d = dup;
                                        setDup(null);
                                        const q = bumpedQuantity(d.item.quantity);
                                        if (q === null) {
                                            showToast("La cantidad máxima es 100.000");
                                            return;
                                        }
                                        const err = await handleSave(d.item, { quantity: q });
                                        if (err) showToast(err);
                                    }}
                                >
                                    Sumar 1
                                </EqChip>
                                <EqChip
                                    touch
                                    onClick={async () => {
                                        const d = dup;
                                        setDup(null);
                                        await addItem({ name: d.name });
                                    }}
                                >
                                    Añadir igualmente
                                </EqChip>
                            </div>
                        </div>
                    )}

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
                                                readOnly={archived}
                                            />
                                        ))}
                                    </Fragment>
                                );
                            })}
                        </section>
                    )}

                    {items.length === 0 && (
                        <p className="py-6 text-center text-sm text-muted-foreground">
                            {archived ? "Lista vacía." : "Lista vacía. Añade el primer producto."}
                        </p>
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
                                        readOnly={archived}
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

            {selected && !archived && (
                <div className="fixed inset-x-0 z-30 sm:max-w-md sm:mx-auto bottom-[calc(74px+env(safe-area-inset-bottom))] px-5 pt-3 pb-3 bg-gradient-to-t from-background via-background to-transparent">
                    {/* The effect of the shortcut, said before tapping it (it deletes the checked items). */}
                    <p id="finish-effect" data-testid="finish-effect" className="pb-1.5 text-center text-[12.5px] text-muted-foreground">
                        {done.length === 0
                            ? "Tacha lo que cojas para terminar"
                            : done.length === 1
                                ? "Quita de la lista el producto tachado"
                                : `Quita de la lista los ${done.length} productos tachados`}
                    </p>
                    <EqCta
                        variant="ink"
                        onClick={finish}
                        // Dimmed but still actionable: with nothing checked it nudges via toast.
                        aria-busy={finishing}
                        aria-describedby="finish-effect"
                        className={cn("h-[50px] rounded-2xl text-[15px]", (done.length === 0 || finishing) && "opacity-35")}
                    >
                        <Receipt className="h-[18px] w-[18px]" />
                        {settling ? "Terminar compra" : "Terminar y apuntar gasto"}
                    </EqCta>
                </div>
            )}

            {toast && (
                <EqToast action={toastAction} className="bottom-[calc(180px+env(safe-area-inset-bottom))] sm:max-w-sm text-center text-balance">
                    {toast}
                </EqToast>
            )}

            {sheet?.kind === "new" && (
                <NewListSheet
                    groupId={groupId}
                    groupArchived={groupStatus === "ARCHIVED"}
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
                            label={`Borrar los tachados${done.length ? ` (${done.length})` : ""}`}
                            disabled={done.length === 0}
                            onClick={() => setSheet({ kind: "clear" })}
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

            {selected && apiBase && sheet?.kind === "clear" && (
                <ClearCheckedSheet
                    ids={done.map((i) => i.id)}
                    shared={!!selected.groupId}
                    onClear={clearChecked}
                    onClose={() => setSheet(null)}
                    onCleared={(n) => {
                        setSheet(null);
                        // No "Deshacer": re-creating them would not be the same rows.
                        showToast(n === 0 ? "Ya no quedaban tachados" : n === 1 ? "1 producto borrado" : `${n} productos borrados`);
                        router.refresh();
                    }}
                />
            )}

            {selected && apiBase && sheet?.kind === "delete" && (
                <DeleteListSheet
                    apiBase={apiBase}
                    name={selected.name}
                    itemCount={items.length}
                    shared={!!selected.groupId}
                    onClose={() => setSheet(null)}
                    onDeleted={() => {
                        setSheet(null);
                        setFlashToast(`Lista «${selected.name}» eliminada`);
                        router.push("/lists");
                        router.refresh();
                    }}
                />
            )}

            {editingItem && !archived && (
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
    groupArchived = false,
    onClose,
    onCreated,
}: {
    groupId: string | null;
    groupArchived?: boolean;
    onClose: () => void;
    onCreated: (id: string) => void;
}) {
    const [name, setName] = useState("");
    // An archived space takes no new Común lists: default (and lock) to Personal.
    const [personal, setPersonal] = useState(!groupId || groupArchived);
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
                    maxLength={60}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") create();
                    }}
                    placeholder={personal ? "p. ej. Farmacia" : "p. ej. Mercadona"}
                    // oxlint-disable-next-line jsx-a11y/no-autofocus -- the sheet was just opened to type this name
                    autoFocus
                />
                {groupId && (
                    <div className="flex flex-col gap-1.5">
                        <EqLabel className="pl-1" aria-hidden>Para</EqLabel>
                        <ScopeRadio
                            label="Para"
                            personal={personal}
                            onChange={setPersonal}
                            sharedDisabled={groupArchived}
                        />
                        <p className="pl-1 text-xs text-muted-foreground">
                            {groupArchived
                                ? "El espacio está archivado: solo puedes crear listas personales."
                                : personal
                                    ? "Solo tú ves esta lista."
                                    : "Compartida con el espacio."}
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
                    maxLength={60}
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

function ClearCheckedSheet({
    ids,
    shared,
    onClear,
    onClose,
    onCleared,
}: {
    /** The checked items on screen: exactly these are deleted, never more. */
    ids: string[];
    shared: boolean;
    onClear: (ids: string[]) => Promise<{ error: string } | { cleared: number }>;
    onClose: () => void;
    /** The count the server actually deleted (≤ ids.length). */
    onCleared: (n: number) => void;
}) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Freeze what the sheet announces: a poll can change `ids` while it is open.
    const [shown] = useState(ids);
    const count = shown.length;

    const clear = async () => {
        if (busy) return;
        setBusy(true);
        setError(null);
        const res = await onClear(shown);
        if ("error" in res) {
            setError(res.error);
            setBusy(false);
            return;
        }
        onCleared(res.cleared);
    };

    return (
        <CriticalActionSheet
            testId="clear-checked-sheet"
            tone="danger"
            title={count === 1 ? "¿Borrar 1 producto tachado?" : `¿Borrar ${count} productos tachados?`}
            consequences={[`${count === 1 ? "Se quitará" : "Se quitarán"} de la lista${shared ? " para todo el espacio" : ""}. Los pendientes no cambian.`]}
            reversible={false}
            confirmLabel={`Borrar ${productsLabel(count)}`}
            busy={busy}
            error={error}
            onConfirm={clear}
            onClose={onClose}
        />
    );
}

function DeleteListSheet({
    apiBase,
    name,
    itemCount,
    shared,
    onClose,
    onDeleted,
}: {
    apiBase: string;
    name: string;
    itemCount: number;
    shared: boolean;
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

    const forWhom = shared ? " para todos los miembros del espacio" : "";
    const what =
        itemCount === 0
            ? `Se eliminará la lista${forWhom}.`
            : itemCount === 1
                ? `Se eliminará su producto${forWhom}.`
                : `Se eliminarán sus ${itemCount} productos${forWhom}.`;

    return (
        <CriticalActionSheet
            testId="delete-list-sheet"
            tone="danger"
            title={`¿Eliminar «${name}»?`}
            consequences={[`${what} No afecta a ningún gasto.`]}
            reversible={false}
            confirmLabel="Eliminar lista"
            busy={busy}
            error={error}
            onConfirm={remove}
            onClose={onClose}
        />
    );
}

/** " (2 kg)" for the duplicate prompt, or "" without a quantity/unit. */
function itemQuantityLabel(item: ShoppingItem): string {
    const meta = [item.quantity != null ? formatQuantity(item.quantity) : null, item.unit].filter(Boolean).join(" ");
    return meta ? ` (${meta})` : "";
}
