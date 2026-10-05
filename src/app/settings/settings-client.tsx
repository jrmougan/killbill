"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
    Bot,
    Check,
    ChevronRight,
    Copy,
    Download,
    FileUp,
    LayoutGrid,
    Layers,
    LogIn,
    PieChart,
    Plus,
    ShieldAlert,
    ShieldCheck,
    Tag,
} from "lucide-react";
import { EqCta, EqHeader, EqLabel, useEqToast, EqToast } from "@/components/ui/eq";
import { LogoutButton } from "@/components/auth/logout-button";
import { AvatarPicker } from "@/components/ui/avatar-picker";
import { Sheet, SheetField } from "@/components/shopping/sheet";
import { spaceTypeMeta, spaceStatusMeta } from "@/lib/space-ui";
import { cn } from "@/lib/utils";

interface UserData {
    id: string;
    name: string;
    email: string;
    avatar: string;
    isAdmin: boolean;
}

interface GroupData {
    id: string;
    name: string;
    code: string;
    memberCount: number;
    isActive: boolean;
    type: string;
    status: string;
}

interface SettingsClientProps {
    user: UserData;
    groups: GroupData[];
    activeGroupId: string | null;
}

type McpToken = { value: string; expiresAt: string; expiresInDays: number };

const isImageAvatar = (a: string) => a.startsWith("/uploads/") || a.startsWith("http");

function Avatar({ value, name, size }: { value: string; name: string; size: number }) {
    return (
        <span
            className="flex-none rounded-full bg-[var(--surface-raised-hex)] flex items-center justify-center overflow-hidden font-bold"
            style={{ width: size, height: size, fontSize: size * 0.4 }}
            aria-hidden
        >
            {isImageAvatar(value) ? (
                // oxlint-disable-next-line nextjs/no-img-element
                <img src={value} alt="" className="h-full w-full object-cover" />
            ) : value && value !== "👤" ? (
                value
            ) : (
                name.trim().charAt(0).toUpperCase() || "?"
            )}
        </span>
    );
}

/** Section: small muted label + white rounded card holding hairline-divided rows. */
function Section({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <section className="flex flex-col gap-1.5" aria-label={label}>
            <EqLabel className="pl-1">{label}</EqLabel>
            <div className="bg-card rounded-2xl border border-[color:var(--line-2)] px-4 [&>*+*]:border-t [&>*+*]:border-[color:var(--line-2)]">
                {children}
            </div>
        </section>
    );
}

const rowCls = "w-full flex items-center gap-3 py-3.5 text-left";

/** Navigation row: icon, label (+ optional sub) and a faint chevron. */
function LinkRow({
    href,
    icon: Icon,
    label,
    sub,
    download,
}: {
    href: string;
    icon: typeof Tag;
    label: string;
    sub?: string;
    download?: boolean;
}) {
    const inner = (
        <>
            <Icon className="h-[19px] w-[19px] flex-none text-muted-foreground" />
            <span className="flex-1 min-w-0">
                <span className="block text-[15px] truncate">{label}</span>
                {sub && <span className="block text-xs text-muted-foreground truncate">{sub}</span>}
            </span>
            <ChevronRight className="h-[17px] w-[17px] flex-none text-[color:var(--ink-4)]" />
        </>
    );
    // A file download must bypass the client router.
    return download ? (
        <a href={href} download className={rowCls}>{inner}</a>
    ) : (
        <Link href={href} className={rowCls}>{inner}</Link>
    );
}

