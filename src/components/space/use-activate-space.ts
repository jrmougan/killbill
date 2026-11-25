"use client";

import { useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setActiveGroup } from "@/app/actions/group";
import { PERSONAL_KEY } from "./space-keys";


/**
 * Switch the active space and land on Inicio. Reuses the existing mechanism:
 *  - a shared space → `setActiveGroup` (server action; re-checks the ACTIVE
 *    Membership before writing the `active_group` cookie) + `/dashboard`;
 *  - the personal (INDIVIDUAL, virtual) context → `/dashboard?scope=personal`.
 * Authorization stays server-side: a forged key is simply ignored there.
 */
export function useActivateSpace() {
    const router = useRouter();
    const [pending, startTransition] = useTransition();

    const activate = useCallback(
        (key: string) => {
            startTransition(async () => {
                if (key === PERSONAL_KEY) {
                    router.push("/dashboard?scope=personal");
                    router.refresh();
                    return;
                }
                await setActiveGroup(key);
                router.push("/dashboard");
                router.refresh();
            });
        },
        [router],
    );

    return { activate, pending };
}
