# Plan de implementación: Listas de la compra vinculadas a grupos

## 1. Debate y alcance

### 1.1 Categorización de items: pro, contra y decisión

**A favor (catPro):** añadir `categoryId String?` opcional al item (FK a `Category` sin Cascade, `SetNull`, clon exacto de `Expense.categoryRef`) es casi gratis en schema, reutiliza `CategoryPicker`/`CategoryBadge`/`resolveCategoryId` y el scope discriminado `{groupId}|{ownerId}`, y desbloquea agrupar por pasillo, coherencia lista→gasto y analítica planificado-vs-real.

**En contra (catCon):** el happy-path de una lista es capturar a toda velocidad ("leche", enter); todo campo en el alta es fricción. El item es efímero (vive minutos/horas y cuelga con Cascade): invertir estructura taxonómica permanente en un dato desechable es mal negocio. Categorizar item **y** gasto duplica la dimensión "categoría" en dos capas que pueden divergir. Es greenfield sin evidencia de uso (YAGNI), y "agrupar por pasillo" se cubre con `sortOrder`/reorder manual.

**Decisión (se adopta catCon para v1):** **el item NACE SIN `categoryId`.** La clasificación analítica vive en el `Expense` que se materializa al comprar (`Expense.categoryRef` ya alimenta `finance.ts`, `Budget` y `/analytics`), y la categoría se elige **una sola vez** en el puente lista→gasto vía `resolveCategoryId`. Concesión diferida: si aparece demanda real de agrupación, la vía barata es un `categoryId` **a nivel de LISTA** (una lista "Supermercado"/"Farmacia"), un solo campo sin FK ni validación cross-scope por fila. El `categoryId` por-item queda como último escalón, solo si el uso lo pide. **Regla: categoría a nivel lista o diferir; por item, YAGNI.**

### 1.2 Funcionalidades priorizadas

**MVP** (lean, más cerca del CRUD SIMPLE de `Tag` que de las 420 líneas de `Category`, salvo el puente):
- CRUD de listas de **grupo** (crear, renombrar, borrar, listar) colgando de `groupId`.
- CRUD de items (`name`, `quantity`, `unit`, `priceCents`), con **escritura abierta a cualquier miembro ACTIVE** (no solo OWNER/ADMIN): es lo que la hace colaborativa.
- Marcar/desmarcar comprado con auditoría (`checkedById`/`checkedAt`), mediante **toggle idempotente condicional por `item.id`** (patrón anti-carrera de `InviteCode`/`updateMany`), nunca read-modify-write.
- Cantidad, unidad y precio (`priceCents` en céntimos) + total de la lista sumando los items checked (`src/lib/currency.ts`).
- **Puente lista→gasto (feature estrella, SÍ entra en MVP):** convierte los items checked con precio en **UN** `Expense` reutilizando el flujo de `POST /api/expenses` (`resolveCategoryId` + `calculateSplitAmounts` + `$transaction` con `expense.create` + splits + `postExpenseLedger` SHARED). Idempotencia sellando `linkedExpenseId` por item.
- Reorder manual por `sortOrder` (`$transaction` con array de updates).
- Lib compartido `src/lib/list-crud.ts` + rutas finas + test `src/lib/list-crud.test.ts` (mock de `./db`).
- Acceso desde **Herramientas** en Ajustes + ruta protegida en `src/proxy.ts`.

**Later** (aditivo, no rompe schema):
- Listas **personales** (`ownerId`, rutas `/api/me/lists`, segmented Común/Personal). La columna `ownerId` ya nace en v1.
- Categoría a nivel de item (con validación de pertenencia al scope).
- Asignar item a un miembro (`assignedToId`, `SetNull`) → mapea a split exclusivo/beneficiario.
- Notas por item/lista; plantillas/recurrentes (`duplicateForScope`, encaje con `RecurringSeries`); sugerencias por historial; cruce planificado-vs-real contra `Budget`.

**Fuera de scope:**
- Colaboración en tiempo real (SSE/websocket): `router.refresh()`/polling al enfocar da el 80% del valor; el toggle idempotente ya evita corrupción.
- Modo offline / cola de mutaciones (Service Worker): caro y frágil.
- Orden automático por pasillo derivado de taxonomía de supermercado.
- Listas en espacios **EPHEMERAL** y edición por invitados sombra.
- 5º tab en `bottom-nav.tsx`.

