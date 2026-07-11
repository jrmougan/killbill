"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/**
 * Guest → account upgrade form (Fase 3). Collects an email + password and POSTs
 * to /api/guest/upgrade, which promotes the SAME shadow user in place. On the
 * P2002 ("email taken") case it surfaces a link to log in instead (v1: no merge).
 */
export function UpgradeForm() {
    const router = useRouter();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [emailTaken, setEmailTaken] = useState(false);

    async function submit(e: React.FormEvent) {
        e.preventDefault();
        setPending(true);
        setError(null);
        setEmailTaken(false);
        try {
            const res = await fetch("/api/guest/upgrade", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password }),
            });
            const data = await res.json();
            if (!res.ok) {
                setError(data.error ?? "No se pudo crear la cuenta");
                setEmailTaken(data.code === "EMAIL_TAKEN");
                setPending(false);
                return;
            }
            router.push("/dashboard");
            router.refresh();
        } catch {
            setError("Error de red. Inténtalo de nuevo.");
            setPending(false);
        }
    }

    return (
        <form onSubmit={submit} className="w-full space-y-3">
            {error && (
                <div className="bg-destructive/15 text-destructive text-sm p-3 rounded-md text-center space-y-1">
                    <p>{error}</p>
                    {emailTaken && (
                        <Link href="/login" className="text-primary underline font-medium">
                            Iniciar sesión
                        </Link>
                    )}
                </div>
            )}
            <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                autoComplete="email"
                className="w-full h-12 px-4 rounded-md border border-input bg-background text-lg"
                required
            />
            <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Contraseña (mín. 8 caracteres)"
                autoComplete="new-password"
                minLength={8}
                className="w-full h-12 px-4 rounded-md border border-input bg-background text-lg"
                required
            />
            <Button type="submit" size="lg" className="w-full h-12 text-lg" isLoading={pending}>
                Crear mi cuenta
            </Button>
        </form>
    );
}
