"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { User as UserIcon, Users, Ticket, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * First-run onboarding chooser (Fase 3). Three non-blocking paths + a skip.
 * "Tengo una invitación" accepts either a full invite URL or a bare token and
 * routes to the public consent screen /i/[token].
 */

/** Extract the invite token from a pasted URL (…/i/TOKEN) or a bare token. */
function parseInviteToken(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const match = trimmed.match(/\/i\/([^/?#\s]+)/);
    const token = match ? match[1] : trimmed;
    return token ? decodeURIComponent(token) : null;
}

export function WelcomeClient() {
    const router = useRouter();
    const [inviteOpen, setInviteOpen] = useState(false);
    const [invite, setInvite] = useState("");
    const [error, setError] = useState<string | null>(null);

    const goToInvite = () => {
        const token = parseInviteToken(invite);
        if (!token) {
            setError("Pega el enlace o el código de tu invitación");
            return;
        }
        router.push(`/i/${encodeURIComponent(token)}`);
    };

    return (
        <div className="flex flex-col min-h-screen p-6 max-w-md mx-auto justify-center space-y-8">
            <div className="text-center space-y-2">
                <h1 className="text-4xl font-bold tracking-tighter text-primary italic">EQUIL</h1>
                <p className="text-muted-foreground">¿Cómo quieres empezar?</p>
            </div>

            <div className="space-y-3">
                {/* Solo */}
                <Link
                    href="/dashboard?scope=personal"
                    className="flex items-center gap-4 rounded-2xl bg-card border border-[color:var(--line)] px-4 py-4 active:scale-[0.99] transition-transform"
                >
                    <span className="h-11 w-11 rounded-[13px] bg-[var(--accent-tint)] flex items-center justify-center shrink-0">
                        <UserIcon className="h-5 w-5 text-primary" />
                    </span>
                    <span className="flex-1 min-w-0">
                        <span className="block text-[15px] font-semibold text-foreground">Solo para mí</span>
                        <span className="block text-[12px] text-muted-foreground">Lleva tus gastos personales</span>
                    </span>
                    <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </Link>

                {/* Create a space */}
                <Link
                    href="/spaces/new"
                    className="flex items-center gap-4 rounded-2xl bg-card border border-[color:var(--line)] px-4 py-4 active:scale-[0.99] transition-transform"
                >
                    <span className="h-11 w-11 rounded-[13px] bg-[var(--positive-tint)] flex items-center justify-center shrink-0">
                        <Users className="h-5 w-5 text-[color:var(--positive)]" />
                    </span>
                    <span className="flex-1 min-w-0">
                        <span className="block text-[15px] font-semibold text-foreground">Crear un espacio</span>
                        <span className="block text-[12px] text-muted-foreground">Pareja, grupo o viaje compartido</span>
                    </span>
                    <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </Link>

                {/* I have an invite */}
                <button
                    type="button"
                    onClick={() => setInviteOpen((v) => !v)}
                    className="w-full flex items-center gap-4 rounded-2xl bg-card border border-[color:var(--line)] px-4 py-4 text-left active:scale-[0.99] transition-transform"
                >
                    <span className="h-11 w-11 rounded-[13px] bg-secondary flex items-center justify-center shrink-0">
                        <Ticket className="h-5 w-5 text-muted-foreground" />
                    </span>
                    <span className="flex-1 min-w-0">
                        <span className="block text-[15px] font-semibold text-foreground">Tengo una invitación</span>
                        <span className="block text-[12px] text-muted-foreground">Pega tu enlace de invitación</span>
                    </span>
                    <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </button>

                {inviteOpen && (
                    <div className="space-y-2 rounded-2xl bg-secondary border border-[color:var(--line)] p-3 animate-in fade-in slide-in-from-top-2">
                        {error && (
                            <div className="bg-destructive/15 text-destructive text-xs p-2 rounded-md text-center">
                                {error}
                            </div>
                        )}
                        <input
                            type="text"
                            value={invite}
                            onChange={(e) => {
                                setInvite(e.target.value);
                                setError(null);
                            }}
                            placeholder="Enlace o código de invitación"
                            className="w-full h-11 px-3 rounded-md border border-input bg-background text-sm"
                        />
                        <Button onClick={goToInvite} className="w-full h-11">
                            Continuar
                        </Button>
                    </div>
                )}
            </div>

            <div className="text-center">
                <Link href="/dashboard" className="text-sm text-muted-foreground hover:underline">
                    Saltar por ahora
                </Link>
            </div>
        </div>
    );
}