**Recomendación:** enviar un MVP deliberadamente pequeño **pero con el puente lista→gasto incluido**. El puente es el único diferenciador que justifica construir listas dentro de Kill Bill (deudas, splits, ledger, roles, presupuestos ya existen); su coste es reutilización, no reimplementación. Todo lo demás especulativo se difiere porque es aditivo.

---

## 2. Diseño propuesto

### 2.1 Modelo de datos (Prisma)

Dos modelos nuevos en `prisma/schema.prisma`, importes siempre en céntimos (`Int`), migración manual con timestamp creciente en `prisma/migrations/AAAAMMDDHHMMSS_add_shopping_lists/`.

```prisma
model ShoppingList {
  id          String   @id @default(cuid())
  name        String
  sortOrder   Int      @default(0)
  // XOR grupo/personal (patrón Category/Tag). En MVP solo se usa groupId;
  // ownerId nace nullable para no bloquear listas personales sin migración destructiva.
  groupId     String?
  group       Couple?  @relation(fields: [groupId], references: [id], onDelete: Cascade)
  ownerId     String?
  owner       User?    @relation("PersonalShoppingList", fields: [ownerId], references: [id], onDelete: Cascade)
  // Auditoría (patrón createdBy/SetNull); la baja de usuario nunca borra la lista.
  createdById String?
  createdBy   User?    @relation("ShoppingListCreator", fields: [createdById], references: [id], onDelete: SetNull)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  items       ShoppingListItem[]
  @@index([groupId])
  @@index([ownerId])
}
// SIN @@unique en name: duplicados ('Mercadona' x2) son legítimos y evitan P2002 en alta concurrente.

model ShoppingListItem {
  id              String   @id @default(cuid())
  listId          String
  list            ShoppingList @relation(fields: [listId], references: [id], onDelete: Cascade)
  name            String
  quantity        Int?     // opcional
  unit            String?  // libre en MVP (ud/kg/g/L/pack); no enum todavía
  priceCents      Int?     // céntimos; puente hacia Expense.amount
  checked         Boolean  @default(false)
  checkedById     String?
  checkedBy       User?    @relation("ShoppingItemChecker", fields: [checkedById], references: [id], onDelete: SetNull)
  checkedAt       DateTime?
  // Idempotencia del puente lista->gasto: item consumido queda sellado; SetNull si se borra el gasto.
  linkedExpenseId String?
  linkedExpense   Expense? @relation("ShoppingItemExpense", fields: [linkedExpenseId], references: [id], onDelete: SetNull)
  sortOrder       Int      @default(0)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@index([listId])
  @@index([linkedExpenseId])
}
// SIN @@unique en (listId,name): permite añadir el mismo producto dos veces y evita P2002 en alta paralela.
// NO se añade categoryId en MVP (ver decisión de categorización).
```

**Backrefs a añadir:**
- `model Couple` (~línea 118, junto a `tags`/`categories`): `shoppingLists ShoppingList[]`
- `model User` (~línea 196, junto a `personalTags`/`personalCategories`):
  - `personalShoppingLists ShoppingList[] @relation("PersonalShoppingList")`
  - `createdShoppingLists  ShoppingList[] @relation("ShoppingListCreator")`
  - `checkedShoppingItems  ShoppingListItem[] @relation("ShoppingItemChecker")`
- `model Expense` (~línea 286): `shoppingItems ShoppingListItem[] @relation("ShoppingItemExpense")`

**Resumen `onDelete`:** `list→Couple` Cascade, `list→owner` Cascade (borrar espacio/usuario arrastra sus listas), `item→list` Cascade, `checkedBy`/`createdBy`/`linkedExpense` **SetNull** (auditoría y enlace financiero no bloquean ni se pierden datos de gasto).

### 2.2 API + autorización

Rutas finas que SOLO autorizan + parsean + delegan a `src/lib/list-crud.ts` (`class ListError{status,code}`, `errorResponse` la mapea a `{error,code,status}`). El `[id]` del path **ES el groupId**; autorizar SIEMPRE contra el grupo del **recurso** con `getSessionCtx()` + `requireSpaceAccess`, nunca contra la cookie `active_group`.

