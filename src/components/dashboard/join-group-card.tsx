"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRouter } from "next/navigation";
import { Heart } from "lucide-react";

export function JoinGroupCard() {
    const [code, setCode] = useState("");
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    const handleJoin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const res = await fetch("/api/couple/join", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code }),
            });
            if (res.ok) {
                router.refresh();
            } else {
                const data = await res.json();
                alert(data.error || "Código inválido");
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="p-4 rounded-3xl bg-white/5 border border-white/10 space-y-3 mt-4">
            <div className="flex items-center gap-2 text-muted-foreground">
                <Heart className="h-4 w-4" />
                <span className="text-xs font-bold uppercase tracking-wider text-pink-500/80">Unirse a una pareja</span>
            </div>
            <form onSubmit={handleJoin} className="flex gap-2">
                <Input
                    placeholder="Código de invitación"
                    value={code}
                    onChange={e => setCode(e.target.value)}
                    className="bg-black/20 border-white/10"
                />
                <Button type="submit" size="sm" isLoading={loading} className="px-6 font-bold">
                    Unirse
                </Button>
            </form>
        </div>
    );
}
