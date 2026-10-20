import { WithBottomNav } from "@/components/nav/session-bottom-nav";
import { FlashToast } from "@/components/ui/flash-toast";

/** Tab destination: renders the session-aware bottom nav (see SessionBottomNav) and any pending flash toast. */
export default function Layout({ children }: { children: React.ReactNode }) {
    return (
        <WithBottomNav>
            {children}
            <FlashToast />
        </WithBottomNav>
    );
}
