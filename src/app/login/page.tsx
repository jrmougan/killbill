"use client";

import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { EqCta } from "@/components/ui/eq";
import { AuthShell, AuthField, AuthError } from "@/components/auth/auth-shell";
import { loginAction } from "./actions";
import type { AuthState } from "@/lib/auth-types";

function LoginForm() {
    const searchParams = useSearchParams();
    const inviteCode = searchParams.get("code");

    // Server Action handles auth + cookie + redirect in a single server response,
    // so navigation never races the cookie write (the old "tap login twice on
    // mobile" bug). Errors come back as form state.
    const [state, formAction, pending] = useActionState<AuthState, FormData>(loginAction, {});

    return (
        <AuthShell
            title={inviteCode ? "Entra para unirte" : "Hola de nuevo"}
            subtitle={
                inviteCode
                    ? "Te han invitado a un espacio. Inicia sesión y confirma que quieres unirte."
                    : "Entra para ver vuestras cuentas."
            }
            footer={
                <p className="text-sm text-muted-foreground">
                    ¿No tienes cuenta?{" "}
                    <Link
                        href={`/register${inviteCode ? `?code=${encodeURIComponent(inviteCode)}` : ""}`}
                        className="font-semibold text-primary"
                    >
                        Regístrate
                    </Link>
                </p>
            }
        >
            <form action={formAction} className="flex flex-col gap-3">
                {state.error && <AuthError data-testid="login-error">{state.error}</AuthError>}

                {inviteCode && <input type="hidden" name="inviteCode" defaultValue={inviteCode} />}

                <AuthField
                    data-testid="login-email"
                    label="Email"
                    name="email"
                    type="email"
                    required
                    // oxlint-disable-next-line jsx-a11y/no-autofocus -- focuses primary email field on login form load (intentional UX)
                    autoFocus
                    autoComplete="email"
                    inputMode="email"
                />
                <AuthField
                    data-testid="login-password"
                    label="Contraseña"
                    name="password"
                    type="password"
                    required
                    autoComplete="current-password"
                />

                <EqCta data-testid="login-submit" type="submit" disabled={pending} aria-busy={pending} className="mt-3">
                    {pending ? "Entrando…" : "Entrar"}
                </EqCta>
            </form>
        </AuthShell>
    );
}

export default function LoginPage() {
    return (
        <Suspense>
            <LoginForm />
        </Suspense>
    );
}
