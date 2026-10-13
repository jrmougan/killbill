"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Check, ChevronRight, Copy, KeyRound, Plus, ShieldAlert } from "lucide-react";
import { EqCta, EqLabel } from "@/components/ui/eq";
import { Sheet, SheetField } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/**
 * "Tokens de acceso" (Ajustes → Agentes IA (MCP)): opaque, revocable bearer
 * tokens for any MCP client. Contract:
 *   GET    /api/me/tokens        → { tokens: AccessTokenSummary[] }
 *   POST   /api/me/tokens        { name, expiresInDays: 30|90|365|null } → 201 { token, ...summary }
 *   DELETE /api/me/tokens/[id]   → { success: true }
 * The plaintext token is only ever shown once, in a sheet that can't be
 * dismissed by accident (Escape / backdrop).
 */

/** Mirrors `AccessTokenSummary` from `@/lib/access-tokens` (server-only module). */
export type AccessTokenItem = {
    id: string;
    name: string;
    prefix: string;
    createdAt: string;
    lastUsedAt: string | null;
    expiresAt: string | null;
    status: "active" | "expired" | "revoked";
};

type CreatedToken = AccessTokenItem & { token: string };

export const MAX_TOKEN_NAME = 60;

/** Duration choices (days; `null` = never expires). 90 is the default. */
export const TOKEN_DURATIONS: { value: 30 | 90 | 365 | null; label: string }[] = [
    { value: 30, label: "30 días" },
    { value: 90, label: "90 días" },
    { value: 365, label: "1 año" },
    { value: null, label: "Sin caducidad" },
];

const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Madrid" });
const fmtLongDate = (iso: string) =>
    new Date(iso).toLocaleDateString("es-ES", { dateStyle: "long", timeZone: "Europe/Madrid" });

const isIso = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(new Date(v).getTime());
const isIsoOrNull = (v: unknown) => v === null || isIso(v);

function isTokenItem(v: unknown): v is AccessTokenItem {
    if (!v || typeof v !== "object") return false;
    const t = v as Record<string, unknown>;
    return (
        typeof t.id === "string" &&
        typeof t.name === "string" &&
        typeof t.prefix === "string" &&
        isIso(t.createdAt) &&
        isIsoOrNull(t.lastUsedAt) &&
        isIsoOrNull(t.expiresAt) &&
        (t.status === "active" || t.status === "expired" || t.status === "revoked")
    );
}

/** Only 4xx messages are meant for people; never surface a raw 5xx. */
const apiError = (res: Response, data: unknown, fallback: string) => {
    const msg = (data as { error?: unknown } | null)?.error;
    return res.status < 500 && typeof msg === "string" && msg ? msg : fallback;
};

const mcpUrl = () => (typeof window === "undefined" ? "/api/mcp" : `${window.location.origin}/api/mcp`);

/** Generic MCP client config (`mcpServers` JSON, the de-facto common format). */
export function mcpClientConfig(url: string, token: string) {
    return JSON.stringify(
        { mcpServers: { killbill: { url, headers: { Authorization: `Bearer ${token}` } } } },
        null,
        2,
    );
}

export function activeTokensLabel(tokens: AccessTokenItem[] | null) {
    const n = tokens?.filter((t) => t.status === "active").length ?? 0;
    if (n === 0) return "Conecta un agente o cliente MCP";
    return n === 1 ? "1 activo" : `${n} activos`;
}

type View = { kind: "list" } | { kind: "create" } | { kind: "created"; token: CreatedToken } | { kind: "revoke"; token: AccessTokenItem };

/**
 * Settings row + its sheets. Rendered as a single wrapper element so it slots
 * into a hairline-divided `Section` like any other row.
 */
