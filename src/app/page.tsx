import Link from "next/link";
import { VisualBalance } from "@/components/ui/visual-balance";

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center flex-1 p-6 space-y-12 z-10 w-full overflow-hidden">
      <div className="text-center space-y-2">
        <h1 className="text-5xl font-extrabold tracking-tighter bg-gradient-to-br from-white to-white/40 bg-clip-text text-transparent italic">
          EQUIL
        </h1>
        <p className="text-muted-foreground text-lg">
          Justicia y equilibrio en vuestros gastos.
        </p>
      </div>

      {/* Demo Balance Visual */}
      <div className="w-full max-w-sm pointer-events-none">
        <VisualBalance
          balance={-35.50}
          user1={{ name: "Tú", avatar: "👤" }}
          user2={{ name: "Pareja", avatar: "💕" }}
        />
        <div className="text-center mt-[-20px]">
          <p className="text-[10px] text-white/30 uppercase tracking-[0.3em] font-bold">Simulación de deuda</p>
        </div>
      </div>

      <div className="grid gap-4 w-full">
        <Link
          href="/dashboard"
          className="glass-card px-8 py-4 rounded-xl font-medium text-center hover:bg-white/10 transition-colors"
        >
          Entrar a Demo
        </Link>
      </div>
    </div>
  );
}
