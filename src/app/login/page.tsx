"use client";

import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { EqCta } from "@/components/ui/eq";
import { FlashToast } from "@/components/ui/flash-toast";
import { AuthShell, AuthField, AuthError } from "@/components/auth/auth-shell";
import { loginAction } from "./actions";
import type { AuthState } from "@/lib/auth-types";

function LoginForm() {
    const searchParams = useSearchParams();
    const inviteCode = searchParams.get("code");
    const signedOut = searchParams.get("signedOut");
    const signedOutNote =
        signedOut === "all"
            ? "Has cerrado la sesión en todos tus dispositivos. Los tokens de Hermes y otros clientes MCP ya no funcionan."
            : signedOut === "1"
              ? "Has cerrado la sesión."
              : null;

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
                        className="-my-3 inline-flex min-h-11 items-center px-1 font-semibold text-primary rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                        Regístrate
                    </Link>
                </p>
            }
        >
            <form action={formAction} className="flex flex-col gap-3">
                {signedOutNote && !state.error && (
                    // <output> = role="status": announced politely on arrival.
                    <output
                        data-testid="login-signed-out"
                        className="block rounded-[14px] bg-[var(--positive-tint)] px-3.5 py-3 text-sm font-medium text-pretty"
                    >
                        {signedOutNote}
                    </output>
                )}
                {state.error && (
                    <AuthError id="login-error" data-testid="login-error">
                        {state.error}
                    </AuthError>
                )}

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
                    // Keep what was typed after a failed attempt (the form resets).
                    defaultValue={state.email}
                    aria-invalid={state.error ? true : undefined}
                    aria-describedby={state.error ? "login-error" : undefined}
                />
                <AuthField
                    data-testid="login-password"
                    label="Contraseña"
                    name="password"
                    type="password"
                    required
                    autoComplete="current-password"
                    aria-invalid={state.error ? true : undefined}
                    aria-describedby={state.error ? "login-error" : undefined}
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
            <FlashToast />
        </Suspense>
    );
}
