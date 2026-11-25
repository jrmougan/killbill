import { NextResponse } from "next/server";
import { materializeAllDueRecurring } from "@/lib/recurring";
import { cronGuard } from "../cron-auth";

/**
 * Materializa los gastos recurrentes vencidos de TODOS los espacios y personas.
 *
 * El Inicio (dashboard) sigue materializando de forma perezosa el espacio activo
 * y lo personal del usuario que lo abre; este endpoint cubre lo que nadie abre
 * (otros espacios, usuarios inactivos) para que saldos y presupuestos no esperen
 * a una visita. Ambos caminos son idempotentes y seguros en paralelo: cada
 * ocurrencia se reclama con un updateMany condicional bajo el lock del espacio
 * (ver src/lib/recurring.ts), así que nunca se duplica un gasto.
 *
 * Seguridad: header `x-cron-secret` == env `CRON_SECRET` (503 si no está
 * configurada, 401 si no coincide).
 *
 * Uso (programar p. ej. cada hora o a diario en Coolify → Scheduled Tasks):
 *   curl -X POST https://finanzas.mougan.es/api/cron/recurring \
 *        -H "x-cron-secret: $CRON_SECRET"
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    const denied = cronGuard(request, "Recurrentes por cron deshabilitados: falta CRON_SECRET");
    if (denied) return denied;

    try {
        const created = await materializeAllDueRecurring();
        return NextResponse.json({ created });
    } catch (err) {
        console.error("[cron/recurring] fallo al materializar recurrentes:", err);
        return NextResponse.json({ error: "No se pudieron materializar los recurrentes" }, { status: 500 });
    }
}
