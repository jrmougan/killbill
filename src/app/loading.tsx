import { Loader2 } from "lucide-react";

export default function Loading() {
  return (
    <div className="relative z-10 flex flex-col items-center justify-center min-h-screen px-6 gap-4">
      <Loader2 className="h-8 w-8 text-primary animate-spin" />
      <p className="text-xs text-muted-foreground uppercase tracking-[0.3em] font-bold">
        Cargando
      </p>
    </div>
  );
}
