"use client";

import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { ArrowLeft, Plus, Trash2, Copy, Check, Users } from "lucide-react";
import Link from "next/link";
import { useState, useEffect } from "react";

interface InviteCode {
    id: string;
    code: string;
    createdAt: string;
    usedAt: string | null;
    expiresAt: string | null;
    usedBy: { id: string; name: string; email: string | null } | null;
}

export default function AdminPage() {
    const [invites, setInvites] = useState<InviteCode[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetchInvites();
    }, []);

    const fetchInvites = async () => {
        try {
            const res = await fetch("/api/admin/invites", { cache: "no-store", headers: { 'Pragma': 'no-cache' } });
            const data = await res.json();

            if (!res.ok) {
                if (res.status === 403) {
                    // Check if debug info is available
                    const debugInfo = data.debug ? JSON.stringify(data.debug, null, 2) : "";
                    setError("No tienes permisos de administrador. " + debugInfo);
                } else {
                    setError(data.error || "Error al cargar invitaciones");
                }
                setLoading(false);
                return;
            }

            setInvites(data);
        } catch (e) {
            console.error(e);
            setError("Error de conexión al cargar invitaciones");
        } finally {
            setLoading(false);
        }
    };

    const createInvite = async () => {
        setCreating(true);
        try {
            const res = await fetch("/api/admin/invites", { method: "POST" });
            if (!res.ok) throw new Error();
            await fetchInvites();
        } catch {
            alert("Error al crear invitación");
        } finally {
            setCreating(false);
        }
    };

    const deleteInvite = async (id: string) => {
        if (!confirm("¿Eliminar esta invitación?")) return;
        try {
            await fetch("/api/admin/invites", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id }),
            });
            await fetchInvites();
        } catch {
            alert("Error al eliminar");
        }
    };

    const copyCode = (code: string, id: string) => {
        const url = `${window.location.origin}/register?code=${code}`;
        navigator.clipboard.writeText(url);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="text-muted-foreground">Cargando...</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-4">
                <div className="text-6xl">🔒</div>
                <p className="text-lg font-bold">{error}</p>
                <Link href="/dashboard">
                    <Button>Volver al dashboard</Button>
                </Link>
            </div>
        );
    }

    const unusedInvites = invites.filter(i => !i.usedBy);
    const usedInvites = invites.filter(i => i.usedBy);

    return (
        <div className="flex flex-col min-h-screen p-4 space-y-6 max-w-md mx-auto pb-24">
            <header className="flex items-center gap-4 pt-2">
                <Link href="/dashboard">
                    <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-white/10">
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                </Link>
                <div className="flex-1">
                    <h1 className="text-xl font-bold">Panel de Admin</h1>
                    <p className="text-xs text-muted-foreground">Gestionar invitaciones</p>
                </div>
            </header>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-3">
                <GlassCard className="p-4 text-center">
                    <p className="text-2xl font-bold text-primary">{unusedInvites.length}</p>
                    <p className="text-xs text-muted-foreground">Disponibles</p>
                </GlassCard>
                <GlassCard className="p-4 text-center">
                    <p className="text-2xl font-bold text-green-400">{usedInvites.length}</p>
                    <p className="text-xs text-muted-foreground">Usadas</p>
                </GlassCard>
            </div>

            {/* Create Button */}
            <Button onClick={createInvite} isLoading={creating} className="w-full">
                <Plus className="h-4 w-4 mr-2" />
                Crear nueva invitación
            </Button>

            {/* Unused Invites */}
            {unusedInvites.length > 0 && (
                <section className="space-y-3">
                    <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                        Invitaciones disponibles
                    </h2>
                    {unusedInvites.map(invite => (
                        <GlassCard key={invite.id} className="p-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="font-mono font-bold text-lg">{invite.code}</p>
                                    <p className="text-xs text-muted-foreground">
                                        Expira: {invite.expiresAt
                                            ? new Date(invite.expiresAt).toLocaleDateString()
                                            : "Nunca"}
                                    </p>
                                </div>
                                <div className="flex gap-2">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => copyCode(invite.code, invite.id)}
                                    >
                                        {copiedId === invite.id
                                            ? <Check className="h-4 w-4 text-green-400" />
                                            : <Copy className="h-4 w-4" />}
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => deleteInvite(invite.id)}
                                        className="text-red-400 hover:text-red-300"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        </GlassCard>
                    ))}
                </section>
            )}

            {/* Used Invites */}
            {usedInvites.length > 0 && (
                <section className="space-y-3">
                    <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                        Invitaciones usadas
                    </h2>
                    {usedInvites.map(invite => (
                        <GlassCard key={invite.id} className="p-4 opacity-60">
                            <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-full bg-green-400/20 flex items-center justify-center">
                                    <Users className="h-5 w-5 text-green-400" />
                                </div>
                                <div className="flex-1">
                                    <p className="font-medium">{invite.usedBy?.name}</p>
                                    <p className="text-xs text-muted-foreground">{invite.usedBy?.email}</p>
                                </div>
                                <p className="text-xs text-muted-foreground font-mono">{invite.code}</p>
                            </div>
                        </GlassCard>
                    ))}
                </section>
            )}
        </div>
    );
}
