"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Check } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewExpensePage() {
    const router = useRouter();
    const [amount, setAmount] = useState("");
    const [description, setDescription] = useState("");
    const [category, setCategory] = useState("food");
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        try {
            const res = await fetch("/api/expenses", {
                method: "POST",
                body: JSON.stringify({
                    amount: parseFloat(amount),
                    description,
                    category
                }),
            });

            if (res.ok) {
                router.push("/dashboard");
                router.refresh();
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex flex-col min-h-screen p-4 space-y-6 max-w-md mx-auto relative">
            <header className="flex items-center gap-4 pt-2">
                <Link href="/dashboard">
                    <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-white/10">
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                </Link>
                <h1 className="text-xl font-bold">Nuevo Gasto</h1>
            </header>

            <form onSubmit={handleSubmit} className="flex-1 space-y-8 mt-4">

                {/* Helper for Amount */}
                <div className="space-y-2 text-center py-6">
                    <label className="text-sm text-muted-foreground uppercase tracking-widest font-bold">¿Cuánto ha sido?</label>
                    <div className="relative inline-block w-full max-w-[200px]">
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 text-3xl font-bold text-muted-foreground">€</span>
                        <input
                            type="number"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder="0.00"
                            className="w-full bg-transparent text-center text-5xl font-bold focus:outline-none placeholder:text-white/10 p-2 appearance-none"
                            autoFocus
                            required
                            step="0.01"
                        />
                    </div>
                </div>

                <div className="space-y-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium ml-1">Concepto</label>
                        <Input
                            placeholder="Ej: Compra semanal"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            required
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium ml-1">Categoría</label>
                        <div className="grid grid-cols-3 gap-2">
                            {["food", "rent", "utilities", "transport", "entertainment", "other"].map((cat) => (
                                <button
                                    key={cat}
                                    type="button"
                                    onClick={() => setCategory(cat)}
                                    className={`p-3 rounded-xl border border-white/5 text-sm font-medium capitalize transition-all ${category === cat ? "bg-primary text-white border-primary" : "bg-white/5 hover:bg-white/10"
                                        }`}
                                >
                                    {cat}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="pt-8">
                    <Button
                        type="submit"
                        size="lg"
                        className="w-full text-base h-14 shadow-xl shadow-primary/20"
                        isLoading={loading}
                    >
                        Guardar Gasto <Check className="ml-2 h-5 w-5" />
                    </Button>
                </div>
            </form>
        </div>
    );
}
