# Plan REVISADO — Listas de la compra de Kill Bill

> **Cambio de premisa:** los gastos nacen del OCR del ticket (`/api/ocr` → `Expense` + `ReceiptLineItem[]`). El puente lista→gasto se descarta por redundante. Este documento reescribe el plan de la feature en torno a la lista como **herramienta autónoma de planificación y coordinación de la compra física**.
>
> **Nota de rama:** `feat/shopping-lists` **no está mergeada a `main`**. Por tanto, quitar el puente se hace **reescribiendo la propia rama** (borrado dirigido de commits/código): **no** requiere migración de "contract" en producción. La única migración desplegada relacionada (`20260711120000_add_shopping_lists`) se ajusta reescribiendo esa misma migración de la rama, no añadiendo una nueva.

---

## 1. Cambio de enfoque

Con el puente, la lista tenía **dos roles en conflicto**: fuente de gastos (vía `checkoutList` → `Expense`) y herramienta de compra. El gasto real ya lo materializa el OCR del ticket, así que el primer rol era **redundante** y creaba confusión al existir dos caminos al gasto.

Al retirar el puente, la lista **no pierde propósito, cambia de rol**:

- Deja de ser "fuente de gastos".
- Pasa a ser la herramienta de la fase **anterior a comprar**: qué falta en casa, quién lo coge, en qué orden recorrer el súper, y tacharlo juntos en tiempo casi real.
- El gasto y la lista dejan de competir por el mismo trabajo: **la lista planifica, el OCR contabiliza**.

**La buena noticia: el núcleo de valor ya está construido y es independiente del puente.** El toggle `checked` es idempotente y seguro ante concurrencia (`setItemChecked` hace `updateMany` condicionado por id, nunca read-modify-write; dos personas marcando a la vez convergen sin pisarse), la captura rápida con Enter (`add-item-input`) y el reorder (`reorderItemsForScope`) ya existen. El puente solo usaba `checked` como filtro de elegibilidad.

**Decisión de alcance: PODAR, no compensar con features nuevas.** El MVP es deliberadamente contenido: retirar el puente, rematar la UI de cantidad/unidad/nota, añadir "vaciar comprados" para reciclar la lista semanal, y refresco casi-en-vivo para que la sensación colaborativa se sostenga.

---

## 2. Qué se elimina (el puente)

Borrado dirigido, no refactor. El puente está encapsulado.

### Lógica — `src/lib/list-crud.ts`
- Función `checkoutList()` (bloque *"bridge: list→expense"*).
- Interfaz `CheckoutInput`.
- Helper `validateCategoryKey`.
- Los **4 imports exclusivos** de `checkoutList`: `getGroupMembers` (`./membership`), `resolveCategoryId` (`./category-db`), `calculateSplitAmounts` (`./splits`), `postExpenseLedger` (`./ledger`).
- El docblock del módulo que menciona el puente y la idempotencia por `linkedExpenseId`.
- Helper `validatePriceCents` (queda huérfano al eliminar `priceCents` — ver §4).

### Rutas API (ficheros + carpetas `checkout/`)
- `src/app/api/spaces/[id]/lists/[listId]/checkout/route.ts`
- `src/app/api/me/lists/[listId]/checkout/route.ts`

### Componentes UI
- `src/components/shopping/checkout-sheet.tsx` — **completo**.
- `src/app/lists/[listId]/client.tsx`: import de `CheckoutSheet`, estado `checkoutOpen`, cómputo `eligible`/`checkoutTotal`, barra fija *"Convertir en gasto"* (icono `Receipt`), render de `<CheckoutSheet>`, memo `categoryContext`, y props `members`/`currentUserId` si dejan de usarse.
- `src/components/shopping/shopping-item-row.tsx`: campo `linked` y badge *"en gasto"*.
- `src/app/lists/[listId]/page.tsx`: derivación `linked: i.linkedExpenseId !== null` y el cálculo de `members`/`getGroupMembers` (solo servía al selector de pagador del checkout).
- `src/components/shopping/add-item-input.tsx`: el campo de precio del alta rápida.

### Totales autoreferentes
- `src/lib/list-read.ts`: `totalCents` (suma de `priceCents` de items `checked`) y su exposición en `ListSummary` / `ListCard` / detalle. Sin el puente ese total no tiene significado (no es gasto ni presupuesto real).

