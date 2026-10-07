"use client";

import { EqCta } from "@/components/ui/eq";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Shield, Loader2 } from "lucide-react";

/**
 * First-admin form of /setup (shown only while the instance has no users; the
 * server page decides). Creation goes through POST /api/setup, which re-checks
 * that no user exists.
 */
export function SetupForm() {
    const router = useRouter();
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState(false);

    const handleSetup = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");

        if (password.length < 8) {
            setError("La contraseña debe tener al menos 8 caracteres");
            return;
        }

        setLoading(true);

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

    if (success) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen p-6 space-y-4">
                <div className="text-6xl">👑</div>
                <h1 className="text-2xl font-bold text-primary">¡Admin creado!</h1>
                <p className="text-muted-foreground">Redirigiendo al login...</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col justify-center min-h-screen p-6 space-y-8 w-full max-w-md mx-auto">
            <div className="w-full flex flex-col gap-3.5">
                <span className="text-[15px] font-extrabold tracking-[0.14em] text-primary">EQUIL</span>
                <h1 className="text-[36px] font-bold tracking-[-0.03em] leading-[1.05] flex items-center gap-2.5">
                    <Shield className="h-8 w-8 text-primary flex-none" aria-hidden="true" />
                    Setup inicial
                </h1>
                <p className="text-[15px] text-muted-foreground leading-[1.45]">
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
                        className="h-12 rounded-[14px] bg-card text-[15px]"
                    />
                    <Input
                        type="email"
                        placeholder="Email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        autoComplete="email"
                        className="h-12 rounded-[14px] bg-card text-[15px]"
                    />
                    <Input
                        type="password"
                        placeholder="Contraseña"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        autoComplete="new-password"
                        className="h-12 rounded-[14px] bg-card text-[15px]"
                    />
                </div>

                <EqCta type="submit" disabled={loading}>
                    {loading && <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />}
                    Crear administrador
                </EqCta>
            </form>
        </div>
    );
}
