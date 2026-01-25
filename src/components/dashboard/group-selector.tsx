"use client";

import { useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface Group {
    id: string;
    name: string;
    type: string;
    code: string;
}

interface GroupSelectorProps {
    currentGroup: Group;
    allGroups: Group[];
}

export function GroupSelector({ currentGroup, allGroups }: GroupSelectorProps) {
    const [isOpen, setIsOpen] = useState(false);
    const router = useRouter();

    const handleSwitch = async (groupId: string) => {
        if (groupId === currentGroup.id) {
            setIsOpen(false);
            return;
        }

        await fetch("/api/groups/switch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ groupId }),
        });

        setIsOpen(false);
        router.refresh();
    };

    return (
        <div className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
                {currentGroup.type === "COUPLE" ? "❤️" : "👥"}{" "}
                {currentGroup.type === "COUPLE" ? "Pareja" : currentGroup.name}
                <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
            </button>

            {isOpen && (
                <div className="absolute top-full left-0 mt-2 w-56 bg-black/90 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl z-50 py-2">
                    {allGroups.map((group) => (
                        <button
                            key={group.id}
                            onClick={() => handleSwitch(group.id)}
                            className={`w-full text-left px-4 py-2 text-sm hover:bg-white/10 transition-colors flex items-center gap-2 ${group.id === currentGroup.id ? "text-primary" : "text-foreground"
                                }`}
                        >
                            {group.type === "COUPLE" ? "❤️" : "👥"}
                            {group.type === "COUPLE" ? "Pareja" : group.name}
                            {group.id === currentGroup.id && (
                                <span className="ml-auto text-xs text-primary">✓</span>
                            )}
                        </button>
                    ))}

                    <div className="border-t border-white/10 mt-2 pt-2">
                        <Link
                            href="/groups/new"
                            className="w-full text-left px-4 py-2 text-sm hover:bg-white/10 transition-colors flex items-center gap-2 text-muted-foreground"
                        >
                            <Plus className="h-4 w-4" />
                            Crear nuevo grupo
                        </Link>
                    </div>
                </div>
            )}
        </div>
    );
}
