"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { SpaceType } from "@/generated/prisma/enums";
import { SPACE_TYPE_META } from "@/lib/space-ui";

/**
 * Typed space creation (Fase 1). The type is chosen HERE and never inferred from
 * member count. Posts to POST /api/spaces; expiresAt is only offered for
 * EPHEMERAL (a close suggestion — no cron in v1).
 */

const CREATABLE: SpaceType[] = [SpaceType.COUPLE, SpaceType.GROUP, SpaceType.EPHEMERAL];

export function CreateSpaceForm() {
    const router = useRouter();
    const [type, setType] = useState<SpaceType>(SpaceType.GROUP);
    const [name, setName] = useState("");
    const [expiresAt, setExpiresAt] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async () => {
        setSaving(true);
        setError(null);
        try {
            const res = await fetch("/api/spaces", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    type,
                    name: name.trim() || undefined,
                    expiresAt: type === SpaceType.EPHEMERAL && expiresAt ? expiresAt : undefined,
                }),
            });
            const data = await res.json().catch(() => null);
            if (res.ok && data?.space?.id) {
                router.push(`/spaces/${data.space.id}`);
                router.refresh();
            } else {
                setError(data?.error || "No se pudo crear el espacio");
            }
        } catch {
            setError("Error de conexión");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="flex flex-col min-h-screen p-4 space-y-6 max-w-md mx-auto pb-24">
            <header className="flex items-center gap-3 pt-2">
                <Link href="/settings">
                    <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-secondary">
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                </Link>
                <h1 className="text-xl font-bold text-foreground">Nuevo espacio</h1>
            </header>

            <div className="space-y-3">
                <span className="text-[11px] font-semibold tracking-wide uppercase text-muted-foreground">Tipo de espacio</span>
                <div className="space-y-2">
                    {CREATABLE.map((t) => {
                        const meta = SPACE_TYPE_META[t];
                        const sel = type === t;
                        return (
                            <button
                                key={t}
                                type="button"
                                onClick={() => setType(t)}
                                aria-pressed={sel}
                                className={cn(
                                    "w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border text-left transition-all active:scale-[0.99]",
                                    sel
                                        ? "bg-[var(--accent-tint)] border-[color:var(--accent-border)]"
                                        : "bg-card border-[color:var(--line)] hover:bg-secondary",
                                )}
                            >
                                <span className="w-11 h-11 rounded-[13px] bg-secondary flex items-center justify-center text-[22px] shrink-0">
                                    {meta.emoji}
                                </span>
                                <span className="flex-1 min-w-0">
                                    <span className="block text-[15px] font-semibold text-foreground">{meta.label}</span>
                                    <span className="block text-[12px] text-muted-foreground">{meta.blurb}</span>
                                </span>
                                <span
                                    className={cn(
                                        "h-[18px] w-[18px] rounded-full border-2 shrink-0",
                                        sel ? "border-primary bg-primary shadow-[inset_0_0_0_3px_var(--surface-hex)]" : "border-[color:var(--line-strong)]",
                                    )}
                                />
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="space-y-2">
                <label htmlFor="space-name" className="text-[11px] font-semibold tracking-wide uppercase text-muted-foreground">
                    Nombre
                </label>
                <Input
                    id="space-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={SPACE_TYPE_META[type].label + " (opcional)"}
                />
            </div>

            {type === SpaceType.EPHEMERAL && (
                <div className="space-y-2 animate-in fade-in duration-200">
                    <label htmlFor="space-expires" className="text-[11px] font-semibold tracking-wide uppercase text-muted-foreground">
                        Fecha de cierre sugerida (opcional)
                    </label>
                    <Input
                        id="space-expires"
                        type="date"
                        value={expiresAt}
                        onChange={(e) => setExpiresAt(e.target.value)}
                    />
                    <p className="text-[11px] text-muted-foreground/70">
                        Es solo un recordatorio; el viaje no se cierra solo.
                    </p>
                </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button size="lg" className="w-full h-14 text-base font-bold" onClick={submit} isLoading={saving}>
                Crear espacio <Check className="ml-2 h-5 w-5" />
            </Button>
        </div>
    );
}
