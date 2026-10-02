import { createConnection } from 'mariadb';

interface PersistedReceipt {
  amount: number;
  description: string;
  paidById: string;
  receiptUrl: string | null;
  splits: { userId: string; amount: number }[];
  lineItems: { description: string; quantity: number; unitPrice: number; lineTotal: number; assignedToId: string | null }[];
}

/** Read committed DB values without importing Prisma's ESM-generated client into Playwright's CJS worker. */
export async function readPersistedReceipt(expenseId: string): Promise<PersistedReceipt> {
  const connection = await createConnection({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT) || 3306,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
  });
  try {
    const expenses = await connection.query<Pick<PersistedReceipt, 'amount' | 'description' | 'paidById' | 'receiptUrl'>[]>(
      'SELECT amount, description, paidById, receiptUrl FROM Expense WHERE id = ?', [expenseId],
    );
    if (expenses.length !== 1) throw new Error('Expected one committed OCR expense');
    const splits = await connection.query<PersistedReceipt['splits']>(
      'SELECT userId, amount FROM Split WHERE expenseId = ? ORDER BY userId', [expenseId],
    );
    const lineItems = await connection.query<PersistedReceipt['lineItems']>(
      'SELECT description, quantity, unitPrice, lineTotal, assignedToId FROM ReceiptLineItem WHERE expenseId = ? ORDER BY position', [expenseId],
    );
    return { ...expenses[0], splits: Array.from(splits), lineItems: Array.from(lineItems) };
  } finally {
    await connection.end();
  }
}
