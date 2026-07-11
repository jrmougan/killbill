"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Receipt } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/currency";
import type { CategoryContext } from "@/lib/category-context";
import { AddItemInput } from "@/components/shopping/add-item-input";
import { ShoppingItemRow, type ShoppingItem, type ItemPatch } from "@/components/shopping/shopping-item-row";
import { CheckoutSheet } from "@/components/shopping/checkout-sheet";

export interface DetailMember {
    id: string;
    name: string;
}

interface ListDetailClientProps {
    listId: string;
    name: string;
    description: string | null;
    items: ShoppingItem[];
    isGroup: boolean;
    groupId: string | null;
    members: DetailMember[];
    currentUserId: string;
}

export function ListDetailClient({
    listId,
    name,
    description,
    items: initialItems,
    isGroup,
    groupId,
    members,
    currentUserId,
}: ListDetailClientProps) {
    const router = useRouter();
    const [items, setItems] = useState<ShoppingItem[]>(initialItems);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [checkoutOpen, setCheckoutOpen] = useState(false);

    // Keep local state in sync when the server re-renders (another member's change
    // arrives via router.refresh / focus refresh).
    useEffect(() => {
        setItems(initialItems);
    }, [initialItems]);

    const apiBase = useMemo(
        () => (isGroup ? `/api/spaces/${groupId}/lists/${listId}` : `/api/me/lists/${listId}`),
        [isGroup, groupId, listId],
    );
    const categoryContext: CategoryContext = useMemo(
        () => (isGroup && groupId ? { kind: "shared", groupId } : { kind: "personal" }),
        [isGroup, groupId],
    );

    // Refresh from the server when the tab regains focus (no realtime; §5 accepted).
    useEffect(() => {
        const onFocus = () => router.refresh();
        window.addEventListener("focus", onFocus);
        return () => window.removeEventListener("focus", onFocus);
    }, [router]);

    const eligible = items.filter((i) => i.checked && !i.linked && (i.priceCents ?? 0) > 0);
    const checkoutTotal = eligible.reduce((s, i) => s + (i.priceCents ?? 0), 0);

    const handleAdd = useCallback(
        async (input: { name: string; priceCents: number | null }): Promise<boolean> => {
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
                        priceCents: item.priceCents ?? null,
                        note: item.note ?? null,
                        checked: false,
                        linked: false,
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
            // Optimistic.
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
                                  priceCents: updated.priceCents ?? null,
                                  note: updated.note ?? null,
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
                <section className="space-y-2">
                    {items.map((item) => (
                        <ShoppingItemRow
                            key={item.id}
                            item={item}
                            busy={busyId === item.id}
                            onToggle={(checked) => handleToggle(item, checked)}
                            onSave={(patch) => handleSave(item, patch)}
                            onDelete={() => handleDelete(item)}
                        />
                    ))}
                </section>
            )}

            {eligible.length > 0 && (
                <div className="fixed bottom-0 inset-x-0 p-4 bg-gradient-to-t from-background via-background to-transparent">
                    <div className="max-w-md mx-auto">
                        <Button className="w-full gap-2" onClick={() => setCheckoutOpen(true)}>
                            <Receipt className="h-4 w-4" />
                            Convertir en gasto · {formatCurrency(checkoutTotal)}
                        </Button>
                    </div>
                </div>
            )}

            <CheckoutSheet
                open={checkoutOpen}
                onClose={() => setCheckoutOpen(false)}
                listName={name}
                items={eligible}
                totalCents={checkoutTotal}
                members={isGroup ? members : []}
                currentUserId={currentUserId}
                categoryContext={categoryContext}
                endpoint={`${apiBase}/checkout`}
                onDone={() => {
                    setCheckoutOpen(false);
                    router.refresh();
                }}
            />
        </div>
    );
}