export function SettingsClient({ user, groups }: SettingsClientProps) {
    const router = useRouter();
    const [toast, showToast] = useEqToast();
    const [sheet, setSheet] = useState<"profile" | "join" | "mcp" | null>(null);
    const [leavingId, setLeavingId] = useState<string | null>(null);

    // MCP token (shown once). Generating again just issues another 90-day token:
    // tokens cannot be revoked yet, so there is no "Desconectar".
    const [mcpToken, setMcpToken] = useState<McpToken | null>(null);
    const [mcpBusy, setMcpBusy] = useState(false);
    const [mcpError, setMcpError] = useState<string | null>(null);
    const [mcpCopied, setMcpCopied] = useState(false);
    const [mcpIssued, setMcpIssued] = useState(false);
    const mcpRequestRef = useRef<AbortController | null>(null);
    useEffect(() => () => mcpRequestRef.current?.abort(), []);

    const closeMcp = () => {
        mcpRequestRef.current?.abort();
        mcpRequestRef.current = null;
        setSheet(null);
        setMcpToken(null);
        setMcpError(null);
        setMcpCopied(false);
        setMcpBusy(false);
    };

    const connectMcp = async () => {
        const controller = new AbortController();
        mcpRequestRef.current = controller;
        setSheet("mcp");
        setMcpToken(null);
        setMcpBusy(true);
        setMcpError(null);
        try {
            const res = await fetch("/api/me/mcp-token", { method: "POST", signal: controller.signal });
            const data = await res.json().catch(() => null);
            if (mcpRequestRef.current !== controller) return;
            const valid =
                res.ok &&
                typeof data?.token === "string" &&
                data.token &&
                typeof data?.expiresAt === "string" &&
                !Number.isNaN(new Date(data.expiresAt).getTime()) &&
                Number.isInteger(data?.expiresInDays) &&
                data.expiresInDays > 0;
            if (!valid) {
                setMcpError(data?.error || "No se pudo generar el token. Inténtalo de nuevo.");
                return;
            }
            setMcpToken({ value: data.token, expiresAt: data.expiresAt, expiresInDays: data.expiresInDays });
            setMcpIssued(true);
        } catch {
            if (mcpRequestRef.current !== controller) return;
            setMcpError("Error de conexión. Inténtalo de nuevo.");
        } finally {
            if (mcpRequestRef.current === controller) {
                mcpRequestRef.current = null;
                setMcpBusy(false);
            }
        }
    };

    const copyMcpToken = async () => {
        if (!mcpToken) return;
        try {
            await navigator.clipboard.writeText(mcpToken.value);
            setMcpCopied(true);
            setTimeout(() => setMcpCopied(false), 2000);
        } catch {
            setMcpError("No se pudo copiar el token. Selecciónalo y cópialo manualmente.");
        }
    };

    const mcpConfig = mcpToken
        ? `mcp_servers:\n  killbill:\n    url: "${typeof window === "undefined" ? "/api/mcp" : `${window.location.origin}/api/mcp`}"\n    headers:\n      Authorization: "Bearer ${mcpToken.value}"`
        : "";

    const handleLeave = async (groupId: string, groupName: string) => {
        if (!confirm(`¿Salir de "${groupName}"? Perderás acceso a sus gastos y desgloses. Esta acción no se puede deshacer.`)) return;
        setLeavingId(groupId);
        try {
            const res = await fetch("/api/couple/unlink", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ groupId }),
            });
            if (res.ok) {
                showToast(`Has salido de ${groupName}`);
                router.refresh();
            } else {
                showToast("No se pudo salir del espacio");
            }
        } catch {
            showToast("Error de conexión");
        } finally {
            setLeavingId(null);
        }
    };

    return (
        <div className="flex flex-col min-h-screen pt-[max(12px,env(safe-area-inset-top))] pb-10">
            <EqHeader title="Ajustes" back="/dashboard" />

            <div className="flex flex-col gap-5 px-5 pt-5">
                {/* Profile */}
                <div className="flex items-center gap-3.5">
                    <Avatar value={user.avatar} name={user.name} size={56} />
                    <div className="flex-1 min-w-0">
                        <p className="text-[17px] font-semibold truncate">{user.name}</p>
                        {user.email && <p className="text-[13px] text-muted-foreground truncate">{user.email}</p>}
                    </div>
                    <button
                        type="button"
                        onClick={() => setSheet("profile")}
                        className="text-sm font-semibold text-primary px-1 py-2"
                        aria-label="Editar perfil"
                    >
                        Editar
                    </button>
                </div>

                <Section label="Organizar">
                    <LinkRow href="/categories" icon={LayoutGrid} label="Categorías" />
                    <LinkRow href="/tags" icon={Tag} label="Etiquetas" />
                    <LinkRow href="/expenses/import" icon={FileUp} label="Importar movimientos" />
                    {groups.length > 0 && <LinkRow href="/budget" icon={PieChart} label="Presupuestos" />}
                    {groups.length > 0 && <LinkRow href="/api/export" icon={Download} label="Exportar gastos (CSV)" download />}
                </Section>

                <Section label="Espacios">
                    <LinkRow href="/spaces" icon={Layers} label="Mis espacios" />
                    {groups.map((g) => {
                        const t = spaceTypeMeta(g.type);
                        const st = spaceStatusMeta(g.status);
                        const sub = [
                            t.label,
                            `${g.memberCount} ${g.memberCount === 1 ? "miembro" : "miembros"}`,
                            g.isActive ? "en uso" : null,
                            st.tone !== "active" ? st.label.toLowerCase() : null,
                        ]
                            .filter(Boolean)
                            .join(" · ");
                        return (
                            <div key={g.id} className="flex items-center gap-3">
                                <Link href={`/spaces/${g.id}`} className={cn(rowCls, "flex-1 min-w-0")} aria-label={`Gestionar ${g.name}`}>
                                    <span className="h-[19px] w-[19px] flex-none flex items-center justify-center text-base" aria-hidden>
                                        {t.emoji}
                                    </span>
                                    <span className="flex-1 min-w-0">
                                        <span className="block text-[15px] truncate">{g.name}</span>
                                        <span className="block text-xs text-muted-foreground truncate">{sub}</span>
                                    </span>
                                </Link>
                                <button
                                    type="button"
                                    onClick={() => handleLeave(g.id, g.name)}
                                    disabled={leavingId === g.id}
                                    className="flex-none text-[13px] font-semibold text-destructive py-2 disabled:opacity-50"
                                    aria-label={`Salir de ${g.name}`}
                                >
                                    Salir
                                </button>
                            </div>
                        );
                    })}
                    <LinkRow href="/spaces/new" icon={Plus} label="Nuevo espacio" />
                    <button type="button" onClick={() => setSheet("join")} className={rowCls}>
                        <LogIn className="h-[19px] w-[19px] flex-none text-muted-foreground" />
                        <span className="flex-1 text-[15px]">Unirme con un enlace</span>
                        <ChevronRight className="h-[17px] w-[17px] flex-none text-[color:var(--ink-4)]" />
                    </button>
                </Section>

                <Section label="Conexiones">
                    <div className={rowCls}>
                        <Bot className="h-[19px] w-[19px] flex-none text-muted-foreground" />
                        <span className="flex-1 min-w-0">
                            <span className="block text-[15px]">Hermes Agent</span>
                            <span className="block text-xs text-muted-foreground">
                                {mcpIssued ? "Acceso MCP · token generado" : "Acceso MCP"}
                            </span>
                        </span>
                        <button
                            type="button"
                            onClick={connectMcp}
                            disabled={mcpBusy}
                            className="flex-none text-sm font-semibold text-primary py-2 disabled:opacity-50"
                        >
                            {mcpIssued ? "Nuevo token" : "Conectar"}
                        </button>
                    </div>
                </Section>

                <Section label="Cuenta">
                    {user.isAdmin && <LinkRow href="/admin" icon={ShieldCheck} label="Administración" />}
                    <LogoutButton className={cn(rowCls, "text-destructive")} />
                </Section>

                <p className="pt-2 text-center text-[11px] text-[color:var(--ink-3)]">EQUIL · v1.0.0 beta</p>
            </div>

            {sheet === "profile" && (
                <ProfileSheet
                    user={user}
                    onClose={() => setSheet(null)}
                    onSaved={() => {
                        setSheet(null);
                        showToast("Perfil actualizado");
                        router.refresh();
                    }}
                />
            )}

            {sheet === "join" && <JoinSheet onClose={() => setSheet(null)} />}

            {sheet === "mcp" && (
                <Sheet title={mcpToken ? "Guarda tu token ahora" : "Conectar Hermes Agent"} onClose={closeMcp}>
                    {mcpToken ? (
                        <div className="flex flex-col gap-3">
                            <p className="text-sm text-muted-foreground">
                                Solo se muestra una vez. Caduca en {mcpToken.expiresInDays} días, el{" "}
                                {new Date(mcpToken.expiresAt).toLocaleDateString("es-ES", { dateStyle: "long", timeZone: "Europe/Madrid" })}.
                            </p>
                            <div className="rounded-[14px] bg-background border border-[color:var(--line-2)] p-3">
                                <code className="block select-all break-all font-mono text-xs leading-relaxed">{mcpToken.value}</code>
                            </div>
                            <EqCta variant="outline" className="h-12 rounded-2xl text-[15px]" onClick={copyMcpToken}>
                                {mcpCopied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
                                {mcpCopied ? "Token copiado" : "Copiar token"}
                            </EqCta>
                            {mcpError && <p className="text-xs text-destructive">{mcpError}</p>}
                            <div className="flex flex-col gap-1.5">
                                <EqLabel className="pl-1">Añádelo a ~/.hermes/config.yaml</EqLabel>
                                <pre className="select-all whitespace-pre-wrap break-all rounded-[14px] bg-background border border-[color:var(--line-2)] p-3 font-mono text-[11px] leading-relaxed">
                                    {mcpConfig}
                                </pre>
                            </div>
                            <div className="flex items-start gap-2 rounded-[14px] bg-[var(--negative-tint)] px-3 py-2.5 text-xs">
                                <ShieldAlert className="h-4 w-4 flex-none text-destructive mt-px" />
                                <span>
                                    Trátalo como una contraseña: da acceso a tu cuenta hasta que caduque. Aún no se puede revocar; genera
                                    un token nuevo cuando lo necesites.
                                </span>
                            </div>
                            <EqCta className="mt-1" onClick={closeMcp}>
                                He terminado
                            </EqCta>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-3">
                            <p className="text-sm text-muted-foreground">
                                {mcpBusy ? "Generando token…" : "No se pudo generar el token."}
                            </p>
                            {mcpError && <p className="text-xs text-destructive">{mcpError}</p>}
                            {!mcpBusy && <EqCta onClick={connectMcp}>Reintentar</EqCta>}
                        </div>
                    )}
                </Sheet>
            )}

            {toast && <EqToast>{toast}</EqToast>}
        </div>
    );
}

