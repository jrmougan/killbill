"use client";

import { Button } from "@/components/ui/button";
import { Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Promote a PERSONAL expense to a SHARED (group) one. Wires the existing
 * POST /api/expenses/[id]/share endpoint (N-way, splits + ledger). Shown only for
 * a personal expense whose owner belongs to a group.
 */
export function PromoteButton({ expenseId }: { expenseId: string }) {
    const router = useRouter();
    const [showConfirm, setShowConfirm] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handlePromote = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/expenses/${expenseId}/share`, { method: "POST" });
            if (res.ok) {
                setShowConfirm(false);
                router.refresh(); // the expense is now SHARED — re-render the page
            } else {
                const body = await res.json().catch(() => ({}));
                setError(body.error ?? "No se pudo compartir el gasto");
            }
        } catch {
            setError("Error de conexión");
        } finally {
            setLoading(false);
        }
    };

    if (showConfirm) {
        return (
            <div className="fixed inset-0 bg-[color:var(--ink)]/40 backdrop-blur-sm z-50 flex items-center justify-center p-6 animate-in fade-in duration-200">
                <div className="bg-card border border-[color:var(--line)] rounded-2xl p-6 max-w-sm w-full space-y-4 animate-in zoom-in-95 duration-200">
                    <div className="text-center space-y-2">
                        <div className="h-12 w-12 rounded-full bg-[var(--accent-tint)] flex items-center justify-center mx-auto">
                            <Users className="h-6 w-6 text-primary" />
                        </div>
                        <h3 className="text-lg font-bold">¿Compartir con el grupo?</h3>
                        <p className="text-sm text-muted-foreground">
                            El gasto pasará a ser compartido: se repartirá entre los miembros del grupo y contará en los balances. Dejará de ser privado.
                        </p>
                        {error && <p className="text-sm text-destructive">{error}</p>}
                    </div>
                    <div className="flex gap-3">
                        <Button variant="secondary" className="flex-1" onClick={() => setShowConfirm(false)} disabled={loading}>
                            Cancelar
                        </Button>
                        <Button className="flex-1" onClick={handlePromote} isLoading={loading}>
                            Compartir
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <Button
            variant="ghost"
            size="sm"
            className="text-primary hover:text-primary hover:bg-[var(--accent-tint)]"
            onClick={() => setShowConfirm(true)}
        >
            <Users className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Compartir</span>
        </Button>
    );
}
