"use client";

import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface DeleteExpenseButtonProps {
    expenseId: string;
}

export function DeleteExpenseButton({ expenseId }: DeleteExpenseButtonProps) {
    const router = useRouter();
    const [showConfirm, setShowConfirm] = useState(false);
    const [loading, setLoading] = useState(false);

    const handleDelete = async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/expenses/${expenseId}`, {
                method: "DELETE",
            });

            if (res.ok) {
                router.push("/dashboard");
                router.refresh();
            } else {
                alert("Error al eliminar el gasto");
            }
        } catch (err) {
            console.error(err);
            alert("Error de conexión");
        } finally {
            setLoading(false);
        }
    };

    if (showConfirm) {
        return (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-6 animate-in fade-in duration-200">
                <div className="bg-card border border-white/10 rounded-2xl p-6 max-w-sm w-full space-y-4 animate-in zoom-in-95 duration-200">
                    <div className="text-center space-y-2">
                        <div className="h-12 w-12 rounded-full bg-destructive/20 flex items-center justify-center mx-auto">
                            <Trash2 className="h-6 w-6 text-destructive" />
                        </div>
                        <h3 className="text-lg font-bold">¿Eliminar gasto?</h3>
                        <p className="text-sm text-muted-foreground">
                            Esta acción no se puede deshacer. El gasto se eliminará permanentemente.
                        </p>
                    </div>
                    <div className="flex gap-3">
                        <Button
                            variant="secondary"
                            className="flex-1"
                            onClick={() => setShowConfirm(false)}
                            disabled={loading}
                        >
                            Cancelar
                        </Button>
                        <Button
                            variant="destructive"
                            className="flex-1"
                            onClick={handleDelete}
                            isLoading={loading}
                        >
                            Eliminar
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
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => setShowConfirm(true)}
        >
            <Trash2 className="h-4 w-4 mr-2" />
            Eliminar
        </Button>
    );
}
