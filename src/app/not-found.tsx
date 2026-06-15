import Link from "next/link";
import { Compass, ArrowRight } from "lucide-react";

export default function NotFound() {
  return (
    <div className="relative z-10 flex flex-col items-center justify-center min-h-screen px-6 text-center">
      <div className="glass-card p-8 rounded-2xl border border-white/5 bg-gradient-to-br from-white/5 to-transparent max-w-[320px] w-full space-y-6">
        <div className="h-14 w-14 mx-auto rounded-2xl bg-primary/20 flex items-center justify-center">
          <Compass className="h-7 w-7 text-primary" />
        </div>
        <div className="space-y-2">
          <h1 className="text-5xl font-black tracking-tighter bg-gradient-to-br from-white to-white/30 bg-clip-text text-transparent">
            404
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            No hemos encontrado la página que buscas.
          </p>
        </div>
        <Link href="/dashboard">
          <button className="w-full h-12 bg-white text-black rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-white/90 transition-all active:scale-95 shadow-xl shadow-white/10">
            Volver al inicio <ArrowRight className="h-4 w-4" />
          </button>
        </Link>
      </div>
    </div>
  );
}
