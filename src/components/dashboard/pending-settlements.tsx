"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { Check, X, Clock } from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

interface PendingSettlement {
    id: string;
    amount: number;
    fromUser: { name: string; avatar: string | null };
    date: string;
    method: string;
}

interface PendingSettlementsProps {
    settlements: PendingSettlement[];
}

export function PendingSettlements({ settlements }: PendingSettlementsProps) {
    const router = useRouter();
    const [loadingIds, setLoadingIds] = useState<string[]>([]);

    const handleStatusUpdate = async (id: string, newStatus: string) => {
        setLoadingIds(prev => [...prev, id]);
        try {
            const res = await fetch(`/api/settle/${id}/status`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: newStatus })
            });

            if (res.ok) {
                router.refresh();
            } else {
                alert("Error al actualizar el estado");
            }
        } catch (e) {
            console.error(e);
            alert("Error de conexión");
        } finally {
            setLoadingIds(prev => prev.filter(x => x !== id));
        }
    };

    if (settlements.length === 0) return null;

    return (
        <section className="space-y-4 animate-in fade-in slide-in-from-top-4 duration-500">
            <h2 className="text-lg font-bold ml-1 flex items-center gap-2">
                <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span>
                </span>
                Confirmar Pagos
            </h2>

            <div className="space-y-3">
                {settlements.map((s) => (
                    <GlassCard key={s.id} className="p-4 border-blue-500/30 bg-blue-500/10 shadow-lg shadow-blue-500/5">
                        <div className="flex justify-between items-start mb-4">
                            <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-full bg-blue-500/20 flex items-center justify-center text-xl">
                                    {s.fromUser.avatar || "👤"}
                                </div>
                                <div>
                                    <p className="font-bold text-sm">
                                        {s.fromUser.name} te ha pagado
                                    </p>
                                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-mono">
                                        {new Date(s.date).toLocaleDateString()} • {s.method}
                                    </p>
                                </div>
                            </div>
                            <div className="text-right">
                                <span className="text-2xl font-mono font-bold text-blue-400 leading-none block">
                                    {s.amount.toFixed(2)}€
                                </span>
                            </div>
                        </div>

                        <div className="flex gap-2">
                            <Button
                                className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white font-bold h-11"
                                onClick={() => handleStatusUpdate(s.id, "CONFIRMED")}
                                disabled={loadingIds.includes(s.id)}
                            >
                                <Check className="h-5 w-5 mr-2" /> Confirmar
                            </Button>
                            <Button
                                variant="ghost"
                                className="bg-red-500/10 hover:bg-red-500/20 text-red-400 h-11 px-4"
                                onClick={() => handleStatusUpdate(s.id, "REJECTED")}
                                disabled={loadingIds.includes(s.id)}
                            >
                                <X className="h-5 w-5" />
                            </Button>
                        </div>
                    </GlassCard>
                ))}
            </div>
        </section>
    );
}
