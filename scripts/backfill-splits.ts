/**
 * Fase 0.5 backfill — materializa filas Split para gastos SHARED históricos que
 * no tengan ninguna (§2.2 / §3 del plan de espacios).
 *
 * POR QUÉ: cuando un Expense SHARED no tiene filas Split, finance.ts lo re-divide
 * EN CADA LECTURA a partes iguales entre los miembros ACTIVE del MOMENTO
 * (`calculateBalances`, rama sin splits). En cuanto la pertenencia cambie
 * (rotación de miembros, invitados), ese reparto "flotante" diverge del ledger de
 * doble entrada, que ya congeló las entradas por gasto. Materializar los Split
 * ahora CONGELA el reparto actual y elimina la divergencia. Bloqueante antes de
 * abrir rotación de miembros (Fase 3); verificar después con reconcile-ledger.ts.
 *
 * QUÉ REPARTO: exactamente el que finance.ts computa hoy para un gasto sin splits
 * = división a partes iguales sobre los miembros ACTIVE en orden getGroupMembers
 * (joinedAt asc, userId asc), con el/los céntimo(s) de resto al/los primer(os)
 * miembro(s). Reutilizamos `calculateSplitAmounts(amount, null, members)` de
 * src/lib/splits.ts, que produce ese mismo reparto byte a byte (misma fórmula que
 * finance.ts y que computeExpenseEntries del ledger). Pasamos receiptData=null a
 * propósito: NO reinterpretamos ítems de ticket (eso cambiaría los balances
 * respecto a lo que finance/ledger ya muestran); el objetivo es CONGELAR, no
 * recalcular.
 *
 * IDEMPOTENCIA: solo toca gastos SHARED con CERO Split. Una re-ejecución los
 * encuentra ya con Splits y los salta. Verifica que Σsplits === amount antes de
 * escribir (garantía de calculateSplitAmounts) y salta grupos sin miembros ACTIVE.
 *
 * DRY-RUN por defecto: SELECT + log de qué crearía y NO escribe. `--apply` ejecuta.
 *
 * Run (dry-run):  npx tsx scripts/backfill-splits.ts
 * Run (apply):    npx tsx scripts/backfill-splits.ts --apply
 */
import { prisma } from '../src/lib/db';
import { getGroupMembers } from '../src/lib/membership';
import { calculateSplitAmounts } from '../src/lib/splits';

const APPLY = process.argv.includes('--apply');

async function main() {
  const couples = await prisma.couple.findMany({ select: { id: true, name: true } });

  let expensesPlanned = 0;
  let splitsPlanned = 0;
  let expensesWritten = 0;
  let skippedNoMembers = 0;
  let skippedBadSum = 0;

  for (const couple of couples) {
    // SHARED sin ninguna fila Split — candidatos a materializar.
    const expenses = await prisma.expense.findMany({
      where: { coupleId: couple.id, visibility: 'SHARED', splits: { none: {} } },
      select: { id: true, amount: true, description: true, splitStrategy: true },
    });
    if (expenses.length === 0) continue;

    // Miembros ACTIVE en el ORDEN load-bearing (mismo que finance.ts usa para el
    // reparto del resto). Si el grupo no tiene miembros ACTIVE, no podemos repartir
    // de forma consistente con finance.ts — saltar y avisar.
    const members = await getGroupMembers(couple.id);
    if (members.length === 0) {
      console.warn(`  SKIP grupo ${couple.id} "${couple.name ?? ''}": ${expenses.length} gastos sin splits pero SIN miembros ACTIVE.`);
      skippedNoMembers += expenses.length;
      continue;
    }

    console.log(`\nGrupo ${couple.id} "${couple.name ?? '(sin nombre)'}": ${expenses.length} gastos SHARED sin Split, ${members.length} miembros ACTIVE.`);

    for (const e of expenses) {
      // Mismo reparto que finance.ts (equal split, resto a los primeros miembros).
      const splits = calculateSplitAmounts(e.amount, null, members);
      const sum = splits.reduce((acc, s) => acc + s.amount, 0);
      if (sum !== e.amount) {
        // No debería ocurrir (equal split siempre cuadra); defensivo.
        console.warn(`  SKIP gasto ${e.id} "${e.description}": Σsplits=${sum} != amount=${e.amount}.`);
        skippedBadSum++;
        continue;
      }
      expensesPlanned++;
      splitsPlanned += splits.length;
      console.log(`  ${e.id} "${e.description}" amount=${e.amount} → ${splits.map((s) => `${s.userId}:${s.amount}`).join(' ')}`);

      if (APPLY) {
        // Transaccional + createMany. Idempotente por el filtro splits:{none:{}}
        // (este gasto no tenía splits); el UNIQUE(expenseId,userId) protege de
        // duplicados si dos pasadas se solaparan.
        await prisma.$transaction(async (tx) => {
          await tx.split.createMany({
            data: splits.map((s) => ({ expenseId: e.id, userId: s.userId, amount: s.amount })),
          });
          // Registrar cómo se derivó el reparto (era null en el histórico). EQUAL
          // describe exactamente lo materializado; solo lo fijamos si seguía null.
          if (e.splitStrategy === null) {
            await tx.expense.update({ where: { id: e.id }, data: { splitStrategy: 'EQUAL' } });
          }
        });
        expensesWritten++;
      }
    }
  }

  console.log(
    `\n${APPLY ? 'APPLY' : 'DRY-RUN'}: ${expensesPlanned} gastos / ${splitsPlanned} filas Split ` +
    `${APPLY ? `materializadas (${expensesWritten} escritos)` : 'se materializarían'}. ` +
    `Saltados: ${skippedNoMembers} sin miembros, ${skippedBadSum} por suma incoherente.`,
  );
  if (!APPLY && expensesPlanned > 0) {
    console.log('Re-ejecuta con --apply para escribir. Después corre scripts/reconcile-ledger.ts (debe seguir PASS).');
  }
}

main()
  .catch((err) => {
    console.error('Backfill splits falló:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
