"use client";

import { Button } from "@/components/ui/button";
import { ArrowLeft, Check, X, Clock, Receipt } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

interface Settlement {
    id: string;
    amount: number;
    date: Date;
    status: string;
    fromUserId: string;
    toUserId: string;
    fromUser: { name: string; avatar: string };
    toUser: { name: string; avatar: string };
    payments: { type: string; amount: number; description?: string; expense?: { description: string } }[];
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
            await fetch(`/api/settle/${id}/status`, {
                method: "PATCH",
                body: JSON.stringify({ status: newStatus })
            });
            router.refresh();
        } catch (e) {
            console.error(e);
            alert("Failed to update status");
        } finally {
            setLoadingIds(prev => prev.filter(x => x !== id));
        }
    };

    return (
        <div className="flex flex-col min-h-screen p-4 max-w-md mx-auto relative pb-24">
            <header className="flex items-center gap-4 py-4">
                <Link href="/settle">
                    <Button variant="ghost" size="icon" className="rounded-full"><ArrowLeft /></Button>
                </Link>
                <h1 className="text-lg font-bold">Historial de Pagos</h1>
            </header>

            <div className="space-y-4">
                {settlements.length === 0 && (
                    <div className="text-center py-20 text-muted-foreground">
                        No hay historial de pagos.
                    </div>
                )}
                {settlements.map((s: Settlement) => {
                    const isReceiver = s.toUserId === currentUserId;
                    const isPending = s.status === "PENDING";
                    const isLoading = loadingIds.includes(s.id);

                    return (
                        <div key={s.id} className="bg-card border border-white/10 rounded-xl p-4 space-y-3">
                            <div className="flex justify-between items-start">
                                <div className="flex items-center gap-3">
                                    <div className="h-10 w-10 rounded-full bg-gradient-to-tr from-white/10 to-white/5 flex items-center justify-center text-xl">
                                        {isReceiver ? "💰" : "💸"}
                                    </div>
                                    <div>
                                        <p className="font-bold">
                                            {isReceiver ? `De ${s.fromUser.name}` : `A ${s.toUser.name}`}
                                        </p>
                                        <p className="text-xs text-muted-foreground">{new Date(s.date).toLocaleDateString()}</p>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <span className="font-mono font-bold text-lg block">{s.amount.toFixed(2)}€</span>
                                    <span className={cn(
                                        "text-xs font-bold px-2 py-0.5 rounded-full inline-block mt-1",
                                        s.status === "CONFIRMED" ? "bg-emerald-500/20 text-emerald-400" :
                                            s.status === "REJECTED" ? "bg-red-500/20 text-red-400" :
                                                "bg-yellow-500/20 text-yellow-400"
                                    )}>
                                        {s.status}
                                    </span>
                                </div>
                            </div>

                            {/* Breakdown */}
                            <div className="bg-black/20 rounded-lg p-3 text-sm space-y-1">
                                {s.payments.map((p, i) => (
                                    <div key={i} className="flex justify-between text-muted-foreground">
                                        <span className="flex items-center gap-2">
                                            {p.type === "EXPENSE" ? <Receipt className="h-3 w-3" /> : "💶"}
                                            {p.type === "EXPENSE"
                                                ? (p.expense?.description || p.description || "Gasto")
                                                : (p.type === "BIZUM" ? "Bizum" : "Efectivo")
                                            }
                                        </span>
                                        <span>{p.amount.toFixed(2)}€</span>
                                    </div>
                                ))}
                            </div>

                            {/* Actions (Only for Receiver currently) */}
                            {isReceiver && isPending && (
                                <div className="flex gap-2 pt-2">
                                    <Button
                                        variant="ghost"
                                        className="flex-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 h-9"
                                        onClick={() => handleStatusUpdate(s.id, "CONFIRMED")}
                                        isLoading={isLoading}
                                        disabled={isLoading}
                                    >
                                        <Check className="h-4 w-4 mr-2" /> Confirmar
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        className="flex-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 h-9"
                                        onClick={() => handleStatusUpdate(s.id, "REJECTED")}
                                        isLoading={isLoading}
                                        disabled={isLoading}
                                    >
                                        <X className="h-4 w-4 mr-2" /> Rechazar
                                    </Button>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
