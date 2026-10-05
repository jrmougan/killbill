"use client";

import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { EqCta } from "@/components/ui/eq";
import { AuthShell, AuthField, AuthError } from "@/components/auth/auth-shell";
import { registerAction } from "./actions";
import type { AuthState } from "@/lib/auth-types";

function RegisterForm() {
    const searchParams = useSearchParams();
    const urlCode = searchParams.get("code");

    // Server Action handles register + cookie + redirect in one server response
    // (no client cookie/cache race). Errors come back as state.
    const [state, formAction, pending] = useActionState<AuthState, FormData>(registerAction, {});

    return (
        <AuthShell
            title="Crea tu cuenta"
            subtitle={
                urlCode
                    ? "Te han invitado a compartir gastos. Con tu cuenta entrarás directamente en el espacio."
                    : "EQUIL funciona por invitación: necesitas el código que te ha dado la administración."
            }
            footer={
                <p className="text-sm text-muted-foreground">
                    ¿Ya tienes cuenta?{" "}
                    <Link
                        href={`/login${urlCode ? `?code=${encodeURIComponent(urlCode)}` : ""}`}
                        className="font-semibold text-primary"
                    >
                        Inicia sesión
                    </Link>
                </p>
            }
        >
            <form action={formAction} className="flex flex-col gap-3">
                {state.error && <AuthError data-testid="register-error">{state.error}</AuthError>}

                {urlCode ? (
                    // From an invite link: carry the raw token (a long GroupInvite
                    // token, so NOT the 8-char manual input).
                    <input type="hidden" name="inviteToken" defaultValue={urlCode} />
                ) : (
                    <AuthField
                        data-testid="register-invite-code"
                        label="Código de invitación"
                        name="inviteCode"
                        required
                        maxLength={8}
                        autoCapitalize="characters"
                        autoComplete="off"
                        spellCheck={false}
                        className="font-mono tracking-[0.2em] uppercase"
                    />
                )}
                <AuthField
                    data-testid="register-name"
                    label="Nombre"
                    name="name"
                    required
                    maxLength={60}
                    autoComplete="name"
                />
                <AuthField
                    data-testid="register-email"
                    label="Email"
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    inputMode="email"
                />
                <AuthField
                    data-testid="register-password"
                    label="Contraseña"
                    name="password"
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    hint="Al menos 8 caracteres."
                />

                <EqCta data-testid="register-submit" type="submit" disabled={pending} aria-busy={pending} className="mt-3">
                    {pending ? "Creando cuenta…" : "Crear cuenta"}
                </EqCta>
            </form>
        </AuthShell>
    );
}

export default function RegisterPage() {
    return (
        <Suspense>
            <RegisterForm />
        </Suspense>
    );
}