| Método + ruta | Autorización | Comportamiento |
|---|---|---|
| `GET /api/spaces/[id]/lists` | `{allowArchived:true, allowGuest:true}` | Listar (lectura para cualquier ACTIVE, incl. GUEST) |
| `POST /api/spaces/[id]/lists` | `{roles:['OWNER','ADMIN']}` | Crear lista (gate por defecto bloquea SETTLING/ARCHIVED) |
| `PATCH /api/spaces/[id]/lists/[listId]` | `{roles:['OWNER','ADMIN']}` | Renombrar/reordenar lista |
| `DELETE /api/spaces/[id]/lists/[listId]` | `{roles:['OWNER','ADMIN']}` | Borrar lista (Cascade a items) |
| `GET /api/spaces/[id]/lists/[listId]/items` | `{allowArchived:true, allowGuest:true}` | Leer items |
| `POST /api/spaces/[id]/lists/[listId]/items` | `{}` (sin roles) | Añadir item: **cualquier miembro ACTIVE**. `sortOrder = aggregate _max+1` |
| `PATCH .../items/[itemId]` | `{}` | Editar campos / **TOGGLE checked** con `updateMany` condicional idempotente (`checked`, `checkedById=ctx.userId`, `checkedAt`) |
| `DELETE .../items/[itemId]` | `{}` | Borrar item (`deleteMany` idempotente, `count===0 → 404`) |
| `PATCH .../items/reorder` | `{}` | Reorder en `$transaction` (array de updates) |
| `POST .../lists/[listId]/checkout` | `{}` con writability ACTIVA (`allowArchived:false`) | **PUENTE** (ver 2.3) |

**Validación manual** (`typeof string`, trim, longitud máx) → 400 `{error,code}`; colisión → 409; nunca confiar en el cliente para flags de sistema (`checked`/`linkedExpenseId` se derivan en servidor).

**Autorización y estado del espacio:** `requireSpaceAccess` carga `Couple`+`Membership` del caller desde BD, exige `status===ACTIVE`, aplica gate de roles. Toda mutación deja `allowArchived:false`, así `assertSpaceWritable` lanza `SPACE_NOT_WRITABLE` (409) en SETTLING ("no se crean gastos nuevos") y ARCHIVED ("solo lectura"); las lecturas pasan `allowArchived:true`.

**GUEST:** lectura sí (`allowGuest:true` en GET), cageado a su groupId del JWT. Escritura de items: **denegada por defecto** (no se pasa `allowGuest` en mutaciones), igual que el resto del repo. **Checkout: siempre denegado a GUEST** (altera balances). Abrir marcado a invitados sería decisión de producto bajo flag EPHEMERAL.

**Listas personales (later):** rutas gemelas `/api/me/lists` autorizadas solo con `getSessionCtx()` (scope `{kind:'owner',ownerId:ctx.userId}`, sin gate de writability), delegando al **mismo lib**.

### 2.3 Puente listas→gasto (checkout)

`POST /api/spaces/[id]/lists/[listId]/checkout` (mutación financiera, writability activa):
1. Recoge items `checked` con `priceCents>0` y `linkedExpenseId==null`.
2. Suma el total; crea **UN** `Expense` reutilizando el flujo de `POST /api/expenses`: `resolveCategoryId(category, scope)` + `calculateSplitAmounts` sobre miembros ACTIVE (`getGroupMembers`, orden load-bearing) + `$transaction` con `expense.create` + splits + `postExpenseLedger` (solo SHARED).
3. **En el mismo `$transaction`** sella `linkedExpenseId` en los items consumidos → idempotente: reintentar no duplica el gasto; los items ya enlazados se excluyen de futuras conversiones.
4. Defaults: pagador = usuario actual (editable), split equitativo, categoría elegida una vez. **No se reimplementan balances:** `finance.ts`/`splits.ts` siguen siendo la fuente de verdad.

---

## 3. Plan por fases

Cada fase es incremental y desplegable. El deploy a Coolify auto-aplica migraciones (`prisma migrate deploy` en el `CMD` del contenedor antes de `node server.js`), y el servidor solo arranca si las migraciones tienen éxito. Como el schema añade solo tablas/columnas nuevas nullable, es **expand puro** (sin contract): forward-compatible y reversible.

### Fase 0 — Schema + migración (expand)
- **Cambios:** modelos `ShoppingList` + `ShoppingListItem`, backrefs en `Couple`/`User`/`Expense`, migración manual `AAAAMMDDHHMMSS_add_shopping_lists`. Regenerar cliente Prisma.
- **Hecho:** `npx prisma migrate dev` aplica limpio, cliente compila, sin cambios en código existente. Deploy no rompe (solo crea tablas).

