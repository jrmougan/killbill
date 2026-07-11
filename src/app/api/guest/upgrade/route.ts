import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { getSessionCtx } from "@/lib/authz";
import { signToken } from "@/lib/auth";
import { ephemeralSpacesEnabled } from "@/lib/flags";
import { MembershipRole } from "@/generated/prisma/enums";

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

export async function POST(request: Request) {
    if (!ephemeralSpacesEnabled()) {
        return NextResponse.json(
            { error: "Los espacios efímeros no están habilitados", code: "FEATURE_DISABLED" },
            { status: 403 },
        );
    }

    const ctx = await getSessionCtx();
    // Only a live guest session may upgrade. getSessionCtx already revalidated the
    // guest membership against the DB, so a revoked guest is rejected here.
    if (!ctx || ctx.kind !== "guest" || !ctx.groupId) {
        return NextResponse.json({ error: "Solo un invitado puede convertir su cuenta" }, { status: 403 });
    }

    let body: { email?: unknown; password?: unknown };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
    }

    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!email || !password) {
        return NextResponse.json({ error: "Email y contraseña obligatorios" }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return NextResponse.json({ error: "Email inválido" }, { status: 400 });
    }
    if (password.length < 8) {
        return NextResponse.json({ error: "La contraseña debe tener al menos 8 caracteres" }, { status: 400 });
    }

    const hashed = await bcrypt.hash(password, 10);

    let updated: { id: string; email: string | null; isAdmin: boolean };
    try {
        updated = await prisma.$transaction(async (tx) => {
            // Guard against a double-upgrade / non-guest row (idempotency + safety).
            const user = await tx.user.findUnique({
                where: { id: ctx.userId },
                select: { id: true, isGuest: true },
            });
            if (!user || !user.isGuest) {
                throw new Error("NOT_A_GUEST");
            }

            const u = await tx.user.update({
                where: { id: ctx.userId },
                data: { email, password: hashed, isGuest: false, upgradedAt: new Date() },
                select: { id: true, email: true, isAdmin: true },
            });

            // Promote the GUEST membership to a full MEMBER in its space.
            await tx.membership.updateMany({
                where: { userId: ctx.userId, groupId: ctx.groupId, role: MembershipRole.GUEST },
                data: { role: MembershipRole.MEMBER, guestTokenHash: null },
            });

            return u;
        });
    } catch (e) {
        if (e instanceof Error && e.message === "NOT_A_GUEST") {
            return NextResponse.json({ error: "Esta cuenta ya no es de invitado" }, { status: 409 });
        }
        // Prisma unique-constraint violation on email.
        if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") {
            return NextResponse.json(
                { error: "Ese email ya tiene cuenta: inicia sesión", code: "EMAIL_TAKEN" },
                { status: 409 },
            );
        }
        console.error("Error al convertir invitado en cuenta:", e);
        return NextResponse.json({ error: "No se pudo crear la cuenta" }, { status: 500 });
    }

    // Swap the 72h guest session for a normal 7d one.
    const token = await signToken({ userId: updated.id, email: updated.email, isAdmin: updated.isAdmin });
    const cookieStore = await cookies();
    cookieStore.set("session_token", token, SESSION_COOKIE);
    cookieStore.delete("user_id");

    return NextResponse.json({ success: true, groupId: ctx.groupId });
}
