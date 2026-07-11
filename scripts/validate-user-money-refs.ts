/**
 * Fase 4 pre-flight para 20260711xxxxxx_restrict_user_money_cascades. READ-ONLY.
 *
 * La migración cambia de `Cascade` a `Restrict` (desde `User`) las FKs que atan la
 * contabilidad a una persona:
 *   Expense.paidById  · Expense.ownerId
 *   Settlement.fromUserId · Settlement.toUserId
 *   Account.userId  (red de seguridad del ledger: LedgerEntry cuelga de Account,
 *                    no de User, así que restringir Account.userId impide borrar un
 *                    User con actividad de ledger sin tocar LedgerEntry)
 *
 * POR QUÉ este pre-vuelo: en MySQL, cambiar la acción `onDelete` de una FK se hace
 * con DROP FOREIGN KEY + ADD FOREIGN KEY, y **ADD CONSTRAINT ... FOREIGN KEY valida
 * TODAS las filas existentes**. Si una `Expense.paidById` (u otra columna) apunta a
 * un `User.id` que ya no existe (referencia huérfana), el `ADD` falla y la migración
 * aborta. Este script cuenta esas huérfanas ANTES para que la migración no rompa el
 * deploy (el contenedor anterior seguiría sirviendo, pero mejor saberlo aquí).
 *
 * SALIDA: exit != 0 si hay CUALQUIER referencia huérfana (bloquea la migración).
 *
 * INFORMATIVO (no afecta el exit code): nº de Users con actividad monetaria — los
 * que, tras la migración, YA NO se podrán borrar físicamente (el `Restrict` los
 * protege). Sirve para dimensionar el cambio de semántica (baja = REMOVED/anonimizar,
 * nunca DELETE físico — §2.3 del plan de espacios).
 *
 * Run:  npx tsx scripts/validate-user-money-refs.ts
 */
import { prisma } from '../src/lib/db';

interface OrphanCheck {
    label: string;
    // columna FK que pasará a Restrict desde User
    column: string;
    count: number;
}

// Cuenta filas de `table.column` (NOT NULL en el modelo) cuyo valor no existe en
// User.id — es decir, referencias que romperían el ADD FOREIGN KEY con Restrict.
async function countOrphans(table: string, column: string): Promise<number> {
    const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT COUNT(*) AS n FROM \`${table}\` t
         LEFT JOIN \`User\` u ON u.\`id\` = t.\`${column}\`
         WHERE t.\`${column}\` IS NOT NULL AND u.\`id\` IS NULL`,
    );
    return Number(rows[0]?.n ?? 0);
}

async function main() {
    const checks: OrphanCheck[] = [
        { label: 'Expense.paidById → User', column: 'paidById', count: await countOrphans('Expense', 'paidById') },
        { label: 'Expense.ownerId → User', column: 'ownerId', count: await countOrphans('Expense', 'ownerId') },
        { label: 'Settlement.fromUserId → User', column: 'fromUserId', count: await countOrphans('Settlement', 'fromUserId') },
        { label: 'Settlement.toUserId → User', column: 'toUserId', count: await countOrphans('Settlement', 'toUserId') },
        { label: 'Account.userId → User', column: 'userId', count: await countOrphans('Account', 'userId') },
    ];

    let failed = false;
    for (const c of checks) {
        const status = c.count === 0 ? 'OK  ' : 'FAIL';
        console.log(`${status}  ${c.label.padEnd(32)} huérfanas=${c.count}`);
        if (c.count > 0) failed = true;
    }

    // Informativo: Users con actividad monetaria (quedan protegidos por Restrict).
    const active = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT COUNT(*) AS n FROM (
            SELECT \`paidById\`   AS uid FROM \`Expense\`
            UNION SELECT \`ownerId\`     FROM \`Expense\`
            UNION SELECT \`fromUserId\`  FROM \`Settlement\`
            UNION SELECT \`toUserId\`    FROM \`Settlement\`
            UNION SELECT \`userId\`      FROM \`Account\`
         ) AS money_users WHERE uid IS NOT NULL`,
    );
    const protectedUsers = Number(active[0]?.n ?? 0);
    console.log(`INFO  Users con actividad monetaria (tras la migración NO borrables) = ${protectedUsers}`);

    if (failed) {
        console.error(
            '\nVALIDACIÓN FALLIDA — hay referencias huérfanas. NO apliques ' +
            'restrict_user_money_cascades hasta repararlas (el ADD FOREIGN KEY las validaría y fallaría).',
        );
        process.exit(1);
    }
    console.log('\nSin huérfanas — seguro aplicar restrict_user_money_cascades (el ADD FOREIGN KEY validará OK).');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
