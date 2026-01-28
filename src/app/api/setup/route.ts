import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";

// POST: Setup first admin user (only works if no users exist)
export async function POST(request: Request) {
    try {
        // Check if any users exist
        const userCount = await prisma.user.count();

        if (userCount > 0) {
            return NextResponse.json(
                { error: "Ya existen usuarios. El setup ya fue completado." },
                { status: 403 }
            );
        }

        const body = await request.json();
        const { name, email, password } = body;

        if (!name || !email || !password) {
            return NextResponse.json(
                { error: "Se requiere nombre, email y contraseña" },
                { status: 400 }
            );
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create admin user
        const admin = await prisma.user.create({
            data: {
                name,
                email,
                password: hashedPassword,
                isAdmin: true,
                avatar: "👑",
            },
        });

        return NextResponse.json({
            success: true,
            message: "Usuario administrador creado. Ahora puedes iniciar sesión.",
            user: { id: admin.id, name: admin.name, email: admin.email },
        });

    } catch (error) {
        console.error("Setup Error:", error);
        return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }
}

// GET: Check if setup is needed
export async function GET() {
    try {
        const userCount = await prisma.user.count();

        return NextResponse.json({
            setupRequired: userCount === 0,
            userCount,
        });
    } catch (error) {
        console.error("Setup check error:", error);
        return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }
}
