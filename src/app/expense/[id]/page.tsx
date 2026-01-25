import { Button } from "@/components/ui/button";
import { ArrowLeft, Heart } from "lucide-react";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cn } from "@/lib/utils";

export default async function ExpenseDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const cookieStore = await cookies();
    const userId = cookieStore.get("user_id")?.value;
    if (!userId) redirect("/login");

    const expense = await prisma.expense.findUnique({
        where: { id: id },
        include: {
            paidBy: true,
            splits: {
                include: {
                    user: true
                }
            }
        }
    });

    if (!expense) redirect("/dashboard");

    const isMe = userId === expense.paidById;

    return (
        <div className="flex flex-col min-h-screen p-4 space-y-6 max-w-md mx-auto relative pb-24">
            <header className="flex items-center gap-4 pt-2">
                <Link href="/dashboard">
                    <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-white/10">
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                </Link>
                <div className="flex-1">
                    <h1 className="text-xl font-bold truncate">{expense.description}</h1>
                    <p className="text-xs text-muted-foreground">{new Date(expense.date).toLocaleDateString()}</p>
                </div>
            </header>

            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="text-center py-6 bg-white/5 rounded-3xl border border-white/10">
                    <p className="text-sm text-muted-foreground uppercase tracking-widest font-bold mb-2">Importe Total</p>
                    <h2 className="text-6xl font-mono font-bold tracking-tighter">
                        {expense.amount.toFixed(2)}<span className="text-3xl ml-1 text-muted-foreground">€</span>
                    </h2>
                    <div className="mt-4 flex items-center justify-center gap-2">
                        <div className="h-6 w-6 rounded-full bg-white/10 flex items-center justify-center overflow-hidden">
                            {expense.paidBy.avatar || "👤"}
                        </div>
                        <p className="text-sm font-medium">Pagado por <span className="text-primary">{isMe ? "Ti" : expense.paidBy.name}</span></p>
                    </div>
                </div>

                <div className="space-y-4">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground ml-1 flex items-center gap-2">
                        <Heart className="h-4 w-4 fill-primary text-primary" />
                        Reparto en Pareja
                    </h3>
                    <div className="bg-card border border-white/10 rounded-2xl overflow-hidden">
                        {expense.splits.length === 0 ? (
                            <div className="p-8 text-center text-muted-foreground border-dashed border-white/10">
                                No hay detalles de reparto para este gasto.
                            </div>
                        ) : (
                            <div className="divide-y divide-white/5">
                                {expense.splits.map((split: any) => (
                                    <div key={split.id} className="flex items-center justify-between p-4 bg-white/5">
                                        <div className="flex items-center gap-3">
                                            <div className="h-8 w-8 rounded-full bg-white/10 flex items-center justify-center text-xs overflow-hidden text-lg">
                                                {split.user.avatar || "👤"}
                                            </div>
                                            <div>
                                                <p className="font-medium text-sm">{split.userId === userId ? "Ti" : split.user.name}</p>
                                                {split.userId === expense.paidById && (
                                                    <p className="text-[10px] text-emerald-400 font-bold uppercase tracking-tighter">Aportación</p>
                                                )}
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="font-mono font-bold">{split.amount.toFixed(2)}€</p>
                                            <p className="text-[10px] text-muted-foreground uppercase">Cargo</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
