import { redirect } from "next/navigation";

// Legacy route: budgets now live in the "Mes" tab. Keeps old links working and
// forwards the personal lens (`?scope=personal`).
export default async function BudgetPage({ searchParams }: { searchParams: Promise<{ scope?: string | string[] }> }) {
    const { scope } = await searchParams;
    const personal = (Array.isArray(scope) ? scope[0] : scope) === "personal";
    redirect(personal ? "/month?view=budget&scope=personal" : "/month?view=budget");
}
