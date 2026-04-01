"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function LoginForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const inviteCode = searchParams.get("code");

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        try {
            const res = await fetch("/api/auth/login", {
                method: "POST",
                body: JSON.stringify({ email, password, inviteCode }),
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
                <h1 className="text-4xl font-bold tracking-tighter bg-gradient-to-br from-primary to-purple-400 bg-clip-text text-transparent italic">
                    EQUIL
                </h1>
                <p className="text-muted-foreground">
                    {inviteCode ? "Has sido invitado a un grupo. Inicia sesión para unirte." : "Entra para gestionar tus gastos."}
                </p>
            </div>

            <form onSubmit={handleLogin} className="w-full space-y-4">
                {error && (
                    <div data-testid="login-error" className="bg-destructive/15 text-destructive text-sm p-3 rounded-md text-center">
                        {error}
                    </div>
                )}

                <div className="space-y-4">
                    <Input
                        data-testid="login-email"
                        type="email"
                        placeholder="Email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        autoFocus
                        className="text-lg h-12"
                    />
                    <Input
                        data-testid="login-password"
                        type="password"
                        placeholder="Contraseña"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        className="text-lg h-12"
                    />
                </div>

                <Button
                    data-testid="login-submit"
                    type="submit"
                    size="lg"
                    className="w-full h-12 text-lg shadow-xl shadow-primary/20"
                    isLoading={loading}
                >
                    Entrar
                </Button>

                <div className="text-center text-sm text-muted-foreground mt-4">
                    ¿No tienes cuenta?{" "}
                    <Link href={`/register${inviteCode ? `?code=${inviteCode}` : ''}`} className="text-primary hover:underline">
                        Regístrate
                    </Link>
                </div>
            </form>
        </div>
    );
}

export default function LoginPage() {
    return (
        <Suspense>
            <LoginForm />
        </Suspense>
    )
}
