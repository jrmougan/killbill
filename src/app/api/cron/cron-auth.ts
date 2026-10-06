import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

/** Compara el secreto en tiempo constante (evita timing attacks). */
export function secretMatches(provided: string | null, expected: string): boolean {
    if (!provided) return false;
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    // timingSafeEqual exige longitudes iguales; longitudes distintas => no coincide.
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
}

/**
 * Guard común de los endpoints /api/cron/*: header `x-cron-secret` contra la env
 * `CRON_SECRET`. Sin secreto configurado el endpoint queda deshabilitado (503);
 * con un secreto incorrecto, 401. Devuelve null cuando la llamada está autorizada.
 */
export function cronGuard(request: Request, disabledMessage: string): NextResponse | null {
    const expected = process.env.CRON_SECRET;
    if (!expected) {
        return NextResponse.json({ error: disabledMessage }, { status: 503 });
    }
    if (!secretMatches(request.headers.get("x-cron-secret"), expected)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return null;
}
