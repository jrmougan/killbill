import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { forbidden, notFound, requireSpace, route } from "@/lib/http";
import { idParams } from "@/lib/http/schemas";

export const GET = route(
    {
        auth: "user-or-guest",
        params: idParams,
        errorMessage: "Error al obtener el desglose del recibo",
        logLabel: "Error fetching receipt lines:",
    },
    async ({ ctx, params: { id } }) => {
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

        if (!expense) throw notFound("Gasto no encontrado");

        if (expense.visibility === "PERSONAL") {
            if (expense.ownerId !== ctx.userId) throw forbidden("No autorizado");
        } else {
            await requireSpace(ctx, expense.coupleId!, {
                allowGuest: true,
                allowArchived: true,
            });
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
    },
);
