"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EqCta } from "@/components/ui/eq";
import { AuthError, AuthField } from "@/components/auth/auth-shell";

/**
 * Guest → account upgrade form (Fase 3). Collects an email + password and POSTs
 * to /api/guest/upgrade, which promotes the SAME shadow user in place. On the
 * P2002 ("email taken") case it surfaces a link to log in instead (v1: no merge).
 * Inputs carry visible labels (IE-17).
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
            const data = await res.json().catch(() => ({}));
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
        <form onSubmit={submit} className="flex flex-col gap-3">
            {error && (
                <AuthError>
                    {error}
                    {emailTaken && (
                        <>
                            {" "}
                            <Link href="/login" className="font-semibold underline">
                                Iniciar sesión
                            </Link>
                        </>
                    )}
                </AuthError>
            )}
            <AuthField
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                inputMode="email"
                maxLength={191}
                required
            />
            <AuthField
                label="Contraseña"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                hint="Al menos 8 caracteres."
                required
            />
            <EqCta type="submit" disabled={pending} aria-busy={pending} className="mt-3">
                {pending ? "Creando cuenta…" : "Crear mi cuenta"}
            </EqCta>
        </form>
    );
}