### Tests
- `src/lib/list-crud.test.ts`: describes `checkoutList — group bridge` y `— personal bridge` (~291-360), import de `checkoutList` y mocks que referencian `linkedExpenseId`.
- `e2e/shopping/smoke.spec.ts`: la parte del puente (POST `checkout`, segundo checkout esperando 400, aserción `item.linkedExpenseId`). Dejar el flujo crear/añadir/marcar.

---

## 3. Qué se queda y qué se añade

### Se queda (núcleo intacto)
- `checked` / `checkedById` / `checkedBy` / `checkedAt` y el toggle idempotente `setItemChecked` — **corazón colaborativo**.
- CRUD completo de listas e items y el patrón XOR grupo/personal (`groupId`/`ownerId`).
- Reorder de listas e items (`reorderItemsForScope` + ruta `/items/reorder`).
- Captura rápida con Enter (`add-item-input`, ya sin campo de precio).
- Campos `name`, `quantity`, `unit`, `note`, `sortOrder`.

### Se añade — MVP
| Feature | Detalle | Coste |
|---|---|---|
| **Exponer/editar `quantity`/`unit`/`note` por item** | Ya están en schema y CRUD; solo falta rematar la fila y el formulario de edición. `unit` libre (no enum) en v1. | Bajo |
| **"Vaciar comprados"** | Acción que resetea/borra los items `checked` de un `listId` (`updateMany`/`deleteMany`) para reciclar la lista semanal sin recrearla. UI clara que la distinga de "borrar lista". | Bajo |
| **Refresco casi-en-vivo** | Polling ligero del detalle de lista para que "uno tacha en el súper y el otro lo ve". Sin esto se pierde la sensación colaborativa. Sin infra nueva. | Bajo |
| **Quitar precio del alta rápida** | Cae solo al eliminar `priceCents`; maximiza la velocidad de captura. | Trivial |

### Se añade — Later (fuera del alcance actual; priorizar cuando las listas demuestren uso)
- **Reconciliación OCR→lista** como **sugerencia confirmable** sobre `checked` (ver §6). La integración inteligente que sustituye y supera al puente.
- **Categoría por PASILLO** por item, opcional y auto-asignada (ver decisión abajo).
- **Plantillas / "duplicar lista"** para la compra habitual (se apoya en `createListForScope` + copia de items).
- **Asignar item a un miembro** (patrón `assignedToId` ya usado en `ReceiptLineItem`) — más valor en grupo/familia que en pareja.
- **Compartir con invitados** (rol `guest` ya existe para OCR/espacios; hoy `list-crud` lo declara *"out of v1"*).

### Skip por ahora
- Autocompletado por historial (ruido de descripciones crudas de ticket).
- Precio como presupuesto contra `Budget` (ya existe `Budget`; nicho).
- Recordatorios / push (no hay infraestructura de notificaciones).

### Decisión sobre categorización por pasillo — **LATER, no MVP**
El contraargumento previo (*"la categoría del gasto ya cubre la analítica, no dupliques"*) **se cae al quitar el puente**: la lista ya no genera gasto, así que la categoría del item tendría un trabajo **ortogonal** — organizar el recorrido físico (pasillo), no clasificar para reportes. El propio schema delata que la ausencia de `categoryId` fue decisión del puente (*"el item nace sin categoryId"*), no de la lista.

Pero **no entra ahora**: en una compra semanal de pareja, el **reorder manual (que ya existe)** cubre la necesidad de agrupar por pasillo sin acoplar la lista al subsistema más pesado (`resolveCategoryId`, `ICON_REGISTRY`) ni migrar. Su payoff crece con el tamaño de la lista. Cuando se haga, **tres reglas no negociables**:
1. Categoría **por ITEM** (nunca a nivel de lista, que no agrupa nada en compra multi-pasillo; nunca texto libre, que mete erratas y rompe el filtrado).
2. **Vocabulario de PASILLOS nuevo** (Fruta/Verdura, Lácteos, Carne/Pescado, Panadería, Congelados, Despensa, Bebidas, Droguería, Otros) reutilizando el **mecanismo** del Category system (FK opcional + `CategoryScope` + `ICON_REGISTRY`), **no** las 8 categorías de gasto verbatim ("Compra" se lo comería todo).
3. **`NULLABLE` y AUTO-ASIGNADO** (por nombre/historial/línea de ticket), jamás un peaje obligatorio en el alta que mataría la captura rápida.

