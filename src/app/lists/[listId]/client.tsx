"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Trash2, ScanLine } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { AddItemInput } from "@/components/shopping/add-item-input";
import { ShoppingItemRow, type ShoppingItem, type ItemPatch } from "@/components/shopping/shopping-item-row";
import { ReconcileSheet, type ReconcileMatch } from "@/components/shopping/reconcile-sheet";
import { AISLES, getAisle } from "@/lib/aisles";

interface ListDetailClientProps {
    listId: string;
    name: string;
    description: string | null;
    items: ShoppingItem[];
    isGroup: boolean;
    groupId: string | null;
}

/** Near-live poll of the detail (§5: no realtime). Refreshes only when visible. */
const POLL_MS = 6000;

const AISLE_ORDER = new Map(AISLES.map((a) => [a.key, a.sortOrder]));

/** Group items by aisle, ordered by the aisle layout; null-aisle group last. */
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

export function ListDetailClient({ listId, name, description, items: initialItems, isGroup, groupId }: ListDetailClientProps) {
    const router = useRouter();
    const [items, setItems] = useState<ShoppingItem[]>(initialItems);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [reconciling, setReconciling] = useState(false);
    const [matches, setMatches] = useState<ReconcileMatch[] | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Keep local state in sync when the server re-renders (another member's change
    // arrives via router.refresh / focus / poll).
    useEffect(() => {
        setItems(initialItems);
    }, [initialItems]);

    const apiBase = useMemo(
        () => (isGroup ? `/api/spaces/${groupId}/lists/${listId}` : `/api/me/lists/${listId}`),
        [isGroup, groupId, listId],
    );

    // Refresh on focus + a light poll while the tab is visible (near-live collab).
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

    const checkedCount = items.filter((i) => i.checked).length;
    const grouped = useMemo(() => groupByAisle(items), [items]);
    const showAisleHeaders = grouped.length > 1 || (grouped[0]?.key != null);

    const handleAdd = useCallback(
        async (input: { name: string }): Promise<boolean> => {
            setError(null);
            try {
                const res = await fetch(`${apiBase}/items`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(input),
                });
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    setError(data.error ?? "No se pudo añadir el artículo.");
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
                setError("No se pudo añadir el artículo.");
                return false;
            }
        },
        [apiBase, router],
    );

    const handleToggle = useCallback(
        async (item: ShoppingItem, checked: boolean) => {
            setBusyId(item.id);
            setError(null);
            setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, checked } : i)));
            try {
                const res = await fetch(`${apiBase}/items/${item.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ checked }),
                });
                if (!res.ok) {
                    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, checked: !checked } : i)));
                    setError("No se pudo actualizar el artículo.");
                } else {
                    router.refresh();
                }
            } catch {
                setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, checked: !checked } : i)));
                setError("No se pudo actualizar el artículo.");
            } finally {
                setBusyId(null);
            }
        },
        [apiBase, router],
    );

    const handleSave = useCallback(
        async (item: ShoppingItem, patch: ItemPatch): Promise<boolean> => {
            setError(null);
            try {
                const res = await fetch(`${apiBase}/items/${item.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(patch),
                });
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    setError(data.error ?? "No se pudo guardar el artículo.");
                    return false;
                }
                const { item: updated } = await res.json();
                setItems((prev) =>
                    prev.map((i) =>
                        i.id === item.id
                            ? {
                                  ...i,
                                  name: updated.name,
                                  quantity: updated.quantity ?? null,
                                  unit: updated.unit ?? null,
                                  note: updated.note ?? null,
                                  aisle: updated.aisle ?? null,
                              }
                            : i,
                    ),
                );
                router.refresh();
                return true;
            } catch {
                setError("No se pudo guardar el artículo.");
                return false;
            }
        },
        [apiBase, router],
    );

    const handleDelete = useCallback(
        async (item: ShoppingItem) => {
            setBusyId(item.id);
            setError(null);
            try {
                const res = await fetch(`${apiBase}/items/${item.id}`, { method: "DELETE" });
                if (res.ok) {
                    setItems((prev) => prev.filter((i) => i.id !== item.id));
                    router.refresh();
                } else {
                    setError("No se pudo eliminar el artículo.");
                }
            } catch {
                setError("No se pudo eliminar el artículo.");
            } finally {
                setBusyId(null);
            }
        },
        [apiBase, router],
    );

    const handleClearChecked = useCallback(async () => {
        if (!window.confirm("¿Vaciar los comprados? Se borrarán los artículos marcados (la lista se conserva).")) return;
        setError(null);
        try {
            const res = await fetch(`${apiBase}/clear-checked`, { method: "POST" });
            if (res.ok) {
                setItems((prev) => prev.filter((i) => !i.checked));
                router.refresh();
            } else {
                setError("No se pudieron vaciar los comprados.");
            }
        } catch {
            setError("No se pudieron vaciar los comprados.");
        }
    }, [apiBase, router]);

    const handleReceiptPicked = useCallback(
        async (file: File) => {
            setReconciling(true);
            setError(null);
            try {
                const form = new FormData();
                form.append("image", file);
                const res = await fetch(`${apiBase}/reconcile`, { method: "POST", body: form });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    setError(data.error ?? "No se pudo analizar el ticket.");
                    return;
                }
                setMatches(data.matches ?? []);
            } catch {
                setError("No se pudo analizar el ticket.");
            } finally {
                setReconciling(false);
            }
        },
        [apiBase],
    );

    const confirmMatches = useCallback(
        async (ids: string[]) => {
            setMatches(null);
            for (const id of ids) {
                const item = items.find((i) => i.id === id);
                if (item && !item.checked) await handleToggle(item, true);
            }
        },
        [items, handleToggle],
    );

    return (
        <div className="flex flex-col min-h-screen p-4 space-y-5 max-w-md mx-auto pb-28">
            <header className="flex items-center gap-4 pt-2">
                <Link href="/lists">
                    <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-secondary">
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                </Link>
                <div className="min-w-0">
                    <h1 className="text-xl font-bold text-foreground truncate">{name}</h1>
                    {description && <p className="text-sm text-muted-foreground truncate">{description}</p>}
                </div>
            </header>

            <GlassCard className="p-3">
                <AddItemInput busy={busyId !== null} onAdd={handleAdd} />
            </GlassCard>

            {error && <p className="text-sm text-destructive px-1">{error}</p>}

            {items.length === 0 ? (
                <GlassCard className="p-8 text-center space-y-2">
                    <p className="text-4xl">🛒</p>
                    <p className="text-sm text-muted-foreground">Añade artículos escribiendo arriba.</p>
                </GlassCard>
            ) : (
                <section className="space-y-4">
                    {grouped.map((group) => {
                        const meta = group.key ? getAisle(group.key) : undefined;
                        return (
                            <div key={group.key ?? "__none__"} className="space-y-2">
                                {showAisleHeaders && (
                                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">
                                        {meta ? `${meta.emoji} ${meta.label}` : "Sin pasillo"}
                                    </p>
                                )}
                                {group.items.map((item) => (
                                    <ShoppingItemRow
                                        key={item.id}
                                        item={item}
                                        busy={busyId === item.id}
                                        onToggle={(checked) => handleToggle(item, checked)}
                                        onSave={(patch) => handleSave(item, patch)}
                                        onDelete={() => handleDelete(item)}
                                    />
                                ))}
                            </div>
                        );
                    })}
                </section>
            )}

            {/* Hidden receipt picker for OCR reconciliation. */}
            <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleReceiptPicked(file);
                    e.target.value = "";
                }}
            />

            {(items.some((i) => !i.checked) || checkedCount > 0) && (
                <div className="fixed bottom-0 inset-x-0 p-4 bg-gradient-to-t from-background via-background to-transparent">
                    <div className="max-w-md mx-auto flex gap-2">
                        {items.some((i) => !i.checked) && (
                            <Button
                                variant="secondary"
                                className="flex-1 gap-2"
                                onClick={() => fileInputRef.current?.click()}
                                isLoading={reconciling}
                            >
                                <ScanLine className="h-4 w-4" />
                                Reconciliar con ticket
                            </Button>
                        )}
                        {checkedCount > 0 && (
                            <Button variant="ghost" className="gap-2 text-muted-foreground" onClick={handleClearChecked}>
                                <Trash2 className="h-4 w-4" />
                                Vaciar comprados ({checkedCount})
                            </Button>
                        )}
                    </div>
                </div>
            )}

            {matches !== null && (
                <ReconcileSheet
                    matches={matches}
                    onCancel={() => setMatches(null)}
                    onConfirm={confirmMatches}
                />
            )}
        </div>
    );
}
