"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GlassCard } from "@/components/ui/glass-card";
import {
    ArrowLeft,
    User,
    Heart,
    Save,
    Copy,
    Check,
    ShieldAlert,
    PieChart,
    Tag,
    Shapes,
    ShoppingCart,
    Download,
    Plus,
    LogIn,
    LogOut,
    KeyRound,
    X,
} from "lucide-react";
import Link from "next/link";
import { LogoutButton } from "@/components/auth/logout-button";
import { AvatarPicker } from "@/components/ui/avatar-picker";
import { setActiveGroup } from "@/app/actions/group";
import { spaceTypeMeta, spaceStatusMeta } from "@/lib/space-ui";

interface UserData {
    id: string;
    name: string;
    email: string;
    avatar: string;
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

type McpToken = {
    value: string;
    expiresAt: string;
    expiresInDays: number;
};

export function SettingsClient({ user, groups }: SettingsClientProps) {
    const router = useRouter();
    const [name, setName] = useState(user.name);
    const [avatar, setAvatar] = useState(user.avatar);
    const [isSaving, setIsSaving] = useState(false);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [leavingId, setLeavingId] = useState<string | null>(null);
    const [message, setMessage] = useState<{ text: string, type: 'success' | 'error' } | null>(null);

    // Create-group form
    const [newName, setNewName] = useState("");
    const [creating, setCreating] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);

    // Join-group form — routes to the consent screen (no silent join).
    const [joinCode, setJoinCode] = useState("");
    const [mcpModalOpen, setMcpModalOpen] = useState(false);
    const [mcpToken, setMcpToken] = useState<McpToken | null>(null);
    const [generatingMcpToken, setGeneratingMcpToken] = useState(false);
    const [mcpError, setMcpError] = useState<string | null>(null);
    const [mcpCopied, setMcpCopied] = useState(false);
    const mcpRequestRef = useRef<AbortController | null>(null);

    const closeMcpModal = () => {
        mcpRequestRef.current?.abort();
        mcpRequestRef.current = null;
        setMcpModalOpen(false);
        setMcpToken(null);
        setMcpError(null);
        setMcpCopied(false);
        setGeneratingMcpToken(false);
    };

    useEffect(() => () => mcpRequestRef.current?.abort(), []);

