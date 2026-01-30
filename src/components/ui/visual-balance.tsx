"use client";

import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

interface VisualBalanceProps {
    balance: number; // Positive means user 1 is owed, negative means user 1 owes
    user1: { name: string; avatar: string | null };
    user2: { name: string; avatar: string | null };
    className?: string;
}

export function VisualBalance({ balance, user1, user2, className }: VisualBalanceProps) {
    // Calculate rotation based on balance (clamped to +/- 20 degrees)
    const maxTilt = 20;
    const tilt = Math.min(Math.max((balance / 100) * 10, -maxTilt), maxTilt);

    return (
        <div className={cn("relative flex flex-col items-center justify-center py-12", className)}>
            {/* The Pivot Structure */}
            <div className="absolute bottom-0 w-12 h-1 bg-white/20 rounded-full" />
            <div className="absolute bottom-0 w-1 h-32 bg-gradient-to-t from-white/20 to-transparent" />

            <div className="relative w-full max-w-[280px] h-40 flex items-center justify-center">
                <motion.div
                    className="relative w-full flex items-center justify-center"
                    animate={{ rotate: tilt }}
                    transition={{ type: "spring", stiffness: 60, damping: 15 }}
                >
                    {/* The Beam */}
                    <div className="w-full h-[2px] bg-gradient-to-r from-primary via-white/50 to-emerald-400 rounded-full shadow-[0_0_15px_rgba(255,255,255,0.2)]" />

                    {/* User 1 (Left) */}
                    <div className="absolute left-0 -translate-x-1/2 flex flex-col items-center">
                        <motion.div
                            className="w-16 h-16 rounded-full p-[2px] bg-gradient-to-tr from-primary to-purple-500 shadow-xl"
                            animate={{ rotate: -tilt }} // Counter-rotate to keep face upright
                        >
                            <div className="w-full h-full rounded-full bg-black flex items-center justify-center text-2xl overflow-hidden border-2 border-black">
                                {user1.avatar || "👤"}
                            </div>
                        </motion.div>
                        <span className="text-[10px] font-bold uppercase tracking-tighter mt-2 text-primary">{user1.name}</span>
                    </div>

                    {/* User 2 (Right) */}
                    <div className="absolute right-0 translate-x-1/2 flex flex-col items-center">
                        <motion.div
                            className="w-16 h-16 rounded-full p-[2px] bg-gradient-to-tr from-emerald-400 to-cyan-500 shadow-xl"
                            animate={{ rotate: -tilt }}
                        >
                            <div className="w-full h-full rounded-full bg-black flex items-center justify-center text-2xl overflow-hidden border-2 border-black">
                                {user2.avatar || "👤"}
                            </div>
                        </motion.div>
                        <span className="text-[10px] font-bold uppercase tracking-tighter mt-2 text-emerald-400">{user2.name}</span>
                    </div>
                </motion.div>
            </div>

            {/* Scale Center Pivot Point */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-white shadow-[0_0_10px_white]" />
        </div>
    );
}