export function AccessTokensSettings({ rowClassName }: { rowClassName: string }) {
    const [view, setView] = useState<View | null>(null);
    const [tokens, setTokens] = useState<AccessTokenItem[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const loadRef = useRef<AbortController | null>(null);

    const load = useCallback(async () => {
        loadRef.current?.abort();
        const controller = new AbortController();
        loadRef.current = controller;
        setLoading(true);
        setLoadError(null);
        try {
            const res = await fetch("/api/me/tokens", { signal: controller.signal, cache: "no-store" });
            const data = await res.json().catch(() => null);
            if (loadRef.current !== controller) return;
            const list: unknown = data?.tokens;
            if (!res.ok || !Array.isArray(list) || !list.every(isTokenItem)) {
                setLoadError(apiError(res, data, "No se pudieron cargar los tokens. Inténtalo de nuevo."));
                return;
            }
            setTokens(list);
        } catch {
            if (loadRef.current !== controller) return;
            setLoadError("Error de conexión. Inténtalo de nuevo.");
        } finally {
            if (loadRef.current === controller) {
                loadRef.current = null;
                setLoading(false);
            }
        }
    }, []);

    useEffect(() => {
        // Initial load feeds the row subtitle ("N activos"); the sheet reloads on open.
        // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount for the row subtitle
        void load();
        return () => loadRef.current?.abort();
    }, [load]);

    const openList = () => {
        setView({ kind: "list" });
        void load();
    };

    return (
        <div>
            <button type="button" onClick={openList} className={rowClassName}>
                <KeyRound className="h-[19px] w-[19px] flex-none text-muted-foreground" />
                <span className="flex-1 min-w-0">
                    <span className="block text-[15px] truncate">Tokens de acceso</span>
                    <span className="block text-xs text-muted-foreground truncate" data-testid="access-tokens-summary">
                        {activeTokensLabel(tokens)}
                    </span>
                </span>
                <ChevronRight className="h-[17px] w-[17px] flex-none text-[color:var(--ink-4)]" />
            </button>

            {view?.kind === "list" && (
                <TokenListSheet
                    tokens={tokens}
                    loading={loading}
                    error={loadError}
                    onRetry={load}
                    onClose={() => setView(null)}
                    onCreate={() => setView({ kind: "create" })}
                    onRevoke={(token) => setView({ kind: "revoke", token })}
                />
            )}

            {view?.kind === "create" && (
                <CreateTokenSheet
                    onClose={() => setView({ kind: "list" })}
                    onCreated={(token) => {
                        setView({ kind: "created", token });
                        void load();
                    }}
                />
            )}

            {view?.kind === "created" && <CreatedTokenSheet token={view.token} onDone={() => setView({ kind: "list" })} />}

            {view?.kind === "revoke" && (
                <RevokeTokenSheet
                    token={view.token}
                    onClose={() => setView({ kind: "list" })}
                    onRevoked={() => {
                        setView({ kind: "list" });
                        void load();
                    }}
                />
            )}
        </div>
    );
}

function TokenListSheet({
    tokens,
    loading,
    error,
    onRetry,
    onClose,
    onCreate,
    onRevoke,
}: {
    tokens: AccessTokenItem[] | null;
    loading: boolean;
    error: string | null;
    onRetry: () => void;
    onClose: () => void;
    onCreate: () => void;
    onRevoke: (t: AccessTokenItem) => void;
}) {
    return (
        <Sheet title="Tokens de acceso" onClose={onClose}>
            <div className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">
                    Permiten que un agente de IA o cualquier cliente MCP use tu cuenta. Revoca los que ya no uses.
                </p>
                <EqCta className="h-12 rounded-2xl text-[15px]" onClick={onCreate}>
                    <Plus className="h-4 w-4" />
                    Nuevo token
                </EqCta>
                {error && (
                    <div className="flex flex-col gap-2">
                        <p role="alert" className="text-sm text-destructive">{error}</p>
                        <EqCta variant="outline" className="h-12 rounded-2xl text-[15px]" onClick={onRetry} disabled={loading}>
                            Reintentar
                        </EqCta>
                    </div>
                )}
                {!error && tokens === null && <p className="text-sm text-muted-foreground">Cargando tokens…</p>}
                {!error && tokens?.length === 0 && (
                    <p className="text-sm text-muted-foreground">Aún no has creado ningún token.</p>
                )}
                {tokens && tokens.length > 0 && (
                    <ul
                        aria-label="Tus tokens"
                        className="rounded-2xl border border-[color:var(--line-2)] px-4 [&>*+*]:border-t [&>*+*]:border-[color:var(--line-2)]"
                    >
                        {tokens.map((t) => (
                            <TokenRow key={t.id} token={t} onRevoke={() => onRevoke(t)} />
                        ))}
                    </ul>
                )}
            </div>
        </Sheet>
    );
}

function TokenRow({ token, onRevoke }: { token: AccessTokenItem; onRevoke: () => void }) {
    const active = token.status === "active";
    const expiry = token.expiresAt
        ? `${token.status === "expired" ? "Caducó el" : "Caduca el"} ${fmtDate(token.expiresAt)}`
        : "Sin caducidad";
    return (
        <li className="flex items-start gap-3 py-3" data-testid="access-token-row" data-status={token.status}>
            <div className={cn("flex-1 min-w-0", !active && "opacity-60")}>
                <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[15px] font-semibold truncate">{token.name}</span>
                    {!active && (
                        <span className="flex-none rounded-full bg-[var(--surface-raised-hex)] px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                            {token.status === "revoked" ? "Revocado" : "Caducado"}
                        </span>
                    )}
                </div>
                <code className="block font-mono text-xs text-muted-foreground break-all">{token.prefix}…</code>
                <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    Creado el {fmtDate(token.createdAt)} ·{" "}
                    {token.lastUsedAt ? `Último uso el ${fmtDate(token.lastUsedAt)}` : "Sin usar"}
                </p>
                <p className="text-xs text-muted-foreground">{expiry}</p>
            </div>
            {active && (
                <button
                    type="button"
                    onClick={onRevoke}
                    className="flex-none min-h-[44px] px-1 text-[13px] font-semibold text-destructive"
                    aria-label={`Revocar ${token.name}`}
                >
                    Revocar
                </button>
            )}
        </li>
    );
}

function CreateTokenSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (t: CreatedToken) => void }) {
    const [name, setName] = useState("");
    const [duration, setDuration] = useState<30 | 90 | 365 | null>(90);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const groupName = useId();

    const submit = async () => {
        const trimmed = name.trim();
        if (!trimmed || busy) return;
        setBusy(true);
        setError(null);
        try {
            const res = await fetch("/api/me/tokens", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: trimmed, expiresInDays: duration }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok || typeof data?.token !== "string" || !data.token || !isTokenItem(data)) {
                setError(apiError(res, data, "No se pudo generar el token. Inténtalo de nuevo."));
                setBusy(false);
                return;
            }
            onCreated(data as CreatedToken);
        } catch {
            setError("Error de conexión. Inténtalo de nuevo.");
            setBusy(false);
        }
    };

    return (
        <Sheet title="Nuevo token" onClose={onClose} dismissible={!busy}>
            <div className="flex flex-col gap-4">
                <SheetField
                    label="Nombre"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") void submit();
                    }}
                    placeholder="p. ej. Claude Desktop, portátil"
                    maxLength={MAX_TOKEN_NAME}
                    autoComplete="off"
                />
                <fieldset className="m-0 min-w-0 border-0 p-0 flex flex-col gap-1.5">
                    <legend className="mb-1.5 pl-1 text-xs font-semibold text-muted-foreground">Caducidad</legend>
                    <div className="grid grid-cols-2 gap-2">
                        {TOKEN_DURATIONS.map((d) => {
                            const checked = d.value === duration;
                            return (
                                <label
                                    key={String(d.value)}
                                    className={cn(
                                        "flex h-11 cursor-pointer items-center justify-center rounded-[14px] border px-2 text-center text-sm font-semibold transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary",
                                        checked
                                            ? "border-[color:var(--accent-border)] bg-[var(--accent-tint)] text-primary"
                                            : "border-[color:var(--line)] bg-card text-foreground",
                                    )}
                                >
                                    <input
                                        type="radio"
                                        name={groupName}
                                        className="sr-only"
                                        checked={checked}
                                        onChange={() => setDuration(d.value)}
                                    />
                                    {d.label}
                                </label>
                            );
                        })}
                    </div>
                </fieldset>
                {duration === null && (
                    <div
                        className="flex items-start gap-2 rounded-[14px] bg-[var(--negative-tint)] px-3 py-2.5 text-xs"
                        data-testid="token-no-expiry-warning"
                    >
                        <ShieldAlert className="h-4 w-4 flex-none text-destructive mt-px" />
                        <span>No caducará nunca: revócalo aquí si deja de usarse o se filtra.</span>
                    </div>
                )}
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                <EqCta onClick={submit} disabled={busy || !name.trim()}>
                    {busy ? "Generando…" : "Generar token"}
                </EqCta>
            </div>
        </Sheet>
    );
}

