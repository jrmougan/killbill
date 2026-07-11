"use client";

import { useState } from "react";
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
    Download,
    Plus,
    LogIn,
    LogOut,
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

    // Join-group form
    const [joinCode, setJoinCode] = useState("");
    const [joining, setJoining] = useState(false);
    const [joinError, setJoinError] = useState<string | null>(null);

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

    const handleJoin = async () => {
        setJoining(true);
        setJoinError(null);
        try {
            const res = await fetch("/api/couple/join", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code: joinCode }),
            });
            const data = await res.json();
            if (res.ok) {
                if (data.couple?.id) await setActiveGroup(data.couple.id);
                setJoinCode("");
                router.refresh();
            } else {
                setJoinError(data.error || "Código inválido");
            }
        } catch (_err) {
            setJoinError("Error de conexión");
        } finally {
            setJoining(false);
        }
    };

    const copyCode = (code: string, id: string) => {
        navigator.clipboard.writeText(code);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    };

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
                            <h3 className="text-[13px] font-bold text-foreground">Unirse con código</h3>
                        </div>
                        <Input
                            value={joinCode}
                            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                            placeholder="Código de invitación"
                            className="h-[50px] rounded-xl bg-card border border-[color:var(--line)] text-foreground px-[15px] font-mono tracking-tighter focus:border-[color:var(--accent-border)]"
                        />
                        {joinError && <p className="text-destructive text-xs">{joinError}</p>}
                        <Button
                            className="w-full h-[52px] rounded-[13px] bg-primary text-white font-semibold"
                            onClick={handleJoin}
                            isLoading={joining}
                            disabled={!joinCode.trim()}
                        >
                            <LogIn className="h-4 w-4 mr-2" /> Unirse
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
                            <a href="/api/export" download className="flex items-center gap-3 w-full h-14 px-4 bg-card border border-[color:var(--line)] rounded-xl hover:bg-secondary transition-colors">
                                <Download className="h-5 w-5 text-muted-foreground" />
                                <span className="font-medium text-sm text-foreground">Exportar gastos (CSV)</span>
                            </a>
                        </div>
                    </section>
                )}

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
        </div>
    );
}
