"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Sheet, SheetField } from "@/components/ui/sheet";

const MAX = 60;

/** "Renombrar" (OWNER/ADMIN, not archived): PATCH /api/spaces/[id] { name }. */
export function RenameSpace({ spaceId, name }: { spaceId: string; name: string }) {
    const router = useRouter();
    const [refreshing, startTransition] = useTransition();
    const [open, setOpen] = useState(false);
    const [value, setValue] = useState(name);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const trimmed = value.replace(/\s+/g, " ").trim();
    const valid = trimmed.length > 0 && trimmed.length <= MAX;

    const save = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!valid) {
            setError(trimmed.length === 0 ? "Escribe un nombre" : `Máximo ${MAX} caracteres`);
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const res = await fetch(`/api/spaces/${spaceId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: trimmed }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) {
                setError(data?.error || "No se pudo cambiar el nombre");
                return;
            }
            setOpen(false);
            startTransition(() => router.refresh());
        } catch {
            setError("Sin conexión. Inténtalo de nuevo.");
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <button
                type="button"
                onClick={() => {
                    setValue(name);
                    setError(null);
                    setOpen(true);
                }}
                aria-label="Cambiar el nombre del espacio"
                data-testid="rename-space"
                className="h-11 w-11 flex-none rounded-xl flex items-center justify-center text-muted-foreground hover:bg-[var(--track)]"
            >
                <Pencil className="h-[18px] w-[18px]" aria-hidden="true" />
            </button>
            {open && (
                <Sheet title="Nombre del espacio" onClose={() => setOpen(false)}>
                    <form onSubmit={save} className="flex flex-col gap-4">
                        <SheetField
                            label="Nombre"
                            value={value}
                            onChange={(e) => {
                                setValue(e.target.value);
                                setError(null);
                            }}
                            maxLength={MAX}
                            aria-invalid={error ? true : undefined}
                        />
                        <span className="-mt-2 text-xs text-muted-foreground text-right">{trimmed.length}/{MAX}</span>
                        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
                        <button
                            type="submit"
                            disabled={busy || refreshing || !valid}
                            className="h-14 rounded-[18px] bg-primary text-primary-foreground text-base font-semibold disabled:opacity-40"
                        >
                            Guardar
                        </button>
                    </form>
                </Sheet>
            )}
        </>
    );
}