function CreatedTokenSheet({ token, onDone }: { token: CreatedToken; onDone: () => void }) {
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => {
        if (timer.current) clearTimeout(timer.current);
    }, []);

    const url = mcpUrl();
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(token.token);
            setCopied(true);
            setError(null);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 2000);
        } catch {
            setError("No se pudo copiar el token. Selecciónalo y cópialo manualmente.");
        }
    };

    const codeBox = "select-all break-all rounded-[14px] bg-background border border-[color:var(--line-2)] p-3 font-mono leading-relaxed";

    return (
        // A token shown once must not vanish on a stray backdrop tap / Escape.
        <Sheet title="Guarda tu token ahora" onClose={onDone} dismissible={false}>
            <div className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">
                    <strong className="text-foreground">{token.name}</strong>. Solo se muestra una vez.{" "}
                    {token.expiresAt ? `Caduca el ${fmtLongDate(token.expiresAt)}.` : "No caduca."}
                </p>
                <code className={cn(codeBox, "block text-xs")} data-testid="access-token-value">{token.token}</code>
                <EqCta variant="outline" className="h-12 rounded-2xl text-[15px]" onClick={copy}>
                    {copied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
                    {copied ? "Token copiado" : "Copiar token"}
                </EqCta>
                {error && <p role="alert" className="text-xs text-destructive">{error}</p>}

                <div className="flex flex-col gap-1.5">
                    <EqLabel className="pl-1">Configura tu cliente MCP</EqLabel>
                    <dl className="flex flex-col gap-1.5 text-xs">
                        <div className="flex flex-col gap-0.5">
                            <dt className="pl-1 text-muted-foreground">URL</dt>
                            <dd className={cn(codeBox, "m-0 py-2 text-[11px]")}>{url}</dd>
                        </div>
                        <div className="flex flex-col gap-0.5">
                            <dt className="pl-1 text-muted-foreground">Cabecera</dt>
                            <dd className={cn(codeBox, "m-0 py-2 text-[11px]")}>Authorization: Bearer {token.token}</dd>
                        </div>
                    </dl>
                    <span className="pl-1 pt-1 text-xs text-muted-foreground">O en JSON, si tu cliente usa «mcpServers»:</span>
                    <pre className={cn(codeBox, "m-0 whitespace-pre-wrap text-[11px]")} data-testid="access-token-config">
                        {mcpClientConfig(url, token.token)}
                    </pre>
                </div>

                <div className="flex items-start gap-2 rounded-[14px] bg-[var(--negative-tint)] px-3 py-2.5 text-xs">
                    <ShieldAlert className="h-4 w-4 flex-none text-destructive mt-px" />
                    <span>Trátalo como una contraseña. Puedes revocarlo en cualquier momento desde esta pantalla.</span>
                </div>
                <EqCta className="mt-1" onClick={onDone}>
                    He guardado el token
                </EqCta>
            </div>
        </Sheet>
    );
}

