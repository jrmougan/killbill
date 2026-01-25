
import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center flex-1 p-6 space-y-10 z-10">
      <div className="text-center space-y-2">
        <h1 className="text-4xl font-bold tracking-tighter bg-gradient-to-br from-white to-white/50 bg-clip-text text-transparent">
          Kill Bill
        </h1>
        <p className="text-muted-foreground">
          Divide gastos. Liquida con estilo.
        </p>
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
