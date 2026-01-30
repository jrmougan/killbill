"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pencil, X, Check, Heart, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { getAllCategories } from "@/lib/categories";

interface EditExpenseButtonProps {
    expenseId: string;
    initialData: {
        description: string;
        amount: number;
        category: string;
        splitWithPartner: boolean;
        partnerName?: string;
    };
}

export function EditExpenseButton({ expenseId, initialData }: EditExpenseButtonProps) {
    const router = useRouter();
    const [showModal, setShowModal] = useState(false);
    const [loading, setLoading] = useState(false);

    const [description, setDescription] = useState(initialData.description);
    const [amount, setAmount] = useState(initialData.amount.toString());
    const [category, setCategory] = useState(initialData.category);
    const [splitWithPartner, setSplitWithPartner] = useState(initialData.splitWithPartner);

    const handleSave = async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/expenses/${expenseId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    description,
                    amount,
                    category,
                    splitWithPartner,
                }),
            });

            if (res.ok) {
                setShowModal(false);
                router.refresh();
            } else {
                alert("Error al guardar los cambios");
            }
        } catch (err) {
            console.error(err);
            alert("Error de conexión");
        } finally {
            setLoading(false);
        }
    };

    if (showModal) {
        return (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
                <div className="bg-card border border-white/10 rounded-2xl p-5 max-w-sm w-full space-y-5 animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
                    <div className="flex items-center justify-between">
                        <h3 className="text-lg font-bold">Editar Gasto</h3>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setShowModal(false)}
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    </div>

                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Importe</label>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">€</span>
                                <Input
                                    type="number"
                                    value={amount}
                                    onChange={(e) => setAmount(e.target.value)}
                                    className="pl-8 text-lg font-bold"
                                    step="0.01"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Concepto</label>
                            <Input
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Categoría</label>
                            <div className="grid grid-cols-4 gap-1.5">
                                {getAllCategories().map((cat) => (
                                    <button
                                        key={cat.id}
                                        type="button"
                                        onClick={() => setCategory(cat.id)}
                                        className={cn(
                                            "p-2 rounded-lg border border-white/5 text-center transition-all",
                                            category === cat.id
                                                ? "bg-primary text-white border-primary"
                                                : "bg-white/5 hover:bg-white/10"
                                        )}
                                    >
                                        <span className="text-lg block">{cat.emoji}</span>
                                        <span className="text-[8px] font-bold uppercase">{cat.label}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Reparto</label>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    type="button"
                                    onClick={() => setSplitWithPartner(true)}
                                    className={cn(
                                        "py-2 text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-1.5",
                                        splitWithPartner
                                            ? "bg-primary text-white shadow-lg"
                                            : "text-muted-foreground hover:text-white bg-white/5"
                                    )}
                                >
                                    <Heart className={cn("h-3.5 w-3.5", splitWithPartner && "fill-current")} />
                                    Común
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setSplitWithPartner(false)}
                                    className={cn(
                                        "py-2 text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-1.5",
                                        !splitWithPartner
                                            ? "bg-primary text-white shadow-lg"
                                            : "text-muted-foreground hover:text-white bg-white/5"
                                    )}
                                >
                                    <User className="h-3.5 w-3.5" />
                                    Favor
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="flex gap-3 pt-2">
                        <Button
                            variant="secondary"
                            className="flex-1"
                            onClick={() => setShowModal(false)}
                            disabled={loading}
                        >
                            Cancelar
                        </Button>
                        <Button
                            className="flex-1"
                            onClick={handleSave}
                            isLoading={loading}
                        >
                            <Check className="h-4 w-4 mr-1" />
                            Guardar
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
            className="text-muted-foreground hover:text-white"
            onClick={() => setShowModal(true)}
        >
            <Pencil className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Editar</span>
        </Button>
    );
}