function RevokeTokenSheet({
    token,
    onClose,
    onRevoked,
}: {
    token: AccessTokenItem;
    onClose: () => void;
    onRevoked: () => void;
}) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const revoke = async () => {
        setBusy(true);
        setError(null);
        try {
            const res = await fetch(`/api/me/tokens/${encodeURIComponent(token.id)}`, { method: "DELETE" });
            if (res.ok) {
                onRevoked();
                return;
            }
            const data = await res.json().catch(() => null);
            setError(apiError(res, data, "No se pudo revocar el token. Inténtalo de nuevo."));
        } catch {
            setError("Error de conexión. Inténtalo de nuevo.");
        }
        setBusy(false);
    };

    return (
        <Sheet title={`¿Revocar «${token.name}»?`} onClose={onClose} dismissible={!busy}>
            <div className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">
                    Los agentes que lo usen perderán el acceso de inmediato. No se puede deshacer: para volver a conectarlos
                    tendrás que crear un token nuevo.
                </p>
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                <div className="flex gap-2.5 pt-1">
                    <EqCta variant="outline" className="flex-1 h-12 rounded-2xl text-[15px]" onClick={onClose} disabled={busy}>
                        Cancelar
                    </EqCta>
                    <EqCta className="flex-1 h-12 rounded-2xl text-[15px] bg-destructive" onClick={revoke} disabled={busy}>
                        {busy ? "Revocando…" : "Revocar"}
                    </EqCta>
                </div>
            </div>
        </Sheet>
    );
}
