"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Shield, Loader2 } from "lucide-react";

export default function SetupPage() {
    const router = useRouter();
    const [checking, setChecking] = useState(true);
    const [allowed, setAllowed] = useState(false);

    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState(false);

    useEffect(() => {
        checkSetup();
    }, []);

    const checkSetup = async () => {
        try {
            const res = await fetch("/api/setup");
            const data = await res.json();
            setAllowed(data.setupRequired);
        } catch {
            setError("Error al verificar estado");
        } finally {
            setChecking(false);
        }
    };

    const handleSetup = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        try {
            const res = await fetch("/api/setup", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, email, password }),
            });

            const data = await res.json();

            if (res.ok) {
                setSuccess(true);
                setTimeout(() => router.push("/login"), 2000);
            } else {
                setError(data.error || "Error al crear admin");
            }
        } catch {
            setError("Error de conexión");
        } finally {
            setLoading(false);
        }
    };

    if (checking) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    if (!allowed) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen p-6 space-y-4">
                <div className="text-6xl">✅</div>
                <h1 className="text-2xl font-bold">Setup completado</h1>
                <p className="text-muted-foreground text-center">
                    La aplicación ya está configurada.<br />
                    Inicia sesión para continuar.
                </p>
                <Button onClick={() => router.push("/login")}>
                    Ir a Login
                </Button>
            </div>
        );
    }

    if (success) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen p-6 space-y-4">
                <div className="text-6xl">👑</div>
                <h1 className="text-2xl font-bold text-green-400">¡Admin creado!</h1>
                <p className="text-muted-foreground">Redirigiendo al login...</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col items-center justify-center min-h-screen p-6 space-y-8 max-w-md mx-auto">
            <div className="text-center space-y-4">
                <div className="h-16 w-16 rounded-full bg-primary/20 flex items-center justify-center mx-auto">
                    <Shield className="h-8 w-8 text-primary" />
                </div>
                <h1 className="text-3xl font-bold">Setup Inicial</h1>
                <p className="text-muted-foreground">
                    Crea el primer usuario administrador para gestionar invitaciones.
                </p>
            </div>

            <form onSubmit={handleSetup} className="w-full space-y-4">
                {error && (
                    <div className="bg-destructive/15 text-destructive text-sm p-3 rounded-md text-center">
                        {error}
                    </div>
                )}

                <div className="space-y-4">
                    <Input
                        placeholder="Nombre del admin"
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
                    Crear Administrador
                </Button>
            </form>
        </div>
    );
}
