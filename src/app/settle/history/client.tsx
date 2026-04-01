"use client";

import { Button } from "@/components/ui/button";
import { ArrowLeft, Check, X, Clock, Receipt } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { GlassCard } from "@/components/ui/glass-card";
import { toEuros } from "@/lib/currency";

interface Settlement {
    id: string;
    amount: number;
    date: Date;
    status: string;
    method: string;
    fromUserId: string;
    toUserId: string;
    fromUser: { name: string; avatar: string };
    toUser: { name: string; avatar: string };
}

interface SettlementHistoryClientProps {
    settlements: any[]; // using any for quick prop mapping, but interface defined above
    currentUserId: string;
}

export function SettlementHistoryClient({ settlements, currentUserId }: SettlementHistoryClientProps) {
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

    const getStatusInfo = (status: string) => {
        switch (status) {
            case "CONFIRMED":
                return { label: "Confirmado", color: "bg-emerald-500/20 text-emerald-400" };
            case "REJECTED":
                return { label: "Rechazado", color: "bg-red-500/20 text-red-400" };
            case "PENDING":
            default:
                return { label: "Pendiente", color: "bg-yellow-500/20 text-yellow-400" };
        }
    };

    return (
        <div className="flex flex-col min-h-screen p-4 max-w-md mx-auto relative pb-24">
            <header className="flex items-center gap-4 pt-2 mb-6">
                <Link href="/dashboard">
                    <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-white/10">
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                </Link>
                <h1 className="text-xl font-bold">Historial de Pagos</h1>
            </header>

            <div className="space-y-4">
                {settlements.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
                        <div className="h-20 w-20 rounded-full bg-white/5 flex items-center justify-center">
                            <Clock className="h-10 w-10 text-white/20" />
                        </div>
                        <div className="space-y-1">
                            <p className="font-medium text-muted-foreground">No hay pagos registrados</p>
                            <p className="text-xs text-white/20">Vuelve cuando hayáis liquidado alguna deuda</p>
                        </div>
                    </div>
                ) : (
                    settlements.map((s: Settlement) => {
                        const isReceiver = s.toUserId === currentUserId;
                        const isPending = s.status === "PENDING";
                        const isLoading = loadingIds.includes(s.id);
                        const statusInfo = getStatusInfo(s.status);

                        return (
                            <GlassCard key={s.id} className="p-4 space-y-4 border border-white/5">
                                <div className="flex justify-between items-start">
                                    <div className="flex items-center gap-3">
                                        <div className={cn(
                                            "h-12 w-12 rounded-full flex items-center justify-center text-2xl shadow-inner",
                                            isReceiver ? "bg-emerald-500/20 text-emerald-400" : "bg-primary/20 text-primary"
                                        )}>
                                            {isReceiver ? "💰" : "💸"}
                                        </div>
                                        <div>
                                            <p className="font-bold text-sm">
                                                {isReceiver ? `Recibido de ${s.fromUser.name}` : `Pagado a ${s.toUser.name}`}
                                            </p>
                                            <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">
                                                {new Date(s.date).toLocaleDateString('es-ES', {
                                                    day: '2-digit',
                                                    month: 'short',
                                                    year: 'numeric'
                                                })}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="text-right space-y-1">
                                        <span className="font-mono font-bold text-xl block leading-none">{toEuros(s.amount).toFixed(2)}€</span>
                                        <span className={cn(
                                            "text-[10px] font-bold px-2 py-0.5 rounded-full inline-block uppercase tracking-wider",
                                            statusInfo.color
                                        )}>
                                            {statusInfo.label}
                                        </span>
                                    </div>
                                </div>

                                <div className="bg-black/20 rounded-xl p-3 text-xs flex justify-between items-center text-muted-foreground">
                                    <span className="flex items-center gap-2">
                                        {s.method === "BIZUM" ? <Receipt className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                                        {s.method === "BIZUM" ? "Bizum / Transferencia" : (s.method === "CASH" ? "Efectivo" : s.method)}
                                    </span>
                                </div>

                                {isReceiver && isPending && (
                                    <div className="flex gap-2 pt-1">
                                        <Button
                                            variant="ghost"
                                            className="flex-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 h-10 text-xs font-bold"
                                            onClick={() => handleStatusUpdate(s.id, "CONFIRMED")}
                                            isLoading={isLoading}
                                            disabled={isLoading}
                                        >
                                            <Check className="h-4 w-4 mr-2" /> Confirmar
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            className="flex-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 h-10 text-xs font-bold"
                                            onClick={() => handleStatusUpdate(s.id, "REJECTED")}
                                            isLoading={isLoading}
                                            disabled={isLoading}
                                        >
                                            <X className="h-4 w-4 mr-2" /> Rechazar
                                        </Button>
                                    </div>
                                )}
                            </GlassCard>
                        );
                    })
                )}
            </div>
        </div>
    );
}