---

## 4. Cambios de datos y API

### Schema (`prisma/schema.prisma`)

**`model ShoppingListItem` — ELIMINAR:**
- `linkedExpenseId String?`
- relación `linkedExpense Expense? @relation("ShoppingItemExpense", ...)` (con `onDelete: SetNull`)
- `@@index([linkedExpenseId])`
- `priceCents Int?` (queda huérfano sin el puente)
- Actualizar el comentario del modelo que ata el item al puente (*"el item nace sin categoryId: la categoría se elige una vez en el puente"*; y el de `priceCents`: *"céntimos; puente hacia Expense.amount"*).

**`model Expense` — ELIMINAR:**
- la inversa `shoppingItems ShoppingListItem[] @relation("ShoppingItemExpense")`.

**Se conservan** en `ShoppingListItem`: `name`, `quantity`, `unit`, `note`, `checked`, `checkedById`, `checkedBy` (`@relation ShoppingItemChecker`), `checkedAt`, `sortOrder`, `@@index([listId])`, `@@index([checkedById])`.

**No se añade** `categoryId` ni `assignedToId` ahora (son Later; irán con su propia migración *expand* cuando se prioricen).

### Estrategia de migración (clave: rama no mergeada)
Como `feat/shopping-lists` **no está en `main`**, la migración `20260711120000_add_shopping_lists` **solo existe en la rama** y aún no debe darse por definitiva en prod para efectos de esta feature. En lugar de crear una migración *contract* separada (DROP FK + index + columnas), se **reescribe la propia migración de la rama** para que `ShoppingListItem` nazca ya **sin** `linkedExpenseId` ni `priceCents`. Resultado: un solo `CREATE TABLE` limpio, sin deuda de columnas huérfanas ni pasos expand/contract.

> Si por el auto-migrate la migración original ya se hubiera aplicado en algún entorno vivo (staging/prod) a partir de esta rama, entonces sí habría que añadir una migración *contract* nueva (`DROP FOREIGN KEY ShoppingListItem_linkedExpenseId_fkey; DROP INDEX ...; DROP COLUMN linkedExpenseId; DROP COLUMN priceCents;`) siguiendo el patrón expand/contract del runbook, **sin editar** la ya aplicada. Confirmar el estado real del entorno antes de elegir (ver §6).

### Downstream de código
- `list-read.ts`: quitar `totalCents` de `getListsForScope` y del tipo `ListSummary` (y de `ListCard`/detalle).
- `list-crud.ts`: quitar `validatePriceCents` y `validateCategoryKey`.
- `add-item-input.tsx`: quitar el campo precio.

### Endpoints
- **Borrar:** `POST /api/spaces/[id]/lists/[listId]/checkout` y `POST /api/me/lists/[listId]/checkout`.
- **Añadir (MVP):** acción "vaciar comprados" — reutilizar la ruta de items existente o añadir un endpoint `POST .../items/clear-checked` (grupo y personal) que haga `updateMany`/`deleteMany` sobre los items `checked` del `listId`, respetando el patrón XOR y `requireSpaceAccess`.
- **Sin cambios:** CRUD de listas/items, toggle `setItemChecked`, `/items/reorder`.

---

## 5. Plan por fases

### Fase 0 — Retirar el puente (reescritura de rama)
**Objetivo:** dejar la lista limpia, sin ningún rastro del puente.
**Trabajo:** todo lo de §2 (código, rutas, UI, tests) + los cambios de schema de §4 reescribiendo la migración de la rama para que la tabla nazca sin `linkedExpenseId` ni `priceCents`.
**Hecho cuando:** compila y pasa lint; `npx vitest run` verde sin los tests del puente; `prisma migrate dev` regenera un cliente sin la relación; no queda ninguna referencia a `checkoutList`/`linkedExpenseId`/`priceCents`/`totalCents`/`checkout` en el árbol (`grep` limpio); la lista se crea, añade, marca y reordena en la UI sin la barra "Convertir en gasto".

