import { WithBottomNav } from "@/components/nav/session-bottom-nav";

/** Tab destination: renders the session-aware bottom nav (see SessionBottomNav). */
export default function Layout({ children }: { children: React.ReactNode }) {
    return <WithBottomNav>{children}</WithBottomNav>;
}
