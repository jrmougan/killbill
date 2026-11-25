import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { signToken } from "@/lib/auth";
import { ephemeralSpacesEnabled } from "@/lib/flags";
import { MembershipRole } from "@/generated/prisma/enums";
import { conflict, forbidden, parseJson, route } from "@/lib/http";
import { jsonObject } from "@/lib/http/schemas";

/**
 * Convert a guest (shadow user) into a real account (Fase 3).
 *
 * Operates on the SAME User row (`isGuest→false`, `upgradedAt=now`, email +
 * hashed password set) and promotes its GUEST membership to MEMBER, so every
 * Split/Settlement/LedgerEntry already attached to the guest carries over
 * untouched — no identity merge, no ledger rewrite. A normal 7d session replaces
 * the 72h guest session.
 *
 * v1 limitation (product #7): if the email already belongs to another account,
 * the unique constraint (P2002) surfaces as "inicia sesión" — no merge.
 */
const SESSION_COOKIE = {
    httpOnly: true as const,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 7 * 24 * 60 * 60, // 7 days
};

const INVALID_BODY = "Cuerpo inválido";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * {email, password}. A non-string field counts as missing; the checks run in the
 * historical order (missing → email format → password length) so the first
 * message is the one clients always got.
 */
const UpgradeBody = jsonObject(
    {
        email: z.unknown().optional().transform((v) => (typeof v === "string" ? v.trim().toLowerCase() : "")),
        password: z.unknown().optional().transform((v) => (typeof v === "string" ? v : "")),
    },
    INVALID_BODY,
).superRefine(({ email, password }, ctx) => {
    if (!email || !password) {
        ctx.addIssue({ code: "custom", message: "Email y contraseña obligatorios" });
    } else if (!EMAIL_RE.test(email)) {
        ctx.addIssue({ code: "custom", path: ["email"], message: "Email inválido" });
    } else if (password.length < 8) {
        ctx.addIssue({ code: "custom", path: ["password"], message: "La contraseña debe tener al menos 8 caracteres" });
    }
});

// auth 'public': the guest gate is the route's own (403, never 401, for anyone
// who is not a live guest), checked after the feature flag.
export const POST = route(
    { auth: "public", errorMessage: "No se pudo crear la cuenta", logLabel: "Error al convertir invitado en cuenta:" },
    async ({ req, ctx }) => {
        if (!ephemeralSpacesEnabled()) {
            throw forbidden("Los espacios efímeros no están habilitados", "FEATURE_DISABLED");
        }

        // Only a live guest session may upgrade. getSessionCtx already revalidated the
        // guest membership against the DB, so a revoked guest is rejected here.
        if (!ctx || ctx.kind !== "guest" || !ctx.groupId) {
            throw forbidden("Solo un invitado puede convertir su cuenta");
        }
        const { userId, groupId } = ctx;

        const { email, password } = await parseJson(req, UpgradeBody, { invalidMessage: INVALID_BODY });

        const hashed = await bcrypt.hash(password, 10);

        let updated: { id: string; email: string | null; isAdmin: boolean; tokenVersion: number };
        try {
            updated = await prisma.$transaction(async (tx) => {
                // Guard against a double-upgrade / non-guest row (idempotency + safety).
                const user = await tx.user.findUnique({
                    where: { id: userId },
                    select: { id: true, isGuest: true },
                });
                if (!user || !user.isGuest) {
                    throw new Error("NOT_A_GUEST");
                }

                const u = await tx.user.update({
                    where: { id: userId },
                    data: { email, password: hashed, isGuest: false, upgradedAt: new Date() },
                    select: { id: true, email: true, isAdmin: true, tokenVersion: true },
                });

                // Promote the GUEST membership to a full MEMBER in its space.
                await tx.membership.updateMany({
                    where: { userId, groupId, role: MembershipRole.GUEST },
                    data: { role: MembershipRole.MEMBER, guestTokenHash: null },
                });

                return u;
            });
        } catch (e) {
            if (e instanceof Error && e.message === "NOT_A_GUEST") {
                throw conflict("Esta cuenta ya no es de invitado");
            }
            // Prisma unique-constraint violation on email.
            if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") {
                throw conflict("Ese email ya tiene cuenta: inicia sesión", "EMAIL_TAKEN");
            }
            throw e; // → 500 "No se pudo crear la cuenta", logged by route()
        }

        // Swap the 72h guest session for a normal 7d one.
        const token = await signToken({
            userId: updated.id,
            email: updated.email,
            isAdmin: updated.isAdmin,
            tv: updated.tokenVersion,
        });
        const cookieStore = await cookies();
        cookieStore.set("session_token", token, SESSION_COOKIE);
        cookieStore.delete("user_id");

        return NextResponse.json({ success: true, groupId });
    },
);
