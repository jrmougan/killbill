"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRouter } from "next/navigation";
import { Users } from "lucide-react";

export function JoinGroupCard() {
    const [code, setCode] = useState("");
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    const handleJoin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const res = await fetch("/api/groups/join", {
                method: "POST",
                body: JSON.stringify({ code }),
            });
            if (res.ok) {
                router.refresh();
            } else {
                alert("Invalid code");
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="p-4 rounded-3xl bg-white/5 border border-white/10 space-y-3">
            <div className="flex items-center gap-2 text-muted-foreground">
                <Users className="h-4 w-4" />
                <span className="text-xs font-bold uppercase tracking-wider">Unirse a otro grupo</span>
            </div>
            <form onSubmit={handleJoin} className="flex gap-2">
                <Input
                    placeholder="Código de invitación"
                    value={code}
                    onChange={e => setCode(e.target.value)}
                    className="bg-black/20 border-white/10"
                />
                <Button type="submit" size="sm" isLoading={loading}>
                    Unirse
                </Button>
            </form>
        </div>
    );
}
