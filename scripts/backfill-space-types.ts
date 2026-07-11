/**
 * Fase 0.5 backfill — clasifica el tipo de cada espacio (Couple.type).
 *
 * Regla (heurística de arranque, §2.2 / §3 del plan de espacios):
 *   - type = GROUP   donde COUNT(Membership status=ACTIVE) > 2
 *   - type = COUPLE  el resto (queda el DEFAULT del schema; nunca lo tocamos)
 *
 * El tipo se elige explícitamente al crear un espacio y NUNCA se infiere del
 * número de miembros en runtime; esta heurística existe SOLO para clasificar el
 * histórico previo a la feature (todos los espacios nacen COUPLE por DEFAULT).
 * Los grupos de 1-2 miembros quedan como COUPLE aunque fueran grupos nacientes;
 * el escape es la acción de producto "Convertir en grupo" (COUPLE→GROUP).
 *
 * SEGURIDAD / IDEMPOTENCIA:
 *   - Solo considera espacios que siguen en el DEFAULT `type = COUPLE`. Así una
 *     re-ejecución no pisa clasificaciones ya hechas (GROUP/EPHEMERAL/INDIVIDUAL
 *     puestas a mano o por código nuevo), y converger es estable: tras --apply
 *     los >2 pasan a GROUP y una segunda pasada no encuentra nada que cambiar.
 *   - DRY-RUN por defecto: hace SELECT + log de cuántas filas cambiaría y NO
 *     escribe. Pasa `--apply` para ejecutar el UPDATE.
 *
 * Run (dry-run):  npx tsx scripts/backfill-space-types.ts
 * Run (apply):    npx tsx scripts/backfill-space-types.ts --apply
 */
import { prisma } from '../src/lib/db';

const APPLY = process.argv.includes('--apply');

async function main() {
  // SELECT previo: todos los espacios que siguen en el DEFAULT COUPLE, con su
  // recuento de miembros ACTIVE (misma semántica que getGroupMembers).
  const couples = await prisma.couple.findMany({
    where: { type: 'COUPLE' },
    select: {
      id: true,
      name: true,
      _count: { select: { memberships: { where: { status: 'ACTIVE' } } } },
    },
  });

  const toGroup = couples.filter((c) => c._count.memberships > 2);
  const stayCouple = couples.length - toGroup.length;

  console.log(
    `Escaneados ${couples.length} espacios con type=COUPLE (default): ` +
    `${toGroup.length} → GROUP (>2 miembros ACTIVE), ${stayCouple} se quedan COUPLE.`,
  );
  for (const c of toGroup) {
    console.log(`  ${c.id} "${c.name ?? '(sin nombre)'}" miembros ACTIVE=${c._count.memberships} → GROUP`);
  }

  if (toGroup.length === 0) {
    console.log('\nNada que cambiar.');
    return;
  }

  if (!APPLY) {
    console.log(`\nDRY-RUN: no se escribió nada. Re-ejecuta con --apply para poner ${toGroup.length} filas a GROUP.`);
    return;
  }

  // UPDATE acotado por id (y re-condicionado a type=COUPLE por si algo cambió
  // entre el SELECT y el UPDATE) — anti-carrera al estilo updateMany condicional.
  const res = await prisma.couple.updateMany({
    where: { id: { in: toGroup.map((c) => c.id) }, type: 'COUPLE' },
    data: { type: 'GROUP' },
  });
  console.log(`\nAPPLY: ${res.count} espacios actualizados a type=GROUP.`);
}

main()
  .catch((err) => {
    console.error('Backfill space-types falló:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
