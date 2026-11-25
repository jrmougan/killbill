import { WithBottomNav } from "@/components/nav/session-bottom-nav";

/** Tab destination of the guest nav ("Cuenta"): renders the session-aware bottom nav. */
export default function Layout({ children }: { children: React.ReactNode }) {
    return <WithBottomNav>{children}</WithBottomNav>;
}