### Fase 1 — Lib de CRUD + tests (sin UI)
- **Cambios:** `src/lib/list-crud.ts` (`ListError`, scope discriminado, `sortOrder = aggregate _max+1`, create/update/delete/reorder de lista e items, toggle idempotente). `src/lib/list-crud.test.ts` mockeando `./db` (patrón `category-crud.test.ts`, `$transaction` dual, `expectError`).
- **Hecho:** `npx vitest run src/lib/list-crud.test.ts` verde cubriendo happy-path, validaciones 400, toggle idempotente, delete idempotente 404, reorder inválido 400. `npm run lint` limpio.

### Fase 2 — Rutas API (grupo)
- **Cambios:** `/api/spaces/[id]/lists/route.ts`, `.../lists/[listId]/route.ts`, `.../lists/[listId]/items/route.ts`, `.../items/[itemId]/route.ts`, `.../items/reorder/route.ts`. Todas autorizando con `getSessionCtx()`+`requireSpaceAccess` según la tabla 2.2, delegando al lib. `errorResponse` mapea `ListError`.
- **Hecho:** CRUD verificable vía API (curl/Playwright): OWNER/ADMIN crea lista, cualquier miembro ACTIVE añade/marca items, GUEST solo lee, mutaciones bloqueadas en SETTLING/ARCHIVED.

### Fase 3 — UI de listas e items
- **Cambios:** `src/app/lists/page.tsx` + `client.tsx` (índice), `src/app/lists/[listId]/page.tsx` + `client.tsx` (detalle), componentes `src/components/shopping/{list-card,shopping-item-row,add-item-input}.tsx`. Fila Link en Herramientas de `settings-client.tsx` (icono `ShoppingCart`, href `/lists`). `<section>` Listas en `/spaces/[id]/page.tsx`. **`src/proxy.ts`: añadir `/lists` a `protectedPaths` y `/lists/:path*` a `config.matcher`** (NO a `GUEST_ALLOWED_PREFIXES` en v1).
- **Hecho:** desde Ajustes → Listas, un miembro crea lista, añade items ("leche", enter), marca comprado (se refleja tras refresh de otro miembro), reordena, ve el total. Sin grupo → `NoGroupState`.

### Fase 4 — Puente checkout (feature estrella)
- **Cambios:** `POST .../lists/[listId]/checkout` (lib + ruta, reutilizando el flujo de `POST /api/expenses` en `$transaction`, sellado `linkedExpenseId`). `src/components/shopping/checkout-sheet.tsx` (bottom-sheet con items checked, total, selector de pagador, `CategoryPicker`). Botón "Convertir compra en gasto" en el detalle. Tests de idempotencia en el lib.
- **Hecho:** con items checked+precio, checkout crea **un** `Expense` repartido que aparece en dashboard/balances; reintentar no duplica; items enlazados se excluyen; bloqueado en SETTLING/ARCHIVED y denegado a GUEST.

### Fase 5 (later) — Listas personales
- **Cambios:** rutas `/api/me/lists` (scope owner, sin writability), segmented Común/Personal (reutilizado de `/tags`-`/categories`) activando Personal. Sin migración (columna `ownerId` ya existe).
- **Hecho:** un usuario gestiona listas personales sin ensuciar las de grupo.

---

## 4. Inventario de vistas

### Vistas/componentes nuevos

| Ruta / fichero | Rol |
|---|---|
| `src/app/lists/page.tsx` | Server: `getSession`→redirect, `getActiveGroup(userId)`, `shoppingList.findMany({where:{groupId}})` con nº items y suma de checked, renderiza client. `force-dynamic` |
| `src/app/lists/client.tsx` | Índice: header ArrowLeft→/settings, `NoGroupState` si `!hasGroup`, tarjetas `list-card`, FAB "Nueva lista" (crear reservado OWNER/ADMIN). Segmented Común/Personal con **Personal deshabilitado en v1** |
| `src/app/lists/[listId]/page.tsx` | Server: carga lista+items por `sortOrder` autorizando contra Membership del grupo del recurso; pasa rol del caller |
| `src/app/lists/[listId]/client.tsx` | Detalle: orquesta filas, add-item, total, botón "Convertir compra en gasto" (checkout-sheet), `router.refresh`/polling al enfocar |
| `src/components/shopping/list-card.tsx` | Tarjeta `GlassCard` de lista (nombre, nº items, total checked, Link) |
| `src/components/shopping/shopping-item-row.tsx` | Fila con checkbox (toggle idempotente), name/quantity/unit, precio formateado, editar/borrar, handle de drag |
| `src/components/shopping/add-item-input.tsx` | Captura rápida ("leche"→enter), sin categoría en el alta, cualquier miembro ACTIVE |
| `src/components/shopping/checkout-sheet.tsx` | Bottom-sheet del puente: items checked, total, selector pagador, `CategoryPicker`, confirma → `POST checkout` |

