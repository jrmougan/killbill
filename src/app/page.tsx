import Link from "next/link";
import { redirect } from "next/navigation";
import { Scan, Scale, Users } from "lucide-react";
import { getSession } from "@/lib/auth";
import { sessionKindOf } from "@/lib/invite-policy";

const FEATURES = [
    { icon: Scale, title: "Cuentas claras", sub: "Quién debe cuánto, siempre al día." },
    { icon: Scan, title: "Escanea el ticket", sub: "Lee cada producto y lo reparte por ti." },
    { icon: Users, title: "Pareja, piso o viaje", sub: "Un espacio para cada grupo con el que compartes." },
];

/**
 * Public landing (EQUIL). A visitor with a session goes straight to Inicio; an
 * anonymous one sees what EQUIL is and how to get in (it is invitation-only).
 */
export default async function Home() {
    if (sessionKindOf(await getSession()) !== "none") redirect("/dashboard");

    return (
        <div className="min-h-dvh flex flex-col eq-in px-6 pt-12 pb-[calc(34px+env(safe-area-inset-bottom))]">
            <span className="text-[15px] font-extrabold tracking-[0.14em] text-primary">EQUIL</span>
            <h1 className="mt-3.5 text-[36px] font-bold tracking-[-0.03em] leading-[1.05] text-pretty">
                Gastos compartidos, en equilibrio.
            </h1>
            <p className="mt-3 text-[15px] text-muted-foreground leading-[1.45] text-pretty">
                Apuntad lo que pagáis, repartidlo como queráis y quedad en paz con un toque.
            </p>

            <ul className="mt-8 rounded-[18px] border border-[color:var(--line-2)] bg-card px-4">
                {FEATURES.map(({ icon: Icon, title, sub }, i) => (
                    <li
                        key={title}
                        className={"flex items-center gap-3 py-3.5" + (i > 0 ? " border-t border-[color:var(--line-2)]" : "")}
                    >
                        <span className="h-10 w-10 flex-none rounded-xl bg-[var(--accent-tint)] flex items-center justify-center text-primary">
                            <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                        </span>
                        <span className="min-w-0">
                            <span className="block text-[15px] font-semibold">{title}</span>
                            <span className="block text-[12.5px] text-muted-foreground">{sub}</span>
                        </span>
                    </li>
                ))}
            </ul>

            <div className="mt-auto pt-10 flex flex-col items-center gap-3.5">
                <Link
                    href="/login"
                    className="w-full h-14 rounded-[18px] bg-primary text-primary-foreground text-base font-semibold flex items-center justify-center transition-transform active:scale-[0.98]"
                >
                    Entrar
                </Link>
                <Link
                    href="/register"
                    className="w-full h-14 rounded-[18px] bg-card border border-[color:var(--line)] text-base font-semibold flex items-center justify-center transition-transform active:scale-[0.98]"
                >
                    Tengo un código de invitación
                </Link>
                <p className="text-xs text-muted-foreground text-center">
                    ¿Te han enviado un enlace? Ábrelo directamente para unirte.
                </p>
            </div>
        </div>
    );
}
