"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { EqCta } from "@/components/ui/eq";
import { cn } from "@/lib/utils";
import { JoinLinkForm } from "./join-link-form";

type Choice = "pareja" | "piso" | "viaje" | "solo";
type ApiType = "COUPLE" | "GROUP" | "EPHEMERAL";

type Option = { key: Choice; emoji: string; title: string; sub: string; type: ApiType | null; defaultName: string };

/**
 * Space-type chooser shared by the onboarding (`/welcome`) and "Crear espacio"
 * (`/spaces/new`) — prototype `is.welcome`. Mapping (docs/design/README.md):
 * Pareja→COUPLE, Piso→GROUP, Viaje→EPHEMERAL only behind the ephemeral flag
 * (otherwise a GROUP "Con amigos"), Solo yo→INDIVIDUAL (virtual: no row is
 * created, it just opens the personal context). Creation reuses
 * `POST /api/spaces`, which also makes the new space the active one.
 */
function optionsFor(ephemeralEnabled: boolean): Option[] {
    return [
        { key: "pareja", emoji: "💑", title: "Mi pareja", sub: "2 personas", type: "COUPLE", defaultName: "Casa" },
        { key: "piso", emoji: "🏢", title: "Mi piso", sub: "Compañeros", type: "GROUP", defaultName: "Piso" },
        ephemeralEnabled
            ? { key: "viaje", emoji: "✈️", title: "Un viaje", sub: "Con fecha de fin", type: "EPHEMERAL", defaultName: "Viaje" }
            : { key: "viaje", emoji: "🎉", title: "Con amigos", sub: "Viajes y planes", type: "GROUP", defaultName: "Amigos" },
        { key: "solo", emoji: "👤", title: "Solo yo", sub: "Finanzas personales", type: null, defaultName: "" },
    ];
}

export function CreateSpaceFlow({
    mode,
    ephemeralEnabled,
}: {
    /** `onboard` = first run (/welcome); `create` = another space (/spaces/new). */
    mode: "onboard" | "create";
    ephemeralEnabled: boolean;
}) {
    const router = useRouter();
    const options = optionsFor(ephemeralEnabled);
    const [choice, setChoice] = useState<Choice>(mode === "create" ? "piso" : "pareja");
    const [name, setName] = useState<string | null>(null); // null = untouched → default
    const [expiresAt, setExpiresAt] = useState("");
    const [joinOpen, setJoinOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const selected = options.find((o) => o.key === choice)!;
    const effectiveName = name ?? selected.defaultName;

    const submit = async () => {
        setError(null);
        if (!selected.type) {
            router.push("/dashboard?scope=personal");
            return;
        }
        setSaving(true);
        try {
            const res = await fetch("/api/spaces", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    type: selected.type,
                    name: effectiveName.trim() || undefined,
                    expiresAt: selected.type === "EPHEMERAL" && expiresAt ? expiresAt : undefined,
                }),
            });
            const data = await res.json().catch(() => null);
            if (res.ok && data?.space?.id) {
                router.push("/dashboard");
                router.refresh();
                return;
            }
            setError(data?.error || "No se pudo crear el espacio");
        } catch {
            setError("Error de conexión");
        }
        setSaving(false);
    };

    return (
        <div className="min-h-dvh flex flex-col eq-in">
            {mode === "create" && (
                <div className="px-6 pt-4">
                    <Link href="/spaces" aria-label="Volver" className="block h-6 w-6">
                        <ArrowLeft className="h-6 w-6" />
                    </Link>
                </div>
            )}

            <div className={cn("px-6 flex flex-col gap-3.5", mode === "create" ? "pt-8" : "pt-12")}>
                <span className="text-[15px] font-extrabold tracking-[0.14em] text-primary">EQUIL</span>
                <h1 className="text-[36px] font-bold tracking-[-0.03em] leading-[1.05] text-pretty">
                    ¿Con quién compartes gastos?
                </h1>
                <p className="text-[15px] text-muted-foreground leading-[1.45]">
                    {mode === "create"
                        ? "Elige el tipo de espacio nuevo."
                        : "Crea tu primer espacio. Podrás añadir más cuando quieras."}
                </p>
            </div>

            <fieldset className="px-6 pt-7 grid grid-cols-2 gap-2.5">
                <legend className="sr-only">Tipo de espacio</legend>
                {options.map((o) => {
                    const sel = o.key === choice;
                    return (
                        <button
                            key={o.key}
                            type="button"
                            aria-pressed={sel}
                            onClick={() => {
                                setChoice(o.key);
                                setError(null);
                            }}
                            className={cn(
                                "h-[104px] rounded-[18px] bg-card p-3.5 flex flex-col justify-between text-left transition-colors",
                                sel ? "border-2 border-primary" : "border border-[color:var(--line)]",
                            )}
                        >
                            <span className="text-2xl" aria-hidden="true">{o.emoji}</span>
                            <span>
                                <span className="block text-[15px] font-semibold">{o.title}</span>
                                <span className="block text-xs text-muted-foreground">{o.sub}</span>
                            </span>
                        </button>
                    );
                })}
            </fieldset>

            {selected.type && (
                <div className="px-6 pt-5 flex flex-col gap-3 eq-in" key={selected.key}>
                    <label className="flex flex-col gap-1.5">
                        <span className="text-xs font-semibold text-muted-foreground">Nombre del espacio</span>
                        <input
                            value={effectiveName}
                            onChange={(e) => setName(e.target.value)}
                            maxLength={60}
                            placeholder={selected.defaultName}
                            className="h-12 rounded-[14px] border border-[color:var(--line)] bg-card px-3.5 text-[15px] outline-none focus:border-primary"
                        />
                    </label>
                    {selected.type === "EPHEMERAL" && (
                        <label className="flex flex-col gap-1.5">
                            <span className="text-xs font-semibold text-muted-foreground">Hasta (opcional)</span>
                            <input
                                type="date"
                                value={expiresAt}
                                onChange={(e) => setExpiresAt(e.target.value)}
                                className="h-12 rounded-[14px] border border-[color:var(--line)] bg-card px-3.5 text-[15px] outline-none focus:border-primary"
                            />
                            <span className="text-xs text-muted-foreground">Es un recordatorio: el viaje no se cierra solo.</span>
                        </label>
                    )}
                </div>
            )}

            <div className="mt-auto px-6 pt-8 pb-[calc(34px+env(safe-area-inset-bottom))] flex flex-col items-center gap-3.5">
                {error && (
                    <p role="alert" className="text-sm text-destructive text-center">{error}</p>
                )}
                <EqCta onClick={submit} disabled={saving}>
                    {mode === "create" && selected.type ? "Crear espacio" : "Continuar"}
                </EqCta>
                <button
                    type="button"
                    aria-expanded={joinOpen}
                    onClick={() => setJoinOpen((v) => !v)}
                    className="text-sm font-semibold text-primary px-1.5 py-1.5"
                >
                    Me han invitado · tengo un enlace
                </button>
                {joinOpen && (
                    <div className="w-full eq-in rounded-2xl bg-card border border-[color:var(--line)] p-3.5">
                        <JoinLinkForm focusOnMount />
                    </div>
                )}
            </div>
        </div>
    );
}
