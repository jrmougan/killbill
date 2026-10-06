import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { Prisma } from "@/generated/prisma/client";

const SETUP_DONE = "Ya existen usuarios. El setup ya fue completado.";

class SetupAlreadyDone extends Error {}

// POST: Setup first admin user (only works if no users exist)
export async function POST(request: Request) {
    try {
        // Cheap early exit (no hashing work) once the instance is set up. The
        // authoritative check is repeated inside the transaction below.
        if ((await prisma.user.count()) > 0) {
            return NextResponse.json({ error: SETUP_DONE }, { status: 403 });
        }

        let body: { name?: unknown; email?: unknown; password?: unknown };
        try {
            body = await request.json();
        } catch {
            return NextResponse.json({ error: "Cuerpo de la petición no válido" }, { status: 400 });
        }
        const name = typeof body?.name === "string" ? body.name.trim() : "";
        const email = typeof body?.email === "string" ? body.email.trim() : "";
        const password = body?.password;

        if (!name || !email || !password) {
            return NextResponse.json(
                { error: "Se requiere nombre, email y contraseña" },
                { status: 400 }
            );
        }

        if (typeof password !== "string" || password.length < 8) {
            return NextResponse.json(
                { error: "La contraseña debe tener al menos 8 caracteres" },
                { status: 400 }
            );
        }

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
            if (error instanceof SetupAlreadyDone) {
                return NextResponse.json({ error: SETUP_DONE }, { status: 403 });
            }
            // Lost a race against a concurrent bootstrap: the winner's row exists.
            if ((await prisma.user.count()) > 0) {
                return NextResponse.json({ error: SETUP_DONE }, { status: 403 });
            }
            throw error;
        }

        return NextResponse.json({
            success: true,
            message: "Usuario administrador creado. Ahora puedes iniciar sesión.",
            user: admin,
        });

    } catch (error) {
        console.error("Setup Error:", error);
        return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }
}

// GET: Check if setup is needed (public: never reveals how many users exist).
export async function GET() {
    try {
        const userCount = await prisma.user.count();

        return NextResponse.json({ setupRequired: userCount === 0 });
    } catch (error) {
        console.error("Setup check error:", error);
        return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }
}
