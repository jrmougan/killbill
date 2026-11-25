"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { parseInviteToken } from "@/lib/home-format";
import { cn } from "@/lib/utils";

/**
 * "Unirme con enlace": paste an invite link (`…/i/<token>`) and go to the public
 * consent screen `/i/<token>`. Nothing is joined here — the consent page asks
 * for explicit confirmation and reports expired/revoked/full links.
 */
export function JoinLinkForm({ focusOnMount = false, className }: { focusOnMount?: boolean; className?: string }) {
    const router = useRouter();
    const [value, setValue] = useState("");
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Focus when opened on demand (not on page load).
    useEffect(() => {
        if (focusOnMount) inputRef.current?.focus();
    }, [focusOnMount]);

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        const token = parseInviteToken(value);
        if (!token) {
            setError("Pega el enlace de tu invitación");
            return;
        }
        router.push(`/i/${encodeURIComponent(token)}`);
    };

    return (
        <form onSubmit={submit} className={cn("flex flex-col gap-2", className)} data-testid="join-link-form">
            <label htmlFor="join-link" className="text-[13px] font-semibold">
                Pega el enlace de invitación
            </label>
            <div className="flex gap-2">
                <input
                    id="join-link"
                    type="text"
                    inputMode="url"
                    autoComplete="off"
                    ref={inputRef}
                    value={value}
                    onChange={(e) => {
                        setValue(e.target.value);
                        setError(null);
                    }}
                    placeholder="https://…/i/…"
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? "join-link-error" : undefined}
                    className="flex-1 min-w-0 h-11 rounded-xl border border-[color:var(--line)] bg-card px-3 font-mono text-[13px] outline-none focus:border-primary"
                />
                <button
                    type="submit"
                    disabled={!value.trim()}
                    className="h-11 flex-none rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-40 active:scale-[0.97]"
                >
                    Continuar
                </button>
            </div>
            {error && (
                <span id="join-link-error" role="alert" className="text-xs text-destructive">
                    {error}
                </span>
            )}
        </form>
    );
}
