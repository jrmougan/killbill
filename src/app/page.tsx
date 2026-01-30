import Link from "next/link";
import { VisualBalance } from "@/components/ui/visual-balance";
import { GlassCard } from "@/components/ui/glass-card";
import { Scan, Scale, ShieldCheck, Heart, ArrowRight } from "lucide-react";

export default function Home() {
  return (
    <div className="flex flex-col w-full min-h-screen overflow-x-hidden">
      {/* Hero Section */}
      <section className="flex flex-col items-center justify-center pt-20 pb-12 px-6 space-y-10 z-10 w-full text-center">
        <div className="space-y-4 max-w-[320px] mx-auto">
          <h1 className="text-6xl font-black tracking-tighter bg-gradient-to-br from-white to-white/30 bg-clip-text text-transparent italic leading-none">
            EQUIL
          </h1>
          <p className="text-muted-foreground text-lg font-medium leading-tight">
            Vuestra economía compartida, en perfecto equilibrio.
          </p>
        </div>

        {/* Demo Balance Visual */}
        <div className="w-full max-w-sm pointer-events-none relative group">
          <div className="absolute inset-0 bg-primary/20 blur-[60px] rounded-full scale-75 opacity-50 group-hover:opacity-100 transition-opacity" />
          <VisualBalance
            balance={-35.50}
            user1={{ name: "Tú", avatar: "👤" }}
            user2={{ name: "Pareja", avatar: "💕" }}
          />
          <div className="text-center mt-[-30px]">
            <p className="text-[10px] text-white/30 uppercase tracking-[0.4em] font-black">Visualización de Deuda</p>
          </div>
        </div>

        <div className="grid gap-4 w-full max-w-[320px] mx-auto pt-4">
          <Link href="/dashboard">
            <button className="w-full h-14 bg-white text-black rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-white/90 transition-all active:scale-95 shadow-xl shadow-white/10">
              Empezar ahora <ArrowRight className="h-4 w-4" />
            </button>
          </Link>
          <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">Gratis durante la beta</p>
        </div>
      </section>

      {/* Features Section */}
      <section className="px-6 py-12 space-y-6 z-10">
        <h2 className="text-xs font-black uppercase tracking-[0.3em] text-white/40 px-2">Características</h2>

        <div className="grid gap-4">
          <GlassCard className="p-5 flex gap-4 items-start border border-white/5 bg-gradient-to-br from-white/5 to-transparent">
            <div className="h-10 w-10 rounded-xl bg-primary/20 flex items-center justify-center flex-shrink-0">
              <Scan className="h-5 w-5 text-primary" />
            </div>
            <div className="space-y-1">
              <h3 className="font-bold text-sm">Escaneo con IA</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">Gemini OCR lee vuestros tickets y extrae cada producto automáticamente.</p>
            </div>
          </GlassCard>

          <GlassCard className="p-5 flex gap-4 items-start border border-white/5 bg-gradient-to-br from-white/5 to-transparent">
            <div className="h-10 w-10 rounded-xl bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
              <Scale className="h-5 w-5 text-emerald-400" />
            </div>
            <div className="space-y-1">
              <h3 className="font-bold text-sm">Desglose Justo</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">¿Algo es solo para ti? Márcalo y la balanza se ajustará con total transparencia.</p>
            </div>
          </GlassCard>

          <GlassCard className="p-5 flex gap-4 items-start border border-white/5 bg-gradient-to-br from-white/5 to-transparent">
            <div className="h-10 w-10 rounded-xl bg-blue-500/20 flex items-center justify-center flex-shrink-0">
              <ShieldCheck className="h-5 w-5 text-blue-400" />
            </div>
            <div className="space-y-1">
              <h3 className="font-bold text-sm">Transparencia Total</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">Sabed siempre quién debe cuánto, sin discusiones y en tiempo real.</p>
            </div>
          </GlassCard>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto px-6 py-12 text-center space-y-4 z-10 border-t border-white/5 bg-black/50 backdrop-blur-xl">
        <h4 className="text-xl font-black italic tracking-tighter opacity-20">EQUIL</h4>
        <div className="flex justify-center gap-6 text-xs text-muted-foreground font-medium">
          <span className="flex items-center gap-1"><Heart className="h-3 w-3 text-red-500" /> Para parejas</span>
        </div>
        <p className="text-[10px] text-white/10 uppercase tracking-widest font-bold">© 2026 EQUIL Finanzas. Todos los derechos reservados.</p>
      </footer>
    </div>
  );
}