function ProfileSheet({ user, onClose, onSaved }: { user: UserData; onClose: () => void; onSaved: () => void }) {
    const [name, setName] = useState(user.name);
    const [avatar, setAvatar] = useState(user.avatar);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const save = async () => {
        setSaving(true);
        setError(null);
        try {
            const res = await fetch("/api/user/profile", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, avatar }),
            });
            if (res.ok) {
                onSaved();
                return;
            }
            const data = await res.json().catch(() => ({}));
            setError(data.error || "Error al actualizar");
        } catch {
            setError("Error de conexión");
        }
        setSaving(false);
    };

    return (
        <Sheet title="Editar perfil" onClose={onClose}>
            <div className="flex flex-col gap-4">
                <fieldset className="border-0 p-0 m-0 min-w-0">
                    <legend className="sr-only">Tu avatar</legend>
                    <AvatarPicker currentAvatar={avatar} onAvatarChange={setAvatar} />
                </fieldset>
                <SheetField label="Tu nombre" value={name} onChange={(e) => setName(e.target.value)} placeholder="Tu nombre" />
                {user.email && <SheetField label="Email" value={user.email} disabled readOnly />}
                {error && <p className="text-sm text-destructive">{error}</p>}
                <EqCta onClick={save} disabled={saving || !name.trim() || (name === user.name && avatar === user.avatar)}>
                    Guardar
                </EqCta>
            </div>
        </Sheet>
    );
}

/**
 * Join via an invite link: routes to the public consent screen `/i/[token]`
 * (never a silent join). Accepts a pasted `/i/…` link or a raw token/code.
 */
function JoinSheet({ onClose }: { onClose: () => void }) {
    const router = useRouter();
    const [value, setValue] = useState("");
    const go = () => {
        const raw = value.trim();
        if (!raw) return;
        const match = raw.match(/\/i\/([^/?#\s]+)/);
        const token = match ? decodeURIComponent(match[1]) : raw;
        router.push(`/i/${encodeURIComponent(token)}`);
    };
    return (
        <Sheet title="Unirme a un espacio" onClose={onClose}>
            <div className="flex flex-col gap-3">
                <SheetField
                    label="Enlace de invitación"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") go();
                    }}
                    placeholder="https://…/i/…"
                    // oxlint-disable-next-line jsx-a11y/no-autofocus -- the sheet was just opened to paste this link
                    autoFocus
                />
                <p className="pl-1 text-xs text-muted-foreground">Verás el espacio y confirmarás antes de unirte.</p>
                <EqCta onClick={go} disabled={!value.trim()}>
                    Continuar
                </EqCta>
            </div>
        </Sheet>
    );
}
