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
    LogOut,
    Trash2,
    Save,
    Copy,
    Check,
    ShieldAlert
} from "lucide-react";
import Link from "next/link";
import { LogoutButton } from "@/components/auth/logout-button";
import { AvatarPicker } from "@/components/ui/avatar-picker";

interface UserData {
    id: string;
    name: string;
    email: string;
    avatar: string;
}

interface CoupleData {
    id: string;
    name: string;
    code: string;
    members: { id: string, name: string, avatar: string }[];
}

interface SettingsClientProps {
    user: UserData;
    couple: CoupleData | null;
}

export function SettingsClient({ user, couple }: SettingsClientProps) {
    const router = useRouter();
    const [name, setName] = useState(user.name);
    const [avatar, setAvatar] = useState(user.avatar);
    const [isSaving, setIsSaving] = useState(false);
    const [isUnlinking, setIsUnlinking] = useState(false);
    const [copied, setCopied] = useState(false);
    const [message, setMessage] = useState<{ text: string, type: 'success' | 'error' } | null>(null);

    const partner = couple?.members.find(m => m.id !== user.id);

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
        } catch (err) {
            setMessage({ text: "Error de conexión", type: 'error' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleUnlink = async () => {
        if (!confirm("¿ESTÁS SEGURO? Perderás acceso a todos los gastos y desgloses de esta pareja. Esta acción no se puede deshacer.")) return;

        setIsUnlinking(true);
        try {
            const res = await fetch("/api/couple/unlink", {
                method: "POST",
            });
            if (res.ok) {
                router.push("/dashboard");
                router.refresh();
            } else {
                alert("Error al desvincular");
            }
        } catch (err) {
            alert("Error de conexión");
        } finally {
            setIsUnlinking(false);
        }
    };

    const copyCode = () => {
        if (couple?.code) {
            navigator.clipboard.writeText(couple.code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    return (
        <div className="flex flex-col min-h-screen p-4 space-y-6 max-w-md mx-auto relative pb-10">
            <header className="flex items-center gap-4 pt-2">
                <Link href="/dashboard">
                    <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-white/10">
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                </Link>
                <h1 className="text-xl font-bold">Ajustes</h1>
            </header>

            <div className="space-y-8 flex-1">
                {/* Profile Section */}
                <section className="space-y-4">
                    <div className="flex items-center gap-2 px-1">
                        <User className="h-5 w-5 text-primary" />
                        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Mi Perfil</h2>
                    </div>

                    <GlassCard className="p-4 space-y-4">
                        <div className="space-y-2">
                            <label className="text-xs font-medium text-muted-foreground ml-1 mb-2 block text-center">Tu Avatar</label>
                            <AvatarPicker
                                currentAvatar={avatar}
                                onAvatarChange={setAvatar}
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-medium text-muted-foreground ml-1">Tu nombre</label>
                            <Input
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="Tu nombre"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-medium text-muted-foreground ml-1">Email</label>
                            <Input
                                value={user.email}
                                disabled
                                className="bg-white/5 opacity-50"
                            />
                        </div>

                        {message && (
                            <p className={`text-xs text-center font-medium ${message.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
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

                {/* Couple Section */}
                {couple && (
                    <section className="space-y-4">
                        <div className="flex items-center gap-2 px-1">
                            <Heart className="h-5 w-5 text-pink-500" />
                            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Mi Pareja</h2>
                        </div>

                        <GlassCard className="p-4 space-y-4">
                            <div className="flex items-center justify-between">
                                <div className="space-y-1">
                                    <p className="text-sm font-bold">{partner ? partner.name : "Esperando..."}</p>
                                    <p className="text-xs text-muted-foreground">{partner ? "Vinculado como pareja" : "Comparte tu código"}</p>
                                </div>
                                <div className="h-10 w-10 rounded-full bg-pink-500/20 flex items-center justify-center text-xl">
                                    {partner?.avatar || "💕"}
                                </div>
                            </div>

                            <div className="p-3 bg-black/20 rounded-xl border border-white/5 flex items-center justify-between">
                                <div className="space-y-1">
                                    <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">Código de invitación</p>
                                    <code className="text-lg font-mono font-bold tracking-tighter">{couple.code}</code>
                                </div>
                                <Button size="icon" variant="ghost" onClick={copyCode} className="h-10 w-10">
                                    {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                                </Button>
                            </div>
                        </GlassCard>
                    </section>
                )}

                {/* Account Section */}
                <section className="space-y-4">
                    <div className="flex items-center gap-2 px-1">
                        <ShieldAlert className="h-5 w-5 text-red-500" />
                        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Cuenta</h2>
                    </div>

                    <div className="space-y-3">
                        <LogoutButton className="w-full justify-start h-14 bg-white/5 border border-white/5 hover:bg-white/10" />

                        {couple && (
                            <Button
                                variant="ghost"
                                className="w-full justify-start h-14 bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300 border border-red-500/20"
                                onClick={handleUnlink}
                                isLoading={isUnlinking}
                            >
                                <Trash2 className="h-5 w-5 mr-3" /> Desvincularme de mi pareja
                            </Button>
                        )}
                    </div>
                </section>
            </div>

            <footer className="text-center space-y-1 py-4">
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">EQUIL App v1.0.0 Beta</p>
                <p className="text-[10px] text-white/20">Hecho con ❤️ para parejas</p>
            </footer>
        </div>
    );
}
