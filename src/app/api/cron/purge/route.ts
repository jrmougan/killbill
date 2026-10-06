import { NextResponse } from "next/server";
import { unlink } from "fs/promises";
import { prisma } from "@/lib/db";
import { SpaceStatus } from "@/generated/prisma/enums";
import { cronGuard } from "../cron-auth";
import { uploadNameFromUrl, uploadPathCandidates } from "@/lib/uploads";

/**
 * Fase 5 — Purga de espacios efímeros archivados (OPCIONAL).
 *
 * DECISIÓN DE PRODUCTO (retención): en v1 los espacios EPHEMERAL ARCHIVED son
 * "recuerdo del viaje" en SOLO LECTURA e INDEFINIDO. **NO se auto-purgan.** Este
 * endpoint existe y es funcional, pero NO hay ningún scheduler que lo invoque
 * (ni Coolify cron ni GitHub Actions schedule). Queda listo para el día que se
 * decida purgar por RGPD, momento en el que bastaría con programar una llamada
 * periódica — no hay que tocar este código.
 *
 * Seguridad: protegido por el header `x-cron-secret`, que debe coincidir con la
 * env `CRON_SECRET`. Si `CRON_SECRET` no está configurada, el endpoint responde
 * 503 (deshabilitado): así, en un entorno sin el secreto, nadie puede disparar
 * borrados aunque conozca la ruta.
 *
 * Qué purga: espacios en estado ARCHIVED cuyo `archivedAt` es más antiguo que un
 * umbral (env `PURGE_ARCHIVED_AFTER_DAYS`, por defecto 90 días).
 *
 * Orden correcto (evita violar los FK Restrict de User→dinero de la Fase 4):
 *   1. Recolectar, ANTES de borrar, las `receiptUrl` de los gastos del espacio y
 *      los ids de los User sombra (invitados) miembros del espacio.
 *   2. Borrar el `Couple`: la cascada arrastra memberships, expenses, splits,
 *      settlements, ledger, tags/budgets/categories de grupo, invites, etc. Al
 *      desaparecer los gastos/liquidaciones del invitado, sus FK Restrict quedan
 *      libres.
 *   3. Borrar los User sombra que hayan quedado TOTALMENTE desligados (sin
 *      memberships ni ninguna referencia de dinero). El filtro defensivo evita
 *      que un Restrict aborte el borrado.
 *   4. Limpiar los ficheros subidos (UPLOAD_DIR y el legado public/uploads)
 *      asociados a esos recibos.
 *
 * Uso:
 *   curl -X POST https://finanzas.mougan.es/api/cron/purge \
 *        -H "x-cron-secret: $CRON_SECRET"
 *   # Simulación sin borrar nada (recomendado antes de purgar de verdad):
 *   curl -X POST "https://finanzas.mougan.es/api/cron/purge?dryRun=1" \
 *        -H "x-cron-secret: $CRON_SECRET"
 *
 * Nota: NO programar en v1 (default de retención = recuerdo indefinido).
 */

// Necesita fs (borrado de ficheros) → runtime Node.js, nunca cacheado.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_ARCHIVED_AFTER_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Umbral de retención en días (env, saneado). */
function archivedAfterDays(): number {
    const raw = process.env.PURGE_ARCHIVED_AFTER_DAYS;
    if (!raw) return DEFAULT_ARCHIVED_AFTER_DAYS;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0) return DEFAULT_ARCHIVED_AFTER_DAYS;
    return n;
}

