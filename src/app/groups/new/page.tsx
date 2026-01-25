"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GlassCard } from "@/components/ui/glass-card";
import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Users, Heart, ArrowLeft } from "lucide-react";
import Link from "next/link";

function NewGroupForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const preselectedType = searchParams.get("type") as "GROUP" | "COUPLE" | null;

    const [name, setName] = useState("");
    const [type, setType] = useState<"GROUP" | "COUPLE">(preselectedType || "GROUP");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        try {
            const res = await fetch("/api/groups", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, type }),
            });

            const data = await res.json();

            if (res.ok) {
                router.push("/dashboard");
                router.refresh();
            } else {
                setError(data.error || "Algo salió mal");
            }
        } catch (err) {
            console.error(err);
            setError("Error de conexión");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex flex-col min-h-screen p-4 space-y-6 max-w-md mx-auto">
            <header className="flex items-center gap-4 pt-2">
                <Link href="/dashboard">
                    <Button variant="ghost" size="icon">
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                </Link>
                <h1 className="text-xl font-bold">Crear {type === "COUPLE" ? "Pareja" : "Grupo"}</h1>
            </header>

            <form onSubmit={handleCreate} className="space-y-6">
                {error && (
                    <div className="bg-destructive/15 text-destructive text-sm p-3 rounded-md text-center">
                        {error}
                    </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                    <GlassCard
                        className={`cursor-pointer transition-all py-6 flex flex-col items-center gap-2 ${type === "GROUP"
                                ? "bg-primary/20 border-primary"
                                : "hover:bg-white/10"
                            }`}
                        onClick={() => setType("GROUP")}
                    >
                        <Users className="h-8 w-8 text-primary" />
                        <span className="font-bold">Grupo</span>
                    </GlassCard>
                    <GlassCard
                        className={`cursor-pointer transition-all py-6 flex flex-col items-center gap-2 ${type === "COUPLE"
                                ? "bg-pink-500/20 border-pink-500"
                                : "hover:bg-white/10"
                            }`}
                        onClick={() => setType("COUPLE")}
                    >
                        <Heart className="h-8 w-8 text-pink-500" />
                        <span className="font-bold">Pareja</span>
                    </GlassCard>
                </div>

                <div className="space-y-2">
                    <label className="text-sm text-muted-foreground">
                        {type === "COUPLE" ? "Nombre de la pareja (opcional)" : "Nombre del grupo"}
                    </label>
                    <Input
                        placeholder={type === "COUPLE" ? "Ej: Casa" : "Ej: Piso de la calle mayor"}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required={type === "GROUP"}
                        className="text-lg h-12"
                    />
                </div>

                <Button
                    type="submit"
                    size="lg"
                    className="w-full h-12 text-lg shadow-xl shadow-primary/20"
                    isLoading={loading}
                >
                    Crear {type === "COUPLE" ? "Pareja" : "Grupo"}
                </Button>
            </form>
        </div>
    );
}

export default function NewGroupPage() {
    return (
        <Suspense>
            <NewGroupForm />
        </Suspense>
    );
}
