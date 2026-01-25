"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function RegisterForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const inviteCode = searchParams.get("code");

    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [groupType, setGroupType] = useState<"GROUP" | "COUPLE">("GROUP");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        try {
            const res = await fetch("/api/auth/register", {
                method: "POST",
                body: JSON.stringify({ name, email, password, inviteCode, groupType }),
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
        <div className="flex flex-col items-center justify-center min-h-screen p-6 space-y-8 max-w-md mx-auto">
            <div className="text-center space-y-2">
                <h1 className="text-4xl font-bold tracking-tighter bg-gradient-to-br from-primary to-purple-400 bg-clip-text text-transparent">
                    Kill Bill
                </h1>
                <p className="text-muted-foreground">
                    {inviteCode ? "Has sido invitado a un grupo. Crea una cuenta para unirte." : "Crea tu cuenta para empezar."}
                </p>
            </div>

            <form onSubmit={handleRegister} className="w-full space-y-4">
                {error && (
                    <div className="bg-destructive/15 text-destructive text-sm p-3 rounded-md text-center">
                        {error}
                    </div>
                )}

                {!inviteCode && (
                    <div className="grid grid-cols-2 gap-4 pb-2">
                        <div
                            className={`cursor-pointer border rounded-xl p-4 flex flex-col items-center gap-2 transition-all ${groupType === "GROUP" ? "bg-primary/20 border-primary" : "bg-white/5 border-white/10 hover:bg-white/10"}`}
                            onClick={() => setGroupType("GROUP")}
                        >
                            <span className="text-2xl">👥</span>
                            <span className="font-bold text-sm">Grupo</span>
                        </div>
                        <div
                            className={`cursor-pointer border rounded-xl p-4 flex flex-col items-center gap-2 transition-all ${groupType === "COUPLE" ? "bg-primary/20 border-primary" : "bg-white/5 border-white/10 hover:bg-white/10"}`}
                            onClick={() => setGroupType("COUPLE")}
                        >
                            <span className="text-2xl">❤️</span>
                            <span className="font-bold text-sm">Pareja</span>
                        </div>
                    </div>
                )}

                <div className="space-y-4">
                    <Input
                        placeholder="Nombre"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                        className="text-lg h-12"
                    />
                    <Input
                        type="email"
                        placeholder="Email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        className="text-lg h-12"
                    />
                    <Input
                        type="password"
                        placeholder="Contraseña"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        className="text-lg h-12"
                    />
                </div>

                <Button
                    type="submit"
                    size="lg"
                    className="w-full h-12 text-lg shadow-xl shadow-primary/20"
                    isLoading={loading}
                >
                    {inviteCode ? "Unirse al Grupo" : "Registrarse"}
                </Button>

                <div className="text-center text-sm text-muted-foreground mt-4">
                    ¿Ya tienes cuenta?{" "}
                    <Link href={`/login${inviteCode ? `?code=${inviteCode}` : ''}`} className="text-primary hover:underline">
                        Inicia sesión
                    </Link>
                </div>
            </form>
        </div>
    );
}

export default function RegisterPage() {
    return (
        <Suspense>
            <RegisterForm />
        </Suspense>
    )
}