### Fase 1 — Rematar la lista limpia (MVP)
**Objetivo:** que la lista sea plenamente usable como herramienta de compra.
**Trabajo:** exponer/editar `quantity`/`unit`/`note` en fila y formulario; alta rápida sin precio; "vaciar comprados" (acción + UI diferenciada de "borrar lista").
**Hecho cuando:** puedo crear un item con cantidad/unidad/nota y verlos/editarlos; puedo vaciar los comprados y reutilizar la lista; captura rápida con Enter sin fricción de precio.

### Fase 2 — Colaboración casi-en-vivo (MVP)
**Objetivo:** "uno tacha en el súper, el otro lo ve".
**Trabajo:** polling ligero del detalle de lista (sin infra realtime).
**Hecho cuando:** con dos sesiones abiertas, marcar un item en una se refleja en la otra en pocos segundos sin recargar; el toggle sigue siendo idempotente ante marcado simultáneo.

### Fase 3 — Later (solo si las listas demuestran uso)
**Objetivo:** valor incremental, cada uno con su propia migración *expand* cuando se priorice.
- **Reconciliación OCR→lista** (sugerencia confirmable sobre `checked`; ver §6).
- **Categoría por pasillo** (`categoryId` nullable + vocabulario de pasillos, auto-asignado).
- **Plantillas / duplicar lista.**
- **Asignación a miembro** (`assignedToId`).
**Hecho cuando (cada una):** su criterio propio; ninguna reintroduce el puente ni crea gastos desde la lista.

> **Nota expand/contract:** en esta feature no hay *contract* en prod porque la eliminación de columnas se hace reescribiendo la migración de la rama antes de mergear. Las futuras adiciones de Fase 3 (`categoryId`, `assignedToId`) sí son *expand* (columnas nullable nuevas) y van con su propia migración una vez la rama esté en `main`.

---

## 6. Riesgos y decisiones abiertas

### Riesgos
- **Reescritura de rama vs. migración ya aplicada:** el plan asume que la migración de la rama aún puede reescribirse. Si el auto-migrate ya la aplicó en un entorno vivo desde esta rama, hay que cambiar a una migración *contract* nueva (ver §4). **Verificar el estado del entorno antes de la Fase 0.**
- **`priceCents` huérfano:** su total es autoreferente y sin significado sin el puente. Se elimina (postura decidida), pero conviene confirmar (abajo) antes de dropear el campo y su UI.
- **Fiabilidad del match OCR (Fase 3):** las descripciones de ticket son abreviaturas crípticas en mayúsculas recortadas a 20 chars (`"LECHE DESN PACK6"`) frente a nombres genéricos (`"leche"`). El match exacto falla casi siempre; cualquier auto-marcado debe ser **sugerencia confirmable, nunca silenciosa**, con el fuzzy-match delegado a Gemini en la **misma llamada OCR ya facturada** (coste marginal ~0; requiere pasar `groupId`/`listId` al endpoint). Target = `checked`/`checkedAt` vía `setItemChecked`, **nunca** `linkedExpenseId`. Resolver de forma determinista contra qué lista(s) se cruza (espacio activo del gasto y/o personal del actor) respetando `requireSpaceAccess` y el rol `guest`.

### Decisiones abiertas (a confirmar con el dueño)
1. **`priceCents`:** recomendación firme = **ELIMINAR** junto con el total de lista. ¿Confirmas que no quieres conservar un "precio estimado" para presupuestar? (Reintroduce fricción en el alta; si el presupuesto importa, ya existe `Budget`.)
2. **Refresco casi-en-vivo:** ¿te vale **polling** ligero (barato, sin infra) o esperas realtime/websockets (más coste)? El MVP asume polling.
3. **"Vaciar comprados":** ¿borrar los items `checked` (`deleteMany`) o solo **desmarcarlos** (reset a unchecked) para conservar el histórico de la lista?
4. **Categorización por pasillo:** ¿hay apetito real de agrupar/ordenar por pasillo en el súper, o el reorder manual basta? Determina la prioridad del Later.
5. **Reconciliación OCR→lista:** ¿la quieres como siguiente iteración tras validar uso, o es prescindible? Si la quieres, confirmar que va como **sugerencia confirmable** (nunca marcado silencioso).
6. **Invitados (guest):** ¿un invitado (familiar sin cuenta) debería poder añadir/marcar items? Hoy es *out of v1*; Later barato que abre permisos de escritura, con riesgo de spam a limitar.