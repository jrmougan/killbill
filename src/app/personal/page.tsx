import { redirect } from "next/navigation";

// The personal ledger is no longer a separate silo — it is the "Personal" scope of
// the unified home. Preserve old links/bookmarks by redirecting.
export default function PersonalPage() {
    redirect("/dashboard?scope=personal");
}
