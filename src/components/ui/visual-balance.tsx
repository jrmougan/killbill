"use client";

import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { isAvatarUrl } from "@/lib/avatar";

interface VisualBalanceProps {
    balance: number; // Positive means user 1 is owed, negative means user 1 owes
    user1: { name: string; avatar: string | null };
    user2: { name: string; avatar: string | null };
    className?: string;
}

// Minimalist balance scale (EQUIL - Flujo de Gastos redesign):
// a thin neutral beam with flat circular avatars (initial in accent / green),
// no gradients, glows or coloured shadows.
function Pan({
    user,
    color,
    tilt,
    side,
}: {
    user: { name: string; avatar: string | null };
    color: string;
    tilt: number;
    side: "left" | "right";
}) {
    const initial = user.name.charAt(0).toUpperCase();
    return (
        <div
            className={cn(
                "absolute flex flex-col items-center",
                side === "left" ? "left-0 -translate-x-1/2" : "right-0 translate-x-1/2"
            )}
        >
            <motion.div
                className="w-[50px] h-[50px] rounded-full bg-[hsl(var(--surface-raised))] border border-white/[0.08] flex items-center justify-center overflow-hidden text-lg font-bold"
                style={{ color }}
                animate={{ rotate: -tilt }} // counter-rotate so the face stays upright
                transition={{ type: "spring", stiffness: 60, damping: 15 }}
            >
                {isAvatarUrl(user.avatar) ? (
                    // eslint-disable-next-line @next/next/no-img-element -- user-uploaded avatar URL of unknown dimensions; next/image would change layout/runtime
                    <img src={user.avatar!} alt={user.name} className="w-full h-full object-cover" />
                ) : (
                    initial
                )}
            </motion.div>
            <span className="text-[10px] font-semibold uppercase tracking-[0.05em] mt-[9px] text-muted-foreground">
                {user.name}
            </span>
        </div>
    );
}

export function VisualBalance({ balance, user1, user2, className }: VisualBalanceProps) {
    // Rotation tracks the balance, clamped to +/- 16 degrees (matches the design).
    const maxTilt = 16;
    const tilt = Math.min(Math.max((balance / 100) * 8, -maxTilt), maxTilt);

    return (
        <div className={cn("relative flex items-center justify-center h-[150px]", className)}>
            {/* Pivot base + post */}
            <div className="absolute bottom-4 w-10 h-[3px] rounded-full bg-white/[0.12]" />
            <div className="absolute bottom-4 w-[2px] h-[108px] bg-white/[0.1]" />

            <motion.div
                className="relative w-[236px] h-[84px] flex items-center justify-center"
                animate={{ rotate: tilt }}
                transition={{ type: "spring", stiffness: 60, damping: 15 }}
            >
                {/* Beam */}
                <div className="w-full h-[2px] rounded-full bg-white/[0.16]" />

                <Pan user={user1} color="var(--color-primary, #7c3aed)" tilt={tilt} side="left" />
                <Pan user={user2} color="#34d399" tilt={tilt} side="right" />
            </motion.div>

            {/* Centre pivot dot */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[7px] w-[7px] rounded-full bg-white/[0.45]" />
        </div>
    );
}
