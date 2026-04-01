import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { toEuros } from '@/lib/currency';

function escapeCsvField(value: string | null | undefined): string {
    if (value === null || value === undefined) return '';
    const str = String(value);
    // Wrap in quotes if the field contains commas, quotes, or newlines
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

export async function GET(request: Request) {
    const session = await getSession();
    if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = session.userId as string;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.coupleId) return NextResponse.json({ error: 'No Couple' }, { status: 400 });

    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    const where: any = { coupleId: user.coupleId };
    if (from || to) {
        where.date = {};
        if (from) where.date.gte = new Date(from);
        if (to) {
            const toDate = new Date(to);
            toDate.setDate(toDate.getDate() + 1); // inclusive end date
            where.date.lt = toDate;
        }
    }

    const expenses = await prisma.expense.findMany({
        where,
        include: {
            paidBy: { select: { name: true } },
            splits: {
                where: { userId },
                select: { amount: true },
            },
        },
        orderBy: { date: 'asc' },
    });

    const header = ['fecha', 'descripcion', 'importe', 'categoria', 'pagado_por', 'mi_parte', 'notas'].join(',');

    const rows = expenses.map((e: any) => {
        const fecha = e.date.toISOString().split('T')[0];
        const importe = toEuros(e.amount).toFixed(2);
        const miParte = e.splits.length > 0 ? toEuros(e.splits[0].amount).toFixed(2) : '';
        return [
            escapeCsvField(fecha),
            escapeCsvField(e.description),
            escapeCsvField(importe),
            escapeCsvField(e.category),
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
