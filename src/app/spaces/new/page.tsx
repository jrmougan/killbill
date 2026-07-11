import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { CreateSpaceForm } from "@/components/space/create-space-form";

export const dynamic = "force-dynamic";

export default async function NewSpacePage() {
    const session = await getSession();
    if (!session?.userId) redirect("/login");
    return <CreateSpaceForm />;
}
