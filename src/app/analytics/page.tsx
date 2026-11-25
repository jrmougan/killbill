import { redirect } from "next/navigation";

// Legacy route: analytics now live in the "Mes" tab (Análisis). Keeps old links
// working and forwards the personal lens (`?scope=personal`).
export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ scope?: string | string[] }> }) {
    const { scope } = await searchParams;
    const personal = (Array.isArray(scope) ? scope[0] : scope) === "personal";
    redirect(personal ? "/month?view=analysis&scope=personal" : "/month?view=analysis");
}
