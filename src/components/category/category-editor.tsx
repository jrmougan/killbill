"use client";

import { useState } from "react";
import { Check, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
    type CategoryContext,
    type CategoryListItem,
    categoriesEndpoint,
} from "@/lib/category-context";
import { CATEGORY_PALETTE } from "@/lib/category-colors";
import { ICON_KEYS } from "@/lib/category-icons";
import { slugsToReservedKey } from "@/lib/category-keys";
import { EmojiPicker, isSingleGrapheme } from "./emoji-picker";
import { IconPicker } from "./icon-picker";
import { ColorSwatchPicker } from "./color-swatch-picker";
import { CategoryBadge } from "./category-badge";

interface CategoryEditorProps {
    context: CategoryContext;
    /** When set, edits an existing custom category; otherwise creates a new one. */
    existing?: CategoryListItem | null;
    /** Called after a successful create/update (parent should reload its list). */
    onSaved?: () => void;
    onCancel?: () => void;
}

/**
 * Create/edit form for a custom category (Fase 4). Label is required; labelEn is
 * optional (the server copies label when omitted — decision #4). Emoji/icon/color
 * come from the closed sub-pickers, mirroring the server validation. Warns (but
 * does not block client-side) when the label would slug to a reserved system key
 * — the server returns 400 (decision #1).
 */
export function CategoryEditor({ context, existing, onSaved, onCancel }: CategoryEditorProps) {
    const isEdit = Boolean(existing);
    const [label, setLabel] = useState(existing?.label ?? "");
    const [labelEn, setLabelEn] = useState(existing?.labelEn ?? "");
    const [emoji, setEmoji] = useState(existing?.emoji ?? "📦");
    const [iconName, setIconName] = useState(existing?.iconName ?? ICON_KEYS[0]);
    const [hex, setHex] = useState(existing?.hex ?? CATEGORY_PALETTE[0]);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const labelOk = label.trim().length > 0 && label.trim().length <= 40;
    const emojiOk = isSingleGrapheme(emoji);
    const reservedWarn = !isEdit && labelOk && slugsToReservedKey(label);
    const canSave = labelOk && emojiOk && !saving;

    const preview = { key: existing?.key, emoji, label: label.trim() || "Categoría", hex, iconName };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canSave) return;
        setSaving(true);
        setError(null);
        try {
            const endpoint = categoriesEndpoint(context);
            const payload = {
                label: label.trim(),
                labelEn: labelEn.trim() || undefined,
                emoji: emoji.trim(),
                iconName,
                hex,
                ...(isEdit ? { id: existing!.id } : {}),
            };
            const res = await fetch(endpoint, {
                method: isEdit ? "PATCH" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                const json = await res.json().catch(() => null);
                setError(json?.error || "No se pudo guardar la categoría");
                return;
            }
            onSaved?.();
        } catch {
            setError("Error de conexión. Inténtalo de nuevo.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-5">
            {/* Live preview */}
            <div className="flex items-center gap-3">
                <CategoryBadge meta={preview} variant="emoji" />
                <CategoryBadge meta={preview} variant="icon" />
                <span className="text-sm font-semibold text-foreground">{preview.label}</span>
            </div>

            {/* Label */}
            <div className="space-y-1.5">
                <label htmlFor="cat-label" className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Nombre
                </label>
                <input
                    id="cat-label"
                    type="text"
                    value={label}
                    maxLength={40}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="p. ej. Mascotas"
                    className="w-full bg-card border border-[color:var(--line)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[color:var(--accent-border)]"
                />
                {reservedWarn && (
                    <p className="flex items-center gap-1.5 text-[11px] text-[color:var(--negative)]">
                        <AlertCircle className="h-3 w-3" /> Ese nombre coincide con una categoría del sistema. Elige otro.
                    </p>
                )}
            </div>

            {/* labelEn (optional) */}
            <div className="space-y-1.5">
                <label htmlFor="cat-label-en" className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Nombre en inglés <span className="normal-case font-normal">(opcional)</span>
                </label>
                <input
                    id="cat-label-en"
                    type="text"
                    value={labelEn}
                    maxLength={40}
                    onChange={(e) => setLabelEn(e.target.value)}
                    placeholder="Pets"
                    className="w-full bg-card border border-[color:var(--line)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[color:var(--accent-border)]"
                />
            </div>

            {/* Emoji */}
            <div className="space-y-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Emoji</span>
                <EmojiPicker value={emoji} onChange={setEmoji} />
            </div>

            {/* Icon */}
            <div className="space-y-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Icono</span>
                <IconPicker value={iconName} onChange={setIconName} hex={hex} />
            </div>

            {/* Color */}
            <div className="space-y-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Color</span>
                <ColorSwatchPicker value={hex} onChange={setHex} />
            </div>

            {error && (
                <div role="alert" className="flex items-center gap-2 rounded-xl bg-[var(--negative-tint)] border border-[color:var(--negative)]/30 px-3 py-2.5 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            <div className="flex gap-2">
                <Button type="submit" disabled={!canSave} className={cn("flex-1", !canSave && "opacity-60")}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
                    {isEdit ? "Guardar" : "Crear categoría"}
                </Button>
                {onCancel && (
                    <Button type="button" variant="ghost" onClick={onCancel}>
                        Cancelar
                    </Button>
                )}
            </div>
        </form>
    );
}
