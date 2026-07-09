"use client";

import { Button } from "@/components/ui/button";
import { ArrowLeft, Check, X, Clock, Receipt } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { GlassCard } from "@/components/ui/glass-card";
import { formatCurrency } from "@/lib/currency";
import { getSettlementStatusLabel } from "@/lib/settlement-labels";

interface Settlement {
    id: string;
    amount: number;
    date: Date;
    status: string;
    method: string;
    fromUserId: string;
    toUserId: string;
    fromUser: { name: string; avatar: string | null };
    toUser: { name: string; avatar: string | null };
}

interface SettlementHistoryClientProps {
    settlements: Settlement[];
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
        const label = getSettlementStatusLabel(status);
        switch (status) {
            case "CONFIRMED":
                return { label, color: "bg-[var(--positive-tint)] text-[color:var(--positive)]" };
            case "REJECTED":
                return { label, color: "bg-[var(--negative-tint)] text-destructive" };
            case "PENDING":
            default:
                return { label, color: "bg-[var(--accent-tint)] text-primary" };
        }
    };

    return (
        <div className="flex flex-col min-h-screen p-4 max-w-md mx-auto relative pb-24">
            <header className="flex items-center gap-4 pt-2 mb-6">
                <Link href="/dashboard">
                    <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-secondary">
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                </Link>
                <h1 className="text-xl font-bold text-foreground">Historial de Pagos</h1>
            </header>

            <div className="space-y-4">
                {settlements.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
                        <div className="h-20 w-20 rounded-full bg-secondary flex items-center justify-center">
                            <Clock className="h-10 w-10 text-[color:var(--ink-3)]" />
                        </div>
                        <div className="space-y-1">
                            <p className="font-medium text-muted-foreground">No hay pagos registrados</p>
                            <p className="text-xs text-[color:var(--ink-3)]">Vuelve cuando hayáis liquidado alguna deuda</p>
                        </div>
                    </div>
                ) : (
                    settlements.map((s: Settlement) => {
                        const isReceiver = s.toUserId === currentUserId;
                        const isPending = s.status === "PENDING";
                        const isLoading = loadingIds.includes(s.id);
                        const statusInfo = getStatusInfo(s.status);

                        return (
                            <GlassCard key={s.id} className="p-4 space-y-4 border border-[color:var(--line-2)]">
                                <div className="flex justify-between items-start">
                                    <div className="flex items-center gap-3">
                                        <div className={cn(
                                            "h-12 w-12 rounded-full flex items-center justify-center text-2xl",
                                            isReceiver ? "bg-[var(--positive-tint)] text-[color:var(--positive)]" : "bg-[var(--accent-tint)] text-primary"
                                        )}>
                                            {isReceiver ? "💰" : "💸"}
                                        </div>
                                        <div>
                                            <p className="font-bold text-sm text-foreground">
                                                {isReceiver ? `Recibido de ${s.fromUser.name}` : `Pagado a ${s.toUser.name}`}
                                            </p>
                                            <p className="text-[10px] text-[color:var(--ink-3)] font-mono uppercase tracking-wider">
                                                {new Date(s.date).toLocaleDateString('es-ES', {
                                                    day: '2-digit',
                                                    month: 'short',
                                                    year: 'numeric'
                                                })}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="text-right space-y-1">
                                        <span className="font-mono font-semibold tracking-[-0.02em] text-xl block leading-none text-foreground">{formatCurrency(s.amount)}</span>
                                        <span className={cn(
                                            "text-[10px] font-bold px-2 py-0.5 rounded-full inline-block uppercase tracking-wider",
                                            statusInfo.color
                                        )}>
                                            {statusInfo.label}
                                        </span>
                                    </div>
                                </div>

                                <div className="bg-secondary rounded-xl p-3 text-xs flex justify-between items-center text-muted-foreground">
                                    <span className="flex items-center gap-2">
                                        {s.method === "BIZUM" ? <Receipt className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                                        {s.method === "BIZUM" ? "Bizum / Transferencia" : (s.method === "CASH" ? "Efectivo" : s.method)}
                                    </span>
                                </div>

                                {isReceiver && isPending && (
                                    <div className="flex gap-2 pt-1">
                                        <Button
                                            variant="ghost"
                                            className="flex-1 bg-[var(--positive-tint)] hover:bg-[var(--positive-tint)] text-[color:var(--positive)] h-10 text-xs font-bold"
                                            onClick={() => handleStatusUpdate(s.id, "CONFIRMED")}
                                            isLoading={isLoading}
                                            disabled={isLoading}
                                        >
                                            <Check className="h-4 w-4 mr-2" /> Confirmar
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            className="flex-1 bg-[var(--negative-tint)] hover:bg-[var(--negative-tint)] text-destructive h-10 text-xs font-bold"
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