**Reutilizados:** `CategoryPicker` (dentro de checkout-sheet, para la categoría del `Expense`), `Button` (FAB, acciones, toggle), `Input` (add/editar), `GlassCard`, `NoGroupState`. Modal: replicar el inline de `categories/client.tsx` o el bottom-sheet de `space-switcher` (no hay Modal compartido).

### Vistas modificadas

| Ruta | Ficheros | Cambios |
|---|---|---|
| `/settings` | `src/app/settings/settings-client.tsx` | **Acceso principal.** Fila Link `h-14` en Herramientas (~líneas 358-364, junto a Categorías), icono `ShoppingCart`, span "Listas", `href="/lists"`, solo dentro de `groups.length>0` |
| `/spaces/[id]` | `src/app/spaces/[id]/page.tsx` | **Acceso secundario.** `<section>` "Listas" entre Invitaciones (~87-90) y Gestión (~93-96), h2 uppercase + Link filtrado por groupId |
| (proxy) | `src/proxy.ts` | **Obligatorio.** `/lists` en `protectedPaths` + `/lists/:path*` en `config.matcher`. NO en `GUEST_ALLOWED_PREFIXES` |

### Entradas de navegación

- **BottomNav (`bottom-nav.tsx`): NO se toca en v1.** El array `TABS` (Inicio/Presupuestos/Análisis/Ajustes) queda intacto; un 5º tab está explícitamente fuera de scope. Solo si Listas se promociona a destino top-level se añadiría entry + prefijo en proxy.
- **`/dashboard`: fuera de scope.** No hay acceso rápido planificado; opcional/diferido reutilizar el patrón FAB.

---

## 5. Riesgos y decisiones abiertas

### Riesgos

- **Concurrencia al marcar items (único riesgo técnico real):** dos personas marcando en el súper. Mitigación obligatoria — `updateMany` condicional idempotente por `item.id` (patrón anti-carrera de `InviteCode`), nunca read-modify-write de la lista. Es disciplina de una línea, no arquitectura.
- **Doble contabilización en el puente:** reintentos de checkout podrían duplicar el gasto. Mitigación — sellado de `linkedExpenseId` en el mismo `$transaction`; los items enlazados se excluyen y no se re-convierten.
- **Colisiones P2002:** evitadas por diseño al NO poner `@@unique` en `name`/`(listId,name)` (duplicados legítimos). Si se activara unicidad, capturar P2002 → 409 (como `CategoryError`).
- **Ruta desprotegida:** olvidar `src/proxy.ts` deja `/lists` sin autenticar. Es un cambio obligatorio de la Fase 3.
- **Sin realtime:** los cambios de otros miembros solo se ven tras `router.refresh`/polling al enfocar; aceptado (el 80% del valor a coste bajo).

### Decisiones abiertas

1. **Checkout — pagador y reparto:** propuesta pagador = usuario actual (editable), split equitativo entre ACTIVE, categoría elegida una vez, editable antes de confirmar. ¿Se acepta como default o hay que preguntar siempre?
2. **Granularidad del gasto:** propuesta un `Expense` por checkout agrupando N items (más simple e idempotente). ¿O un gasto por item?
3. **Gate de creación de lista:** propuesta reservar crear/borrar lista a OWNER/ADMIN (coherente con categorías); items siempre de cualquier miembro. ¿O permitir crear lista a cualquier ACTIVE?
4. **Ciclo de vida tras comprar:** items comprados/enlazados ¿se archivan, se quedan tachados con badge "en gasto", o se limpian manualmente? Afecta a la UI de reorder y al total.
5. **`priceCents` obligatorio para checkout:** propuesta solo entran items con `priceCents>0`. ¿O permitir importe 0 / repartir sin precio por línea?
6. **`unit`:** texto libre (propuesta MVP) vs enum cerrado (ud/kg/g/L/pack) desde el principio.
7. **Listas personales (later):** ¿activar pronto con el segmented Común/Personal, o esperar a ver uso? La columna `ownerId` ya nace en schema; es solo decisión de producto/UI.
8. **GUEST en EPHEMERAL:** ¿permitir a un invitado marcar items (no solo verlos)? Requiere `allowGuest` en escritura + flag EPHEMERAL + `allowsShoppingLists(type)` en `space-policy.ts` + prefijo en `GUEST_ALLOWED_PREFIXES`; hoy denegado por defecto.