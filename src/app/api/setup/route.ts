import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { HttpError, readJson, toErrorResponse, validate } from "@/lib/http";
import { jsonObject } from "@/lib/http/schemas";

const SETUP_DONE = "Ya existen usuarios. El setup ya fue completado.";
const INVALID_BODY = "Cuerpo de la petición no válido";

class SetupAlreadyDone extends Error {}

const trimmedOrEmpty = z.unknown().optional().transform((v) => (typeof v === "string" ? v.trim() : ""));

/**
 * {name, email, password}. Same checks and order as always: any field missing
 * (a non-string name/email counts as missing) → then the password must be a
 * string of ≥ 8 characters.
 */
const SetupBody = jsonObject({ name: trimmedOrEmpty, email: trimmedOrEmpty, password: z.unknown().optional() }, INVALID_BODY)
    .superRefine(({ name, email, password }, ctx) => {
        if (!name || !email || !password) {
            ctx.addIssue({ code: "custom", message: "Se requiere nombre, email y contraseña" });
        } else if (typeof password !== "string" || password.length < 8) {
            ctx.addIssue({ code: "custom", path: ["password"], message: "La contraseña debe tener al menos 8 caracteres" });
        }
    })
    .transform(({ name, email, password }) => ({ name, email, password: password as string }));

const setupDone = () => new HttpError(403, SETUP_DONE);

// Public bootstrap routes: no session involved, so they don't go through route()
// (which would resolve one); errors still map through toErrorResponse.

// POST: Setup first admin user (only works if no users exist)
export async function POST(request: Request) {
    try {
        // Cheap early exit (no hashing work) once the instance is set up. The
        // authoritative check is repeated inside the transaction below.
        if ((await prisma.user.count()) > 0) throw setupDone();

        let raw: unknown;
        try {
            raw = await readJson(request);
        } catch {
            throw new HttpError(400, INVALID_BODY);
        }
        const { name, email, password } = validate(SetupBody, raw);

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Atomic "count then create": SERIALIZABLE makes the COUNT take shared
        // locks on the (empty) User index, so two concurrent bootstraps cannot
        // both see 0 and both insert — InnoDB aborts one of them (deadlock /
        // write conflict), which is then reported as "setup already done".
        let admin: { id: string; name: string; email: string | null };
        try {
            admin = await prisma.$transaction(
                async (tx) => {
                    if ((await tx.user.count()) > 0) throw new SetupAlreadyDone();
                    return tx.user.create({
                        data: {
                            name,
                            email,
                            password: hashedPassword,
                            isAdmin: true,
                            avatar: "👑",
                        },
                        select: { id: true, name: true, email: true },
                    });
                },
                { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
            );
        } catch (error) {
            if (error instanceof SetupAlreadyDone) throw setupDone();
            // Lost a race against a concurrent bootstrap: the winner's row exists.
            if ((await prisma.user.count()) > 0) throw setupDone();
            throw error;
        }

        return NextResponse.json({
            success: true,
            message: "Usuario administrador creado. Ahora puedes iniciar sesión.",
            user: admin,
        });
    } catch (error) {
        return toErrorResponse(error, { fallbackMessage: "Error interno", logLabel: "Setup Error:" });
    }
}

// GET: Check if setup is needed (public: never reveals how many users exist).
export async function GET() {
    try {
        const userCount = await prisma.user.count();

        return NextResponse.json({ setupRequired: userCount === 0 });
    } catch (error) {
        return toErrorResponse(error, { fallbackMessage: "Error interno", logLabel: "Setup check error:" });
    }
}
