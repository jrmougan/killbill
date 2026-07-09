"use client";

import { GlassCard } from "@/components/ui/glass-card";
import { Share2, Check } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";


interface InviteCardProps {
    code: string;
}

export function InviteCard({ code }: InviteCardProps) {
    const [copied, setCopied] = useState(false);

    const handleShare = async () => {
        const url = `${window.location.origin}/register?code=${code}`;
        const shareData = {
            title: 'Únete a mi grupo de gastos',
            text: `¡Hola! Únete a mi grupo en EQUIL para compartir gastos:`,
            url: url,
        };

        if (navigator.share) {
            try {
                await navigator.share(shareData);
            } catch (err) {
                console.log('Error sharing:', err);
            }
        } else {
            // Fallback to copy
            try {
                await navigator.clipboard.writeText(url);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
            } catch (err) {
                console.error('Failed to copy:', err);
            }
        }
    };

    return (
        <GlassCard className="p-3 bg-card border border-[color:var(--line)] flex items-center justify-between">
            <div className="text-sm">
                <p className="font-medium text-foreground">Invita a tu grupo</p>
                <p className="text-xs text-muted-foreground">Toca para compartir enlace</p>
            </div>

            <Button
                variant="ghost"
                size="sm"
                className="gap-2 bg-secondary hover:bg-[var(--surface-raised-hex)]"
                onClick={handleShare}
            >
                <code className="text-xs tracking-widest font-mono text-foreground">{code}</code>
                {copied ? <Check className="h-3 w-3 text-[color:var(--positive)]" /> : <Share2 className="h-3 w-3 opacity-70" />}
            </Button>
        </GlassCard>
    );
}
