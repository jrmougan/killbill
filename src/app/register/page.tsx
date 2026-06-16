"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { registerAction } from "./actions";
import type { AuthState } from "@/lib/auth-types";

function RegisterForm() {
    const searchParams = useSearchParams();
    const urlCode = searchParams.get("code");

    // Server Action handles register + cookie + redirect("/dashboard") in one
    // server response (no client cookie/cache race). Errors come back as state.
    const [state, formAction, pending] = useActionState<AuthState, FormData>(registerAction, {});

    return (
        <div className="flex flex-col items-center justify-center min-h-screen p-6 space-y-8 max-w-md mx-auto">
            <div className="text-center space-y-2">
                <h1 className="text-4xl font-bold tracking-tighter bg-gradient-to-br from-primary to-purple-400 bg-clip-text text-transparent italic">
                    EQUIL
                </h1>
                <p className="text-muted-foreground">
                    {urlCode
                        ? "Te han invitado a compartir gastos. ¡Regístrate!"
                        : "Necesitas un código de invitación para registrarte."}
                </p>
            </div>

            <form action={formAction} className="w-full space-y-4">
                {state.error && (
                    <div data-testid="register-error" className="bg-destructive/15 text-destructive text-sm p-3 rounded-md text-center">
                        {state.error}
                    </div>
                )}

                <div className="space-y-4">
                    <Input
                        data-testid="register-invite-code"
                        name="inviteCode"
                        placeholder="Código de invitación"
                        defaultValue={urlCode || ""}
                        required
                        className="text-lg h-12 font-mono text-center tracking-widest uppercase placeholder:normal-case"
                        maxLength={8}
                    />
                    <Input
                        data-testid="register-name"
                        name="name"
                        placeholder="Nombre"
                        required
                        className="text-lg h-12"
                    />
                    <Input
                        data-testid="register-email"
                        name="email"
                        type="email"
                        placeholder="Email"
                        required
                        autoComplete="email"
                        className="text-lg h-12"
                    />
                    <Input
                        data-testid="register-password"
                        name="password"
                        type="password"
                        placeholder="Contraseña"
                        required
                        minLength={8}
                        autoComplete="new-password"
                        className="text-lg h-12"
                    />
                </div>

                <Button
                    data-testid="register-submit"
                    type="submit"
                    size="lg"
                    className="w-full h-12 text-lg shadow-xl shadow-primary/20"
                    isLoading={pending}
                >
                    Registrarse
                </Button>

                <div className="text-center text-sm text-muted-foreground mt-4">
                    ¿Ya tienes cuenta?{" "}
                    <Link
                        href="/login"
                        className="text-primary hover:underline"
                    >
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
    );
}