    const handleSaveProfile = async () => {
        setIsSaving(true);
        setMessage(null);
        try {
            const res = await fetch("/api/user/profile", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, avatar }),
            });
            if (res.ok) {
                setMessage({ text: "Perfil actualizado correctamente", type: 'success' });
                router.refresh();
            } else {
                const data = await res.json();
                setMessage({ text: data.error || "Error al actualizar", type: 'error' });
            }
        } catch (_err) {
            setMessage({ text: "Error de conexión", type: 'error' });
        } finally {
            setIsSaving(false);
        }
    };

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
                router.refresh();
            } else {
                alert("Error al salir del grupo");
            }
        } catch (_err) {
            alert("Error de conexión");
        } finally {
            setLeavingId(null);
        }
    };

    const handleCreate = async () => {
        setCreating(true);
        setCreateError(null);
        try {
            const res = await fetch("/api/couple", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: newName || undefined }),
            });
            const data = await res.json();
            if (res.ok) {
                await setActiveGroup(data.couple.id);
                setNewName("");
                router.refresh();
            } else {
                setCreateError(data.error || "Error al crear el grupo");
            }
        } catch (_err) {
            setCreateError("Error de conexión");
        } finally {
            setCreating(false);
        }
    };

    // Route to the public consent screen `/i/[token]` instead of joining
    // silently: the user confirms the join there and sees any error (expired,
    // revoked, exhausted, SPACE_FULL, archived). Accepts a pasted `/i/…` link or
    // a raw code/token (the consent page falls back to the classic Couple.code).
    const handleJoin = () => {
        const raw = joinCode.trim();
        if (!raw) return;
        const match = raw.match(/\/i\/([^/?#\s]+)/);
        const token = match ? decodeURIComponent(match[1]) : raw;
        router.push(`/i/${encodeURIComponent(token)}`);
    };

    const copyCode = (code: string, id: string) => {
        navigator.clipboard.writeText(code);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    const generateMcpToken = async () => {
        const controller = new AbortController();
        mcpRequestRef.current = controller;
        setGeneratingMcpToken(true);
        setMcpError(null);
        try {
            const res = await fetch("/api/me/mcp-token", { method: "POST", signal: controller.signal });
            const data = await res.json().catch(() => null);
            if (mcpRequestRef.current !== controller) return;
            if (!res.ok || typeof data?.token !== "string" || !data.token || typeof data?.expiresAt !== "string" || Number.isNaN(new Date(data.expiresAt).getTime()) || !Number.isInteger(data?.expiresInDays) || data.expiresInDays <= 0) {
                setMcpError(data?.error || "No se pudo generar el token. Inténtalo de nuevo.");
                return;
            }
            setMcpToken({ value: data.token, expiresAt: data.expiresAt, expiresInDays: data.expiresInDays });
        } catch {
            if (mcpRequestRef.current !== controller) return;
            setMcpError("Error de conexión. Inténtalo de nuevo.");
        } finally {
            if (mcpRequestRef.current === controller) {
                mcpRequestRef.current = null;
                setGeneratingMcpToken(false);
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

    return (
        <div className="flex flex-col min-h-screen p-4 space-y-6 max-w-md mx-auto relative pb-24">
            <header className="flex items-center gap-4 pt-2">
                <Link href="/dashboard">
                    <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-secondary">
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                </Link>
                <h1 className="text-xl font-bold text-foreground">Ajustes</h1>
            </header>

            <div className="space-y-8 flex-1">
                {/* Profile Section */}
                <section className="space-y-4">
                    <div className="flex items-center gap-2 px-1">
                        <User className="h-5 w-5 text-primary" />
                        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Mi Perfil</h2>
                    </div>

                    <GlassCard className="p-4 space-y-4">
                        <fieldset className="space-y-3 border-0 p-0 m-0 min-w-0">
                            <legend className="text-xs font-medium text-muted-foreground ml-1 mb-2 block text-center w-full p-0">Tu Avatar</legend>

                            <AvatarPicker currentAvatar={avatar} onAvatarChange={setAvatar} />
                        </fieldset>

                        <div className="space-y-2">
                            <label htmlFor="settings-name" className="text-xs font-medium text-muted-foreground ml-1">Tu nombre</label>
                            <Input
                                id="settings-name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="Tu nombre"
                            />
                        </div>
                        <div className="space-y-2">
                            <label htmlFor="settings-email" className="text-xs font-medium text-muted-foreground ml-1">Email</label>
                            <Input
                                id="settings-email"
                                value={user.email}
                                disabled
                                className="bg-secondary opacity-60"
                            />
                        </div>

                        {message && (
                            <p className={`text-xs text-center font-medium ${message.type === 'success' ? 'text-[color:var(--positive)]' : 'text-destructive'}`}>
                                {message.text}
                            </p>
                        )}

                        <Button
                            className="w-full gap-2"
                            onClick={handleSaveProfile}
                            disabled={isSaving || (name === user.name && avatar === user.avatar)}
                            isLoading={isSaving}
                        >
                            <Save className="h-4 w-4" /> Guardar Cambios
                        </Button>
                    </GlassCard>
                </section>

                {/* Groups Section (multi-group) */}
                <section className="space-y-4">
                    <div className="flex items-center gap-2 px-1">
                        <Heart className="h-5 w-5 text-primary" />
                        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Mis grupos</h2>
                    </div>

                    {groups.length === 0 && (
                        <p className="text-xs text-muted-foreground px-1">Todavía no perteneces a ningún grupo. Crea uno o únete con un código.</p>
                    )}

                    {groups.map((g) => {
                        const tMeta = spaceTypeMeta(g.type);
                        const sMeta = spaceStatusMeta(g.status);
                        return (
                        <GlassCard key={g.id} className="rounded-[16px] bg-card border border-[color:var(--line)] p-4 space-y-3">
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2.5 min-w-0">
                                    <span className="w-9 h-9 rounded-[11px] bg-secondary flex items-center justify-center text-[18px] shrink-0">
                                        {tMeta.emoji}
                                    </span>
                                    <div className="space-y-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <p className="text-sm font-bold text-foreground truncate">{g.name}</p>
                                            {g.isActive && (
                                                <span className="text-[11px] font-bold px-2 py-[3px] rounded-lg bg-[var(--accent-tint)] text-primary shrink-0">Activo</span>
                                            )}
                                            {sMeta.tone !== "active" && (
                                                <span className="text-[11px] font-semibold px-2 py-[3px] rounded-lg bg-secondary text-muted-foreground shrink-0">{sMeta.label}</span>
                                            )}
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            {tMeta.label} · {g.memberCount} {g.memberCount === 1 ? "miembro" : "miembros"}
                                        </p>
                                    </div>
                                </div>
                                <Link href={`/spaces/${g.id}`} className="shrink-0 text-[12px] font-semibold text-primary hover:underline">
                                    Gestionar →
                                </Link>
                            </div>

                            <div className="p-3 bg-secondary rounded-xl border border-[color:var(--line)] flex items-center justify-between">
                                <div className="space-y-1">
                                    <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">Código de invitación</p>
                                    <code className="text-lg font-mono font-bold tracking-tighter text-foreground">{g.code}</code>
                                </div>
                                <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => copyCode(g.code, g.id)}
                                    className="h-10 w-10"
                                    aria-label="Copiar código de invitación"
                                >
                                    {copiedId === g.id ? <Check className="h-4 w-4 text-[color:var(--positive)]" /> : <Copy className="h-4 w-4" />}
                                </Button>
                            </div>

                            <Button
                                variant="ghost"
                                className="w-full justify-center h-11 bg-[var(--negative-tint)] text-destructive hover:opacity-90 border border-[color:var(--line)]"
                                onClick={() => handleLeave(g.id, g.name)}
                                isLoading={leavingId === g.id}
                            >
                                <LogOut className="h-4 w-4 mr-2" /> Salir
                            </Button>
                        </GlassCard>
                        );
                    })}

                    {/* Typed space creation (Fase 1): the type is chosen in /spaces/new. */}
                    <Link
                        href="/spaces/new"
                        className="flex items-center gap-3 w-full h-14 px-4 bg-[var(--accent-tint)] border border-[color:var(--accent-border)] rounded-xl hover:opacity-90 transition-opacity"
                    >
                        <Plus className="h-5 w-5 text-primary" />
                        <span className="font-semibold text-sm text-foreground">Nuevo espacio (pareja, grupo o viaje)</span>
                    </Link>

                    {/* Create group — quick untyped group, kept for convenience */}
                    <GlassCard className="rounded-[16px] bg-card border border-[color:var(--line)] p-4 space-y-3">
                        <div className="flex items-center gap-2">
                            <Plus className="h-4 w-4 text-primary" />
                            <h3 className="text-[13px] font-bold text-foreground">Crear grupo</h3>
                        </div>
                        <Input
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            placeholder="Nombre del grupo (opcional)"
                            className="h-[50px] rounded-xl bg-card border border-[color:var(--line)] text-foreground px-[15px] focus:border-[color:var(--accent-border)]"
                        />
                        {createError && <p className="text-destructive text-xs">{createError}</p>}
                        <Button
                            className="w-full h-[52px] rounded-[13px] bg-primary text-white font-semibold"
                            onClick={handleCreate}
                            isLoading={creating}
                        >
                            <Plus className="h-4 w-4 mr-2" /> Crear grupo
                        </Button>
                    </GlassCard>

                    {/* Join group — always available */}
                    <GlassCard className="rounded-[16px] bg-card border border-[color:var(--line)] p-4 space-y-3">
                        <div className="flex items-center gap-2">
                            <LogIn className="h-4 w-4 text-primary" />
                            <h3 className="text-[13px] font-bold text-foreground">Unirse con enlace o código</h3>
                        </div>
                        <Input
                            value={joinCode}
                            onChange={(e) => setJoinCode(e.target.value)}
                            placeholder="Enlace o código de invitación"
                            className="h-[50px] rounded-xl bg-card border border-[color:var(--line)] text-foreground px-[15px] font-mono tracking-tighter focus:border-[color:var(--accent-border)]"
                        />
                        <Button
                            className="w-full h-[52px] rounded-[13px] bg-primary text-white font-semibold"
                            onClick={handleJoin}
                            disabled={!joinCode.trim()}
                        >
                            <LogIn className="h-4 w-4 mr-2" /> Continuar
                        </Button>
                    </GlassCard>
                </section>

                {/* Tools Section */}
                {groups.length > 0 && (
                    <section className="space-y-4">
                        <div className="flex items-center gap-2 px-1">
                            <PieChart className="h-5 w-5 text-primary" />
                            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Herramientas</h2>
                        </div>

                        <div className="space-y-3">
                            <Link href="/budget" className="flex items-center gap-3 w-full h-14 px-4 bg-card border border-[color:var(--line)] rounded-xl hover:bg-secondary transition-colors">
                                <PieChart className="h-5 w-5 text-muted-foreground" />
                                <span className="font-medium text-sm text-foreground">Presupuestos</span>
                            </Link>
                            <Link href="/tags" className="flex items-center gap-3 w-full h-14 px-4 bg-card border border-[color:var(--line)] rounded-xl hover:bg-secondary transition-colors">
                                <Tag className="h-5 w-5 text-muted-foreground" />
                                <span className="font-medium text-sm text-foreground">Etiquetas</span>
                            </Link>
                            <Link href="/categories" className="flex items-center gap-3 w-full h-14 px-4 bg-card border border-[color:var(--line)] rounded-xl hover:bg-secondary transition-colors">
                                <Shapes className="h-5 w-5 text-muted-foreground" />
                                <span className="font-medium text-sm text-foreground">Categorías</span>
                            </Link>
                            <Link href="/lists" className="flex items-center gap-3 w-full h-14 px-4 bg-card border border-[color:var(--line)] rounded-xl hover:bg-secondary transition-colors">
                                <ShoppingCart className="h-5 w-5 text-muted-foreground" />
                                <span className="font-medium text-sm text-foreground">Listas de la compra</span>
                            </Link>
                            <a href="/api/export" download className="flex items-center gap-3 w-full h-14 px-4 bg-card border border-[color:var(--line)] rounded-xl hover:bg-secondary transition-colors">
                                <Download className="h-5 w-5 text-muted-foreground" />
                                <span className="font-medium text-sm text-foreground">Exportar gastos (CSV)</span>
                            </a>
                        </div>
                    </section>
                )}

                {/* MCP access is personal and available whether or not the user has a group. */}
                <section className="space-y-4">
                    <div className="flex items-center gap-2 px-1">
                        <KeyRound className="h-5 w-5 text-primary" />
                        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Acceso MCP</h2>
                    </div>

                    <GlassCard className="p-4 space-y-3">
                        <div className="flex items-start gap-3">
                            <div className="h-9 w-9 rounded-xl bg-[var(--accent-tint)] flex items-center justify-center shrink-0">
                                <KeyRound className="h-4 w-4 text-primary" />
                            </div>
                            <div className="space-y-1 min-w-0">
                                <h3 className="text-sm font-bold text-foreground">Conecta Hermes Agent</h3>
                                <p className="text-xs leading-relaxed text-muted-foreground">
                                    Genera un token para que Hermes Agent pueda acceder a tu cuenta durante el periodo configurado.
                                </p>
                            </div>
                        </div>
                        <div className="flex items-start gap-2 rounded-xl bg-[var(--negative-tint)] border border-[color:var(--line)] px-3 py-2.5 text-xs text-foreground">
                            <ShieldAlert className="h-4 w-4 text-destructive shrink-0 mt-px" />
                            <span>Trátalo como una contraseña: quien tenga este token podrá acceder a tu cuenta.</span>
                        </div>
                        <Button className="w-full gap-2" onClick={() => setMcpModalOpen(true)}>
                            <KeyRound className="h-4 w-4" /> Generar token MCP
                        </Button>
                    </GlassCard>
                </section>

                {/* Account Section */}
                <section className="space-y-4">
                    <div className="flex items-center gap-2 px-1">
                        <ShieldAlert className="h-5 w-5 text-destructive" />
                        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Cuenta</h2>
                    </div>

                    <div className="space-y-3">
                        <LogoutButton className="w-full justify-start h-14 bg-card border border-[color:var(--line)] hover:bg-secondary" />
                    </div>
                </section>
            </div>

            <footer className="text-center space-y-1 py-4">
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">EQUIL App v1.0.0 Beta</p>
                <p className="text-[10px] text-[color:var(--ink-3)]">Hecho con ❤️ para compartir gastos</p>
            </footer>

            {mcpModalOpen && (
                <div className="fixed inset-0 bg-[color:var(--ink)]/40 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-6 animate-in fade-in duration-200">
                    <div className="bg-card border border-[color:var(--line)] rounded-t-2xl sm:rounded-2xl p-5 max-w-md w-full max-h-[90vh] overflow-y-auto space-y-4 animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200">
                        <div className="flex justify-end -mb-2">
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={closeMcpModal} aria-label="Cerrar">
                                <X className="h-4 w-4" />
                            </Button>
                        </div>

                        {mcpToken ? (
                            <>
                                <div className="space-y-1">
                                    <h2 className="text-base font-bold text-foreground">Guarda tu token ahora</h2>
                                    <p className="text-sm text-muted-foreground">Solo se muestra una vez. Caduca en {mcpToken.expiresInDays} días, el {new Date(mcpToken.expiresAt).toLocaleDateString("es-ES", { dateStyle: "long" })}.</p>
                                </div>
                                <div className="rounded-xl bg-secondary border border-[color:var(--line)] p-3 space-y-2">
                                    <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">Token MCP</p>
                                    <code className="block select-all break-all text-xs font-mono text-foreground">{mcpToken.value}</code>
                                </div>
                                <Button variant="secondary" className="w-full gap-2" onClick={copyMcpToken}>
                                    {mcpCopied ? <Check className="h-4 w-4 text-[color:var(--positive)]" /> : <Copy className="h-4 w-4" />}
                                    {mcpCopied ? "Token copiado" : "Copiar token"}
                                </Button>
                                {mcpError && <p className="text-xs text-destructive">{mcpError}</p>}
                                <div className="rounded-xl bg-secondary border border-[color:var(--line)] p-3 space-y-2">
                                    <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">~/.hermes/config.yaml</p>
                                    <pre className="select-all whitespace-pre-wrap break-all text-[11px] leading-relaxed font-mono text-foreground">{mcpConfig}</pre>
                                </div>
                                <Button className="w-full" onClick={closeMcpModal}>He terminado</Button>
                            </>
                        ) : (
                            <>
                                <div className="space-y-2">
                                    <h2 className="text-base font-bold text-foreground">¿Generar token para Hermes Agent?</h2>
                                    <p className="text-sm leading-relaxed text-muted-foreground">
                                        El token dará acceso a tu cuenta durante el periodo configurado. Se mostrará una sola vez.
                                    </p>
                                    <p className="text-sm font-medium text-foreground">
                                        Cerrar este diálogo no revoca el token una vez generado.
                                    </p>
                                </div>
                                {mcpError && <p className="text-xs text-destructive">{mcpError}</p>}
                                <div className="flex gap-3 pt-1">
                                    <Button variant="secondary" className="flex-1" onClick={closeMcpModal}>Cancelar</Button>
                                    <Button className="flex-1" onClick={generateMcpToken} isLoading={generatingMcpToken}>Generar</Button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
