import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { z } from 'zod';
import { getActiveGroup } from '@/lib/membership';
import { toEuros } from '@/lib/currency';
import { Prisma } from '@/generated/prisma/client';
import { escapeCsvField } from '@/lib/csv';
import { categoryLabelOf, CATEGORY_REF_SELECT } from '@/lib/category-read';
import { APP_TZ } from '@/lib/home-format';
import { badRequest, requireSpace, route } from '@/lib/http';

// en-CA formats as YYYY-MM-DD.
const madridDate = new Intl.DateTimeFormat('en-CA', { timeZone: APP_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Optional date bound (anything `new Date()` parses); "" counts as absent. */
const dateBound = z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => v === undefined || !Number.isNaN(new Date(v).getTime()), 'Fecha inválida');

const ExportQuery = z.object({
    scope: z.string().optional(),
    from: dateBound,
    to: dateBound,
});

// auth 'user': 401 'Unauthorized' (legacy wording) and guests → 403 — they have no
// personal economy and export is a member-only action. The response is CSV, not JSON.
export const GET = route(
    {
        auth: 'user',
        query: ExportQuery,
        unauthorizedMessage: 'Unauthorized',
        errorMessage: 'Error al exportar los gastos',
        logLabel: 'Error exporting expenses:',
    },
    async ({ ctx, query: { scope, from, to } }) => {
        const userId = ctx.userId;

        // Personal export (`?scope=personal`): the caller's PERSONAL expenses — works
        // without any space. Shared (default): the active space's SHARED expenses.
        const personal = scope === 'personal';

        let where: Prisma.ExpenseWhereInput;
        if (personal) {
            where = { ownerId: userId, visibility: 'PERSONAL' };
        } else {
            // Phase 4 selector switch: resolve my group via the Membership layer.
            const groupId = await getActiveGroup(userId);
            if (!groupId) throw badRequest('No tienes ningún espacio activo');

            // Fase 1: authorize against the resolved group (ACTIVE membership). Export is a
            // read-only view — allowArchived so an archived "recuerdo del viaje" can still
            // be exported. Guests are denied (export is a member-only action).
            await requireSpace(ctx, groupId, { allowArchived: true });

            // Only shared expenses belong to the space export; personal expenses are private.
            where = { coupleId: groupId, visibility: 'SHARED' };
        }

        if (from || to) {
            const dateFilter: Prisma.DateTimeFilter = {};
            if (from) dateFilter.gte = new Date(from);
            if (to) {
                const toDate = new Date(to);
                toDate.setDate(toDate.getDate() + 1); // inclusive end date
                dateFilter.lt = toDate;
            }
            where.date = dateFilter;
        }

        const expenses = await prisma.expense.findMany({
            where,
            include: {
                paidBy: { select: { name: true } },
                splits: {
                    where: { userId },
                    select: { amount: true },
                },
                ...CATEGORY_REF_SELECT,
            },
            orderBy: { date: 'asc' },
        });

        const header = ['fecha', 'descripcion', 'importe', 'categoria', 'pagado_por', 'mi_parte', 'notas'].join(',');

        const rows = expenses.map((e) => {
            const fecha = madridDate.format(e.date); // YYYY-MM-DD in the app timezone
            const importe = toEuros(e.amount).toFixed(2);
            const miParte = personal
                ? importe
                : e.splits.length > 0 ? toEuros(e.splits[0].amount).toFixed(2) : '';
            return [
                escapeCsvField(fecha),
                escapeCsvField(e.description),
                escapeCsvField(importe),
                escapeCsvField(categoryLabelOf(e)), // DB-driven Category label (custom names surface, not raw keys)
                escapeCsvField(e.paidBy.name),
                escapeCsvField(miParte),
                escapeCsvField(e.notes),
            ].join(',');
        });

        const csv = [header, ...rows].join('\n');

        return new NextResponse(csv, {
            status: 200,
            headers: {
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': `attachment; filename=${personal ? 'gastos-personales.csv' : 'gastos.csv'}`,
            },
        });
    },
);
