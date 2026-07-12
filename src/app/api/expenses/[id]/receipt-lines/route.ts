import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionCtx, requireSpaceAccess } from "@/lib/authz";

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    const ctx = await getSessionCtx();
    if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const expense = await prisma.expense.findUnique({
            where: { id },
            select: {
                id: true,
                visibility: true,
                ownerId: true,
                coupleId: true,
                lineItems: { orderBy: { position: "asc" } },
            },
        });

        if (!expense) {
            return NextResponse.json({ error: "Gasto no encontrado" }, { status: 404 });
        }

        if (expense.visibility === "PERSONAL") {
            if (expense.ownerId !== ctx.userId) {
                return NextResponse.json({ error: "No autorizado" }, { status: 403 });
            }
        } else {
            const auth = await requireSpaceAccess(ctx, expense.coupleId!, {
                allowGuest: true,
                allowArchived: true,
            });
            if (!auth.ok) {
                return NextResponse.json(
                    { error: auth.error, code: auth.code },
                    { status: auth.status },
                );
            }
        }

        return NextResponse.json({
            expenseId: expense.id,
            items: expense.lineItems.map((l) => ({
                description: l.description,
                quantity: l.quantity,
                unitPriceCents: l.unitPrice,
                lineTotalCents: l.lineTotal,
                position: l.position,
                assignedToId: l.assignedToId,
            })),
        });
    } catch (error) {
        console.error("Error fetching receipt lines:", error);
        return NextResponse.json(
            { error: "Error al obtener el desglose del recibo" },
            { status: 500 },
        );
    }
}
