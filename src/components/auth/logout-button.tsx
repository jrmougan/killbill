"use client";

import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function LogoutButton() {
    const router = useRouter();
    const [loading, setLoading] = useState(false);

    const handleLogout = async () => {
        setLoading(true);
        try {
            await fetch("/api/auth/logout", {
                method: "POST",
            });
            router.push("/login");
            router.refresh();
        } catch (error) {
            console.error("Logout failed", error);
            setLoading(false);
        }
    };

    return (
        <Button variant="ghost" size="icon" onClick={handleLogout} disabled={loading} className="text-muted-foreground hover:text-white">
            <LogOut className="h-5 w-5" />
        </Button>
    );
}
