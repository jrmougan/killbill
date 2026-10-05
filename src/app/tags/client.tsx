"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X, Plus, Check } from "lucide-react";
import { EqCard, EqCta, EqHeader, EqLabel } from "@/components/ui/eq";
import { cn } from "@/lib/utils";

interface Tag {
    id: string;
    name: string;
    color: string;
    /** Personal tag (ownerId, no group) vs common (group) tag. */
    personal: boolean;
}

interface TagsClientProps {
    initialTags: Tag[];
    /** Whether the user belongs to a group — gates the "Común" scope. */
    hasGroup: boolean;
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

export function TagsClient({ initialTags, hasGroup }: TagsClientProps) {
    const router = useRouter();
    const [tags, setTags] = useState<Tag[]>(initialTags);
    const [newName, setNewName] = useState("");
    const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
    // Scope of the tag being created: common (group) or personal. Defaults to
    // common when the user has a group, else personal.
    const [newPersonal, setNewPersonal] = useState(!hasGroup);
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
                body: JSON.stringify({ name: trimmed, color: newColor, personal: newPersonal }),
            });
            if (res.ok) {
                const data = await res.json();
                const created: Tag = { id: data.tag.id, name: data.tag.name, color: data.tag.color, personal: newPersonal };
                setTags((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
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
        <div className="flex flex-col min-h-screen pt-[max(12px,env(safe-area-inset-top))] pb-10">
            <EqHeader title="Etiquetas" back="/settings" />
            <div className="flex flex-col gap-5 px-5 pt-5">
                <EqCard className="p-4 space-y-4">
                    <h2 className="text-[15px] font-semibold">Nueva etiqueta</h2>

                    <input
                        aria-label="Nombre de la etiqueta"
                        className="w-full h-12 rounded-[14px] border border-[color:var(--line)] bg-card px-3.5 text-[15px] outline-none focus:border-[color:var(--accent-border)]"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="Nombre de la etiqueta"
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !saving) handleCreate();
                        }}
                    />

                    {hasGroup && (
                        <div className="space-y-2">
                            <EqLabel>Ámbito</EqLabel>
                            <div className="flex rounded-xl bg-[var(--track)] p-[3px]">
                                {([["comun", "Común", false], ["personal", "Personal", true]] as const).map(([key, label, personal]) => (
                                    <button
                                        key={key}
                                        type="button"
                                        onClick={() => setNewPersonal(personal)}
                                        aria-pressed={newPersonal === personal}
                                        className={cn(
                                            "flex-1 rounded-[10px] py-2 text-sm font-semibold transition-colors",
                                            newPersonal === personal ? "bg-card text-foreground" : "text-muted-foreground",
                                        )}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                            <p className="text-xs text-muted-foreground">
                                {newPersonal ? "Solo para tus gastos personales." : "Compartida con el grupo."}
                            </p>
                        </div>
                    )}

                    <div className="space-y-2">
                        <EqLabel>Color</EqLabel>
                        <div className="flex gap-2 flex-wrap">
                            {PRESET_COLORS.map((color) => (
                                <button
                                    key={color}
                                    type="button"
                                    onClick={() => setNewColor(color)}
                                    className="h-8 w-8 rounded-full border-2 transition-all flex items-center justify-center"
                                    style={{
                                        backgroundColor: color,
                                        borderColor: newColor === color ? "var(--ink)" : "transparent",
                                    }}
                                    aria-label={COLOR_NAMES[color] ?? color}
                                    aria-pressed={newColor === color}
                                >
                                    {newColor === color && <Check className="h-4 w-4 text-white drop-shadow" />}
                                </button>
                            ))}
                        </div>
                    </div>

                    <EqCta
                        className="h-12 rounded-2xl text-[15px]"
                        onClick={handleCreate}
                        disabled={saving || !newName.trim()}
                    >
                        <Plus className="h-4 w-4" /> Crear etiqueta
                    </EqCta>

                    {error && <p className="text-sm text-destructive">{error}</p>}
                </EqCard>

                {tags.length === 0 ? (
                    <div className="py-6 text-center space-y-2">
                        <div className="text-4xl" aria-hidden>🏷️</div>
                        <h2 className="text-[15px] font-semibold text-foreground">Sin etiquetas aún</h2>
                        <p className="text-sm text-muted-foreground">
                            Crea etiquetas para organizar vuestros gastos
                        </p>
                    </div>
                ) : (
                    <section className="flex flex-col gap-2">
                        <EqLabel className="pl-1">Tus etiquetas · {tags.length}</EqLabel>

                        <div className="flex flex-wrap gap-2">
                            {tags.map((tag) => (
                                <div
                                    key={tag.id}
                                    className="flex items-center gap-2 pl-3 pr-2 py-[7px] rounded-full border border-[color:var(--line)] bg-card"
                                >
                                    <div
                                        className="h-3 w-3 rounded-full flex-shrink-0"
                                        style={{ backgroundColor: tag.color }}
                                    />
                                    <span className="text-[13px] font-semibold text-foreground">{tag.name}</span>
                                    {tag.personal && (
                                        <span className="text-[11px] text-muted-foreground">Personal</span>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => handleDelete(tag)}
                                        disabled={deleting === tag.id}
                                        className="ml-1 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
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
        </div>
    );
}
