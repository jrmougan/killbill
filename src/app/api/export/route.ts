import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getActiveGroup } from '@/lib/membership';
import { toEuros } from '@/lib/currency';
import { Prisma } from '@/generated/prisma/client';
import { escapeCsvField } from '@/lib/csv';
import { categoryKeyOf, CATEGORY_REF_SELECT } from '@/lib/category-read';

export async function GET(request: Request) {
    const session = await getSession();
    if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = session.userId as string;

    // Phase 4 selector switch: resolve my group via the Membership layer.
    const groupId = await getActiveGroup(userId);
    if (!groupId) return NextResponse.json({ error: 'No Couple' }, { status: 400 });

    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    // Only shared expenses belong to the couple export; personal expenses are private.
    const where: Prisma.ExpenseWhereInput = { coupleId: groupId, visibility: 'SHARED' };
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
        const fecha = e.date.toISOString().split('T')[0];
        const importe = toEuros(e.amount).toFixed(2);
        const miParte = e.splits.length > 0 ? toEuros(e.splits[0].amount).toFixed(2) : '';
        return [
            escapeCsvField(fecha),
            escapeCsvField(e.description),
            escapeCsvField(importe),
            escapeCsvField(categoryKeyOf(e)), // relational Category key (enum fallback)
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
            'Content-Disposition': 'attachment; filename=gastos.csv',
        },
    });
}
