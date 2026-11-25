import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Healthcheck para Docker/Coolify/Traefik. Público (sin auth) y sin caché:
 * 200 {status:'ok'} si la BD responde a `SELECT 1`, 503 si no. No expone
 * detalles del error (solo se loguean en el servidor).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
    try {
        await prisma.$queryRaw`SELECT 1`;
        return NextResponse.json({ status: "ok" }, { headers: NO_STORE });
    } catch (error) {
        console.error("[health] la base de datos no responde:", error);
        return NextResponse.json({ status: "error" }, { status: 503, headers: NO_STORE });
    }
}