export async function POST(request: Request) {
    // Sin secreto configurado el endpoint está deshabilitado por seguridad.
    const denied = cronGuard(request, "Purga deshabilitada: falta CRON_SECRET");
    if (denied) return denied;

    const dryRun = new URL(request.url).searchParams.has("dryRun");
    const days = archivedAfterDays();
    const cutoff = new Date(Date.now() - days * DAY_MS);

    // Espacios ARCHIVED cuyo archivedAt es anterior al umbral. archivedAt NULL no
    // matchea `lt` (se ignora), lo cual es correcto: sin fecha de archivado no se
    // purga.
    const spaces = await prisma.couple.findMany({
        where: { status: SpaceStatus.ARCHIVED, archivedAt: { lt: cutoff } },
        select: { id: true, name: true, archivedAt: true },
        orderBy: { archivedAt: "asc" },
    });

    const results: Array<{
        id: string;
        name: string | null;
        archivedAt: Date | null;
        deletedShadowUsers: number;
        deletedFiles: number;
        errored?: string;
    }> = [];

    let totalShadowUsers = 0;
    let totalFiles = 0;

    for (const space of spaces) {
        try {
            // 1. Recolectar ANTES de borrar: recibos + ids de invitados sombra.
            const [expensesWithReceipt, shadowMemberships] = await Promise.all([
                prisma.expense.findMany({
                    where: { coupleId: space.id, receiptUrl: { not: null } },
                    select: { receiptUrl: true },
                }),
                prisma.membership.findMany({
                    where: { groupId: space.id, user: { isGuest: true } },
                    select: { userId: true },
                }),
            ]);

            // Solo recibos locales (`/uploads/<nombre>`); basename neutraliza
            // cualquier path traversal (solo se borra dentro de los dirs de uploads).
            const uploadNames = expensesWithReceipt
                .map((e) => uploadNameFromUrl(e.receiptUrl))
                .filter((n): n is string => n !== null);
            const shadowUserIds = shadowMemberships.map((m) => m.userId);

            if (dryRun) {
                // No se borra nada; se reporta lo que se borraría.
                results.push({
                    id: space.id,
                    name: space.name,
                    archivedAt: space.archivedAt,
                    deletedShadowUsers: shadowUserIds.length,
                    deletedFiles: uploadNames.length,
                });
                totalShadowUsers += shadowUserIds.length;
                totalFiles += uploadNames.length;
                continue;
            }

            // 2 + 3 en UNA transacción: o se borran el espacio y sus User sombra
            //    juntos, o nada (un fallo a mitad no deja invitados huérfanos con
            //    el espacio ya borrado, ni al revés).
            const deletedShadowUsers = await prisma.$transaction(async (tx) => {
                // 2. Borrar el espacio (cascada de todo su historial).
                await tx.couple.delete({ where: { id: space.id } });

                // 3. Borrar los User sombra que quedaron completamente desligados.
                //    El filtro defensivo evita que un FK Restrict (Fase 4, y
                //    Split.userId) aborte: solo se borra si ya no tiene NINGUNA
                //    referencia de dinero ni membership.
                if (shadowUserIds.length === 0) return 0;
                const del = await tx.user.deleteMany({
                    where: {
                        id: { in: shadowUserIds },
                        isGuest: true,
                        memberships: { none: {} },
                        expensesPaid: { none: {} },
                        expensesOwned: { none: {} },
                        splits: { none: {} },
                        settlementsPaid: { none: {} },
                        settlementsReceived: { none: {} },
                        accounts: { none: {} },
                    },
                });
                return del.count;
            });

            // 4. Limpiar los ficheros de recibos. No es transaccional; un fichero
            //    ya inexistente (ENOENT) no es un error.
            let deletedFiles = 0;
            for (const name of uploadNames) {
                let deleted = false;
                // Dir actual y legado (public/uploads) mientras no se migren.
                for (const p of uploadPathCandidates(name)) {
                    try {
                        await unlink(p);
                        deleted = true;
                    } catch (err) {
                        const code = (err as NodeJS.ErrnoException).code;
                        if (code !== "ENOENT") {
                            console.error(`[cron/purge] no se pudo borrar ${p}:`, err);
                        }
                    }
                }
                if (deleted) deletedFiles += 1;
            }

            totalShadowUsers += deletedShadowUsers;
            totalFiles += deletedFiles;
            results.push({
                id: space.id,
                name: space.name,
                archivedAt: space.archivedAt,
                deletedShadowUsers,
                deletedFiles,
            });
        } catch (err) {
            console.error(`[cron/purge] fallo al purgar el espacio ${space.id}:`, err);
            results.push({
                id: space.id,
                name: space.name,
                archivedAt: space.archivedAt,
                deletedShadowUsers: 0,
                deletedFiles: 0,
                errored: err instanceof Error ? err.message : "error desconocido",
            });
        }
    }

    return NextResponse.json({
        dryRun,
        cutoff: cutoff.toISOString(),
        archivedAfterDays: days,
        purgedSpaces: dryRun ? 0 : results.filter((r) => !r.errored).length,
        candidateSpaces: spaces.length,
        deletedShadowUsers: totalShadowUsers,
        deletedFiles: totalFiles,
        spaces: results,
    });
}
