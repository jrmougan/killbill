"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, X, Plus, Check } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Tag {
    id: string;
    name: string;
    color: string;
    coupleId: string;
}

interface TagsClientProps {
    initialTags: Tag[];
}

const PRESET_COLORS = [
    "#8b5cf6",
    "#06b6d4",
    "#10b981",
    "#f59e0b",
    "#ef4444",
    "#ec4899",
    "#3b82f6",
    "#84cc16",
];

const COLOR_NAMES: Record<string, string> = {
    "#8b5cf6": "Violeta",
    "#06b6d4": "Cian",
    "#10b981": "Verde",
    "#f59e0b": "Ámbar",
    "#ef4444": "Rojo",
    "#ec4899": "Rosa",
    "#3b82f6": "Azul",
    "#84cc16": "Lima",
};

export function TagsClient({ initialTags }: TagsClientProps) {
    const router = useRouter();
    const [tags, setTags] = useState<Tag[]>(initialTags);
    const [newName, setNewName] = useState("");
    const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const handleCreate = async () => {
        if (saving || !newName.trim()) return;
        const trimmed = newName.trim();
        setSaving(true);
        setError(null);
        try {
            const res = await fetch("/api/tags", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: trimmed, color: newColor }),
            });
            if (res.ok) {
                const data = await res.json();
                setTags((prev) => [...prev, data.tag].sort((a, b) => a.name.localeCompare(b.name)));
                setNewName("");
                setNewColor(PRESET_COLORS[0]);
                router.refresh();
            } else {
                setError("No se pudo crear la etiqueta. Inténtalo de nuevo.");
            }
        } catch {
            setError("No se pudo crear la etiqueta. Inténtalo de nuevo.");
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (tag: Tag) => {
        if (!confirm(`¿Eliminar etiqueta '${tag.name}'? Se eliminará de todos los gastos.`)) return;
        setDeleting(tag.id);
        setError(null);
        try {
            const res = await fetch(`/api/tags/${tag.id}`, { method: "DELETE" });
            if (res.ok) {
                setTags((prev) => prev.filter((t) => t.id !== tag.id));
                router.refresh();
            } else {
                setError("No se pudo eliminar la etiqueta. Inténtalo de nuevo.");
            }
        } catch {
            setError("No se pudo eliminar la etiqueta. Inténtalo de nuevo.");
        } finally {
            setDeleting(null);
        }
    };

    return (
        <div className="flex flex-col min-h-screen p-4 space-y-6 max-w-md mx-auto pb-10">
            <header className="flex items-center gap-4 pt-2">
                <Link href="/settings">
                    <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-white/10">
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                </Link>
                <h1 className="text-xl font-bold">Etiquetas</h1>
            </header>

            <GlassCard className="p-4 space-y-4">
                <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Nueva etiqueta</h2>

                <Input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Nombre de la etiqueta"
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && !saving) handleCreate();
                    }}
                />

                <div className="space-y-2">
                    <p className="text-xs text-muted-foreground font-medium">Color</p>
                    <div className="flex gap-2 flex-wrap">
                        {PRESET_COLORS.map((color) => (
                            <button
                                key={color}
                                type="button"
                                onClick={() => setNewColor(color)}
                                className="h-8 w-8 rounded-full border-2 transition-all flex items-center justify-center"
                                style={{
                                    backgroundColor: color,
                                    borderColor: newColor === color ? "white" : "transparent",
                                }}
                                aria-label={COLOR_NAMES[color] ?? color}
                            >
                                {newColor === color && <Check className="h-4 w-4 text-white drop-shadow" />}
                            </button>
                        ))}
                    </div>
                </div>

                <Button
                    className="w-full gap-2"
                    onClick={handleCreate}
                    disabled={saving || !newName.trim()}
                    isLoading={saving}
                >
                    <Plus className="h-4 w-4" /> Crear etiqueta
                </Button>

                {error && <p className="text-sm text-red-400">{error}</p>}
            </GlassCard>

            {tags.length === 0 ? (
                <GlassCard className="p-8 text-center space-y-3">
                    <div className="text-5xl">🏷️</div>
                    <h2 className="text-lg font-bold">Sin etiquetas aún</h2>
                    <p className="text-sm text-muted-foreground">
                        Crea tags para organizar vuestros gastos
                    </p>
                </GlassCard>
            ) : (
                <section className="space-y-3">
                    <div className="flex items-center gap-2 px-1">
                        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                            Tus etiquetas ({tags.length})
                        </h2>
                    </div>

                    <div className="flex flex-wrap gap-3">
                        {tags.map((tag) => (
                            <div
                                key={tag.id}
                                className="flex items-center gap-2 px-3 py-2 rounded-xl border border-white/10 bg-white/5"
                            >
                                <div
                                    className="h-3 w-3 rounded-full flex-shrink-0"
                                    style={{ backgroundColor: tag.color }}
                                />
                                <span className="text-sm font-semibold">{tag.name}</span>
                                <button
                                    type="button"
                                    onClick={() => handleDelete(tag)}
                                    disabled={deleting === tag.id}
                                    className="ml-1 text-muted-foreground hover:text-red-400 transition-colors disabled:opacity-50"
                                    aria-label={`Eliminar tag ${tag.name}`}
                                >
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            </div>
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}
