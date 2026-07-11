"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus, ShoppingCart } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ListSummary } from "@/lib/list-read";
import { ListCard } from "@/components/shopping/list-card";

interface ListsClientProps {
    groupId: string | null;
    initialGroupLists: ListSummary[];
    initialPersonalLists: ListSummary[];
}

type Scope = "comun" | "personal";

export function ListsClient({ groupId, initialGroupLists, initialPersonalLists }: ListsClientProps) {
    const router = useRouter();
    const hasGroup = Boolean(groupId);
    const [scope, setScope] = useState<Scope>(hasGroup ? "comun" : "personal");
    const [groupLists, setGroupLists] = useState<ListSummary[]>(initialGroupLists);
    const [personalLists, setPersonalLists] = useState<ListSummary[]>(initialPersonalLists);
    const [newName, setNewName] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const isPersonal = scope === "personal";
    const lists = isPersonal ? personalLists : groupLists;

    const endpoint = useMemo(
        () => (isPersonal ? "/api/me/lists" : `/api/spaces/${groupId}/lists`),
        [isPersonal, groupId],
    );

    const handleCreate = async () => {
        const trimmed = newName.trim();
        if (saving || !trimmed) return;
        if (!isPersonal && !groupId) return;
        setSaving(true);
        setError(null);
        try {
            const res = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: trimmed }),
            });
            if (res.ok) {
                const { list } = await res.json();
                const summary: ListSummary = {
                    id: list.id,
                    name: list.name,
                    description: list.description ?? null,
                    sortOrder: list.sortOrder,
                    itemCount: 0,
                    checkedCount: 0,
                    totalCents: 0,
                };
                if (isPersonal) setPersonalLists((prev) => [...prev, summary]);
                else setGroupLists((prev) => [...prev, summary]);
                setNewName("");
                router.refresh();
            } else {
                const data = await res.json().catch(() => ({}));
                setError(data.error ?? "No se pudo crear la lista.");
            }
        } catch {
            setError("No se pudo crear la lista.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="flex flex-col min-h-screen p-4 space-y-6 max-w-md mx-auto pb-24">
            <header className="flex items-center gap-4 pt-2">
                <Link href="/settings">
                    <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-secondary">
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                </Link>
                <h1 className="text-xl font-bold text-foreground">Listas de la compra</h1>
            </header>

            {hasGroup && (
                <div className="flex gap-1.5 p-1 rounded-xl bg-secondary border border-[color:var(--line)]">
                    {([["comun", "Común"], ["personal", "Personal"]] as const).map(([key, label]) => (
                        <button
                            key={key}
                            type="button"
                            onClick={() => setScope(key)}
                            aria-pressed={scope === key}
                            className={cn(
                                "flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-all active:scale-[0.98]",
                                scope === key ? "bg-primary text-white shadow" : "text-muted-foreground",
                            )}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            )}

            <GlassCard className="p-4 space-y-3">
                <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Nueva lista</h2>
                <div className="flex gap-2">
                    <Input
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder={isPersonal ? "p. ej. Farmacia" : "p. ej. Mercadona"}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !saving) handleCreate();
                        }}
                    />
                    <Button onClick={handleCreate} disabled={saving || !newName.trim()} isLoading={saving} className="gap-1.5 shrink-0">
                        <Plus className="h-4 w-4" /> Crear
                    </Button>
                </div>
                <p className="text-[11px] text-muted-foreground/70">
                    {isPersonal ? "Solo tú ves esta lista." : "Compartida con el grupo."}
                </p>
                {error && <p className="text-sm text-destructive">{error}</p>}
            </GlassCard>

            {lists.length === 0 ? (
                <GlassCard className="p-8 text-center space-y-3">
                    <ShoppingCart className="h-10 w-10 text-muted-foreground mx-auto" />
                    <h2 className="text-lg font-bold text-foreground">Sin listas aún</h2>
                    <p className="text-sm text-muted-foreground">
                        Crea tu primera lista y empieza a añadir artículos.
                    </p>
                </GlassCard>
            ) : (
                <section className="space-y-3">
                    {lists.map((list) => (
                        <ListCard key={list.id} list={list} />
                    ))}
                </section>
            )}
        </div>
    );
}
