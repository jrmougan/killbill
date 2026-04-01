"use client";

import { useState, useRef } from "react";
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
    ShieldAlert,
    Sun,
    Moon,
    Palette,
    Upload,
    PieChart,
    Tag,
} from "lucide-react";
import Link from "next/link";
import { LogoutButton } from "@/components/auth/logout-button";
import { AvatarPicker } from "@/components/ui/avatar-picker";
import { useTheme } from "@/components/theme-provider";

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

function isAvatarUrl(value: string): boolean {
    return value.startsWith("/") || value.startsWith("http");
}

export function SettingsClient({ user, couple }: SettingsClientProps) {
    const router = useRouter();
    const { theme, toggleTheme } = useTheme();
    const [name, setName] = useState(user.name);
    const [avatar, setAvatar] = useState(user.avatar);
    const [avatarTab, setAvatarTab] = useState<"emoji" | "foto">(
        isAvatarUrl(user.avatar) ? "foto" : "emoji"
    );
    const [isUploading, setIsUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
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

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setIsUploading(true);
        setUploadError(null);
        try {
            const formData = new FormData();
            formData.append("file", file);
            const uploadRes = await fetch("/api/upload", {
                method: "POST",
                body: formData,
            });
            if (!uploadRes.ok) {
                setUploadError("Error al subir la imagen");
                return;
            }
            const { url } = await uploadRes.json();
            setAvatar(url);
        } catch {
            setUploadError("Error de conexión");
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
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
                        <div className="space-y-3">
                            <label className="text-xs font-medium text-muted-foreground ml-1 mb-2 block text-center">Tu Avatar</label>

                            {/* Tab selector */}
                            <div className="flex rounded-xl overflow-hidden border border-white/10 bg-white/5">
                                <button
                                    type="button"
                                    onClick={() => setAvatarTab("emoji")}
                                    className={`flex-1 py-2 text-xs font-semibold transition-colors ${
                                        avatarTab === "emoji"
                                            ? "bg-primary text-primary-foreground"
                                            : "text-muted-foreground hover:text-foreground"
                                    }`}
                                >
                                    Emoji
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setAvatarTab("foto")}
                                    className={`flex-1 py-2 text-xs font-semibold transition-colors ${
                                        avatarTab === "foto"
                                            ? "bg-primary text-primary-foreground"
                                            : "text-muted-foreground hover:text-foreground"
                                    }`}
                                >
                                    Foto
                                </button>
                            </div>

                            {avatarTab === "emoji" && (
                                <AvatarPicker
                                    currentAvatar={isAvatarUrl(avatar) ? "" : avatar}
                                    onAvatarChange={setAvatar}
                                />
                            )}

                            {avatarTab === "foto" && (
                                <div className="flex flex-col items-center gap-3">
                                    {isAvatarUrl(avatar) ? (
                                        <img
                                            src={avatar}
                                            alt="Tu foto de perfil"
                                            className="h-20 w-20 rounded-full object-cover border-2 border-primary/40"
                                        />
                                    ) : (
                                        <div className="h-20 w-20 rounded-full bg-white/10 border-2 border-dashed border-white/20 flex items-center justify-center text-muted-foreground">
                                            <Upload className="h-6 w-6" />
                                        </div>
                                    )}
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={handleFileChange}
                                    />
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        className="gap-2 bg-white/5 border border-white/10 hover:bg-white/10"
                                        onClick={() => fileInputRef.current?.click()}
                                        disabled={isUploading}
                                        isLoading={isUploading}
                                    >
                                        <Upload className="h-4 w-4" />
                                        {isUploading ? "Subiendo..." : "Subir foto"}
                                    </Button>
                                    {uploadError && (
                                        <p className="text-xs text-red-400 text-center">{uploadError}</p>
                                    )}
                                </div>
                            )}
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

                {/* Appearance Section */}
                <section className="space-y-4">
                    <div className="flex items-center gap-2 px-1">
                        <Palette className="h-5 w-5 text-primary" />
                        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Apariencia</h2>
                    </div>

                    <GlassCard className="p-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                {theme === "dark" ? (
                                    <Moon className="h-5 w-5 text-muted-foreground" />
                                ) : (
                                    <Sun className="h-5 w-5 text-amber-500" />
                                )}
                                <div>
                                    <p className="text-sm font-medium">
                                        {theme === "dark" ? "Modo oscuro" : "Modo claro"}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        {theme === "dark" ? "Cambia al tema claro" : "Cambia al tema oscuro"}
                                    </p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={toggleTheme}
                                aria-label="Cambiar tema"
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                                    theme === "light" ? "bg-primary" : "bg-white/20"
                                }`}
                            >
                                <span
                                    className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                                        theme === "light" ? "translate-x-6" : "translate-x-1"
                                    }`}
                                />
                            </button>
                        </div>
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
                                <div className="h-10 w-10 rounded-full bg-pink-500/20 flex items-center justify-center text-xl overflow-hidden">
                                    {partner?.avatar && isAvatarUrl(partner.avatar) ? (
                                        <img
                                            src={partner.avatar}
                                            alt={partner.name}
                                            className="h-full w-full object-cover"
                                        />
                                    ) : (
                                        partner?.avatar || "💕"
                                    )}
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

                {/* Tools Section */}
                {couple && (
                    <section className="space-y-4">
                        <div className="flex items-center gap-2 px-1">
                            <PieChart className="h-5 w-5 text-primary" />
                            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Herramientas</h2>
                        </div>

                        <div className="space-y-3">
                            <Link href="/budget" className="flex items-center gap-3 w-full h-14 px-4 bg-white/5 border border-white/5 rounded-xl hover:bg-white/10 transition-colors">
                                <PieChart className="h-5 w-5 text-muted-foreground" />
                                <span className="font-medium text-sm">Presupuestos</span>
                            </Link>
                            <Link href="/tags" className="flex items-center gap-3 w-full h-14 px-4 bg-white/5 border border-white/5 rounded-xl hover:bg-white/10 transition-colors">
                                <Tag className="h-5 w-5 text-muted-foreground" />
                                <span className="font-medium text-sm">Etiquetas</span>
                            </Link>
                        </div>
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
