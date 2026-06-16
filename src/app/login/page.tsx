"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { loginAction } from "./actions";
import type { AuthState } from "@/lib/auth-types";

function LoginForm() {
    const searchParams = useSearchParams();
    const inviteCode = searchParams.get("code");

    // Server Action handles auth + cookie + redirect("/dashboard") in a single
    // server response, so navigation never races the cookie write (the old
    // "tap login twice on mobile" bug). Errors come back as form state.
    const [state, formAction, pending] = useActionState<AuthState, FormData>(loginAction, {});

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

            <form action={formAction} className="w-full space-y-4">
                {state.error && (
                    <div data-testid="login-error" className="bg-destructive/15 text-destructive text-sm p-3 rounded-md text-center">
                        {state.error}
                    </div>
                )}

                {inviteCode && <input type="hidden" name="inviteCode" defaultValue={inviteCode} />}

                <div className="space-y-4">
                    <Input
                        data-testid="login-email"
                        name="email"
                        type="email"
                        placeholder="Email"
                        required
                        autoFocus
                        autoComplete="email"
                        className="text-lg h-12"
                    />
                    <Input
                        data-testid="login-password"
                        name="password"
                        type="password"
                        placeholder="Contraseña"
                        required
                        autoComplete="current-password"
                        className="text-lg h-12"
                    />
                </div>

                <Button
                    data-testid="login-submit"
                    type="submit"
                    size="lg"
                    className="w-full h-12 text-lg shadow-xl shadow-primary/20"
                    isLoading={pending}
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
