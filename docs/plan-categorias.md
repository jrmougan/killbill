# Plan de implementación — Categorías personalizables en Kill Bill

> Guía de implementación. Sintetiza el análisis del estado actual, el diseño ganador (Diseño A: categorías por Espacio + personales) y el impacto por vista. Fiel al código existente: no introduce ficheros que no aparezcan en el material.

---

## 1. Estado actual

- **Doble representación desincronizada a mano.** Las categorías viven en dos capas: (a) el mapa estático `CATEGORIES` en `src/lib/categories.ts` (8 entradas, indexado por `id` = `key`), única fuente real de metadatos visuales (emoji, `label`, `labelEn`, `color`/`bgColor` como clases tailwind, `hex`, `icon` como **componente** `LucideIcon` importado); y (b) el `model Category` en `prisma/schema.prisma`, usado solo para el FK y la agrupación. El array `SYSTEM_CATEGORIES` está **triplicado** y sincronizado manualmente en `src/lib/categories.ts`, `prisma/seed.ts` y `scripts/seed-categories-and-backfill.ts`.

- **Las 8 categorías de sistema son globales** (`groupId = null`, `isSystem = true`): shopping, food, rent, utilities, transport, entertainment, health, other. Se siembran una sola vez de forma idempotente (`findFirst({ groupId: null, key })`, porque MySQL no aplica `UNIQUE` sobre `NULL`). Ver `prisma/seed.ts` y `scripts/seed-categories-and-backfill.ts`.

- **La UI no lee la tabla.** Todo el render re-resuelve la `key` contra el mapa estático vía `getCategoryById(key)` (fallback a `other`), y `getAllCategories()` devuelve solo las 8 fijas ignorando `sortOrder` y sin consultar la DB. Consecuencia: **una categoría custom persistida sería invisible en selectores/filtros y se pintaría como `Otro`**. Afecta a `src/app/dashboard/page.tsx`, `src/components/dashboard/expense-card.tsx`, `src/app/analytics/*`, `src/app/budget/client.tsx`, `src/components/expenses/filters.tsx`, `src/app/settle/[id]/page.tsx`.

- **Columnas de la tabla muertas.** `emoji`, `icon`, `color`, `bgColor`, `hex`, `label`, `labelEn` y `sortOrder` nunca se leen para renderizar. Además `icon` se guarda como **string** (nombre lucide, p.ej. `ShoppingBag`) y **no existe ningún resolver string→componente** en el repo.

- **Resolución de escritura ya soporta grupo.** `resolveCategoryId(key, groupId)` en `src/lib/category-db.ts` busca primero la custom `(groupId, key)` y luego la system `(null, key)`, devolviendo `Category.id` para el FK. `categoryKeyOf(row)` en `src/lib/category-read.ts` devuelve `categoryRef.key ?? enum ?? 'other'` (el enum ya está dropeado en Phase 5, así que el fallback efectivo es `other`).

- **Whitelists hardcodeadas bloquean cualquier key nueva.** `src/app/api/expenses/route.ts` y `.../[id]/route.ts` validan contra `VALID_CATEGORIES` (8 keys); una key desconocida se **normaliza en silencio a `other`** (POST) o devuelve **400** (PUT). `src/app/api/budget/route.ts` valida contra `Object.keys(CATEGORIES)`. Sin tocar esto, ninguna categoría custom sobrevive.

- **El schema ya soporta custom por grupo, pero nadie las crea.** `Category.groupId String?` → `Couple` con `onDelete: Cascade` y `@@unique([groupId, key])`. Migración `phase2b_category_table` (aditiva, dual-write), `phase4_budget_unique_swap` (Budget `categoryId` NOT NULL, `onDelete: Restrict`) y `phase5_contract_drops` (drop de los enums `category`). **No existe** `/api/categories` ni UI de gestión (CRUD/reorder/pickers).

- **Modo INDIVIDUAL sin hogar para categorías.** `Category` solo tiene `groupId` (FK a `Couple`); INDIVIDUAL no crea fila `Couple` (`coupleId null`), así que `resolveCategoryId(key, null)` solo llega a system. **No hay columna `userId`**, a diferencia del patrón XOR con `ownerId` ya usado en `Tag`/`Budget`. i18n a medias: `labelEn` es NOT NULL pero **nunca se renderiza** (la UI usa siempre `.label`).

---

## 2. Diseño propuesto

### 2.1 Modelo de propiedad (tres capas sobre el único `model Category`)

Discriminadas por `(groupId, ownerId)` con invariante **XOR**, replicando `Tag`/`Budget`:

| Capa | Discriminante | Alcance | Gestión |
|---|---|---|---|
| **SYSTEM** | `groupId=null, ownerId=null, isSystem=true` | Las 8 actuales, visibles para todos | No editables/borrables por usuarios |
| **DE ESPACIO** | `groupId=Couple.id, ownerId=null, isSystem=false` | Visibles a todo miembro `ACTIVE` (COUPLE / GROUP / EPHEMERAL) | `OWNER`/`ADMIN` vía `requireSpaceAccess` |
| **PERSONAL** | `ownerId=User.id, groupId=null, isSystem=false` | Hogar del modo INDIVIDUAL (sin fila `Couple`) | Autorizado por sesión |

**Lectura = MERGE por key:** conjunto efectivo = `system ∪ custom-del-contexto`, donde una custom con la misma key **sombrea** a la system (comportamiento intencionado, ya cubierto por `src/lib/category-read.test.ts` con `mascotas`). El contexto es el `groupId` del espacio activo o `ownerId=userId` en INDIVIDUAL. El orden pasa a ser `ORDER BY sortOrder, key` (hoy `sortOrder` está inerte).

### 2.2 Cambios de schema (mínimo — criterio prioritario)

Una sola columna nueva. En `prisma/schema.prisma`:

```prisma
model Category {
  // ...campos existentes...
  ownerId String?
  owner   User?   @relation("PersonalCategory", fields: [ownerId], references: [id], onDelete: Cascade)

  @@unique([groupId, key])          // se conserva (MySQL no aplica UNIQUE sobre NULL)
  @@unique([ownerId, key])          // nuevo
  @@index([ownerId])                // nuevo
}

model User {
  // ...
  personalCategories Category[] @relation("PersonalCategory")
}
```

- **Migración aditiva pura (expand)**: sin drop, sin backfill (toda fila existente es system con `ownerId=null`). Compatible con el runbook expand/contract y con `prisma migrate deploy` en el arranque del contenedor (Coolify auto-migrate).
- Al crear custom: `isSystem=false` **forzado en servidor**, `sortOrder = max(scope)+1`. `color`/`bgColor` son NOT NULL sin default → escribir **cadena vacía** (el render nuevo usa `hex`, no clases). `labelEn` NOT NULL → si no se aporta, **copiar de `label`**.
- **No se añade** `CategoryPreference` en V1 (se difiere para honrar el mínimo schema; solo entraría si el producto exige ocultar/reordenar las system por espacio — ver §5).

### 2.3 API CRUD

- **De espacio** — `src/app/api/spaces/[id]/categories/route.ts` (`id = groupId`), gate `requireSpaceAccess`:
  - `GET`: devuelve el MERGE ordenado `sortOrder, key` con metadata completa `{ emoji, iconName, hex, label, labelEn, isSystem, editable: !isSystem }`. Permitido a cualquier miembro `ACTIVE`, con `allowArchived` para históricos.
  - `POST/PATCH/DELETE/reorder`: exigen roles `OWNER`/`ADMIN`. `PATCH`/`DELETE` → **403** si `isSystem` o si `groupId != id`. Escritura bloqueada en `SETTLING`/`ARCHIVED`.
- **Personales (INDIVIDUAL)** — `src/app/api/me/categories/route.ts`: mismas operaciones, autorizadas solo por sesión (`getSessionCtx`), `ownerId = ctx.userId`, `groupId=null`.
- **Resolución** — `resolveCategoryId` en `src/lib/category-db.ts` cambia de firma a `resolveCategoryId(key, { groupId, ownerId })`: busca custom por `ownerId` cuando no hay `groupId`, antes del fallback system. Callers a actualizar: `api/expenses/route.ts`, `api/expenses/[id]/route.ts`, `api/budget/route.ts`, `api/expenses/import/route.ts`.
- **Bloqueante (verificado en código):** sustituir en `api/expenses/route.ts`, `api/expenses/[id]/route.ts` y `api/budget/route.ts` la whitelist `VALID_CATEGORIES` / `Object.keys(CATEGORIES)` por **validación contra la lista efectiva del contexto**; key desconocida → **400**, **nunca** normalizar en silencio a `other`.
- **Opcional (UX del Diseño B):** `POST .../duplicate` (crear custom prellenada desde una system/custom). Se difiere `PATCH .../preference` (hidden/reorder-system).

### 2.4 Estrategia segura de emoji / icono / color

- **Iconos** — nuevo `src/lib/category-icons.ts` con `ICON_REGISTRY: Record<string, LucideIcon>` (~30–40 iconos importados **estáticamente**, preservando tree-shaking). Única fuente: el picker ofrece exactamente esas keys; el render hace `ICON_REGISTRY[name] ?? fallback`; el server valida `name ∈ Object.keys(ICON_REGISTRY)` → 400. **Debe incluir los 8 nombres system** (`ShoppingBag`, `Utensils`, `Home`, `Zap`, `Car`, `Film`, `HeartPulse`, `MoreHorizontal`…) o el render DB-driven de las propias system se rompe. `categories.ts` deriva su componente de este registro (elimina la triplicación del icono).
- **Colores** — migrar de clases tailwind (`text-*`/`bg-*`, purgadas por el JIT y sin valores libres) a **estilo inline** sobre la columna `hex`: acento `color: hex`, chip `backgroundColor: hex + '1a'` (~10 % alpha). Paleta **cerrada** de swatches; validación server `^#[0-9a-fA-F]{6}$` **y** pertenencia a la paleta. Las 8 system también se pintan por `hex`, unificando el camino.
- **Emoji** — validación de **1 grapheme cluster** (`Intl.Segmenter`) + charset emoji + longitud acotada; se guarda tal cual.
- **XSS**: emoji/label se pintan como texto (JSX escapa); color/icono nunca como HTML crudo. Sin `innerHTML` ni clases dinámicas no compiladas.

### 2.5 Política de borrado / merge (sin huérfanos ni caídas a `other`)

1. `isSystem = true` → **403 siempre** (protección de las 8, hoy no validada en ningún sitio).
2. **Borrado con reasignación obligatoria** (no `DELETE` crudo: `Budget.categoryId` es NOT NULL `onDelete: Restrict`, un delete directo falla): `DELETE /.../[catId]?reassignTo=<targetId>` en **transacción** —
   a. validar `target` visible en el mismo contexto y distinto de la borrada;
   b. `UPDATE Expense SET categoryId=target WHERE categoryId=borrada` (evita el `SetNull → other`);
   c. `UPDATE RecurringSeries SET categoryId=target`;
   d. `UPDATE Budget SET categoryId=target` respetando `@@unique([categoryId, periodStart, coupleId])` / `([categoryId, periodStart, ownerId])`: si colisiona → **estrategia de merge** (sumar amounts o **409** explicando — decisión de producto, §5);
   e. `DELETE Category`.
3. **Borrado simple directo** solo si `COUNT(gastos + budgets + recurrentes) = 0`.
4. Alternativa **no destructiva "ocultar"** recomendada por UX frente a borrar; su implementación por-espacio se difiere con `CategoryPreference`.
5. Cascadas: borrar el Espacio cascadea sus custom (`onDelete: Cascade` en `group`, existente); borrar el User cascadea sus personales (nuevo `onDelete: Cascade` en `owner`).

### 2.6 Encaje con Espacios y budgets

- **COUPLE / GROUP**: caso natural, custom por `groupId`, gestión `OWNER`/`ADMIN` (rol desde `Membership`, no del JWT).
- **EPHEMERAL**: tiene fila `Couple` y `groupId` válido → soporta custom. Añadir predicado `allowsCustomCategories(type)` en `src/lib/space-policy.ts` (permitido en COUPLE/GROUP/EPHEMERAL), coherente con `allowsBudgetsAndRecurring`. Las categorías solo clasifican, no implican budget (que EPHEMERAL veta).
- **INDIVIDUAL**: sin fila `Couple`; se resuelve con personales (`ownerId=userId`) vía `/api/me/categories` y la variante por `ownerId` de `resolveCategoryId`. Es la única razón del cambio de schema.
- **Estado del espacio**: lectura del MERGE permitida en `ARCHIVED` (`allowArchived`) para que los históricos rendericen su categoría; CRUD bloqueado en `SETTLING`/`ARCHIVED` por el gate de writability existente.
- **Privacidad**: las personales (`ownerId`) nunca aparecen en un espacio compartido y viceversa, misma regla que `Tag`/`Budget` personales.

---

## 3. Plan por fases (incrementales y desplegables)

### Fase 0 — Registro de iconos y unificación de fuente
- **Objetivo:** eliminar la triplicación del icono y crear el resolver string→componente.
- **Cambios:** nuevo `src/lib/category-icons.ts` (`ICON_REGISTRY`, incluye los 8 nombres system); refactor de `src/lib/categories.ts` para derivar su componente del registro.
- **Hecho cuando:** las 8 system renderizan idéntico usando `ICON_REGISTRY`; `npx vitest run` verde; sin cambios visuales.

### Fase 1 — Schema `ownerId` (expand)
- **Objetivo:** dar hogar a las categorías personales sin romper nada.
- **Cambios:** `ownerId String?` + relación `PersonalCategory` (`onDelete: Cascade`) + `@@unique([ownerId, key])` + `@@index([ownerId])`; `User.personalCategories`. Migración aditiva pura.
- **Hecho cuando:** `prisma migrate deploy` aplica limpio en un entorno con datos; toda fila existente sigue siendo system (`ownerId=null`); suite verde.

### Fase 2 — Lectura DB-driven + `resolveCategoryId` con `{groupId, ownerId}`
- **Objetivo:** que la resolución y la lectura contemplen las tres capas.
- **Cambios:** nueva firma `resolveCategoryId(key, { groupId, ownerId })`; ampliar `CATEGORY_REF_SELECT` en `src/lib/category-read.ts` con metadata visual (`emoji, iconName, hex, label, labelEn, isSystem, sortOrder`); helper de MERGE efectivo (system ∪ custom del contexto, sombreado por key, orden `sortOrder, key`) reutilizable por API y páginas server.
- **Hecho cuando:** las páginas server pueden emitir `categoryMeta` DB-driven; test de MERGE/sombreado (extiende `category-read.test.ts`).

### Fase 3 — API CRUD (sin UI todavía) y fin de las whitelists
- **Objetivo:** persistir y validar categorías custom de extremo a extremo.
- **Cambios:** `src/app/api/spaces/[id]/categories/route.ts` y `src/app/api/me/categories/route.ts` (GET MERGE + POST/PATCH/DELETE/reorder con gates); **sustituir** `VALID_CATEGORIES`/`Object.keys(CATEGORIES)` en `api/expenses/route.ts`, `api/expenses/[id]/route.ts` y `api/budget/route.ts` por validación contra la lista efectiva (key desconocida → 400). Validación server de emoji/icon/hex.
- **Hecho cuando:** vía API se crea una custom, se asigna a un gasto/budget y `categoryKeyOf` la devuelve sin caer a `other`; borrado con reasignación probado (incluida colisión de Budget); e2e de creación+gasto verde.

### Fase 4 — Componentes de render y pickers
- **Objetivo:** pintar categorías DB-driven en toda la app.
- **Cambios:** nuevos `src/components/category/category-badge.tsx`, `category-picker.tsx`, `category-editor.tsx`, `emoji-picker.tsx`, `icon-picker.tsx`, `color-swatch-picker.tsx`, `delete-category-modal.tsx`. Migrar el render inline de dashboard, `expense-card`, analytics, `budget/client`, `settle`, `filters` a `CategoryBadge`/metadata por prop.
- **Hecho cuando:** una custom se ve con su emoji/icono/color en dashboard, lista, analytics y budget; los selectores de `expenses/new` y `expense/[id]/edit` usan `CategoryPicker`.

### Fase 5 — Vista de gestión `/categories` y entrada en Ajustes
- **Objetivo:** cerrar el flujo de usuario.
- **Cambios:** nueva vista `/categories` (toggle Común/Personal, badge "Sistema", CRUD gated, drag/reorder de custom, borrado con reasignación); fila "Categorías" en `src/app/settings/settings-client.tsx`; `allowsCustomCategories(type)` en `space-policy.ts`.
- **Hecho cuando:** un `OWNER`/`ADMIN` crea/edita/reordena/borra custom de espacio y un usuario INDIVIDUAL gestiona las personales; e2e de la pantalla verde.

### Fase 6 (opcional) — Extras de producto
- `POST .../duplicate` (duplicar system→custom); importador CSV con categoría por defecto; export con `label` DB-driven. Diferible.

> **Nota de despliegue:** cada fase es independientemente desplegable. La migración de la Fase 1 es la única de schema y es puramente expand, así que respeta el auto-migrate on-start y el runbook expand/contract. Ninguna fase requiere contract (no hay drops nuevos).

---

## 4. Inventario de vistas

### Vistas modificadas

| Ruta | Ficheros | Cambio principal | Prioridad |
|---|---|---|---|
| `/dashboard` | `src/app/dashboard/page.tsx`, `src/components/dashboard/expense-card.tsx` | Vista con más hardcode. Dejar de importar `@/lib/categories`; el server pasa `categoryMeta` (MERGE del contexto). Barra "Flujo de gastos" y `topCategory` por `hex`/`label` DB-driven; `expense-card` recibe metadata por prop (gastos de espacio y personales resuelven en distinto contexto). Respetar orden `sortOrder, key`. | Alta |
| `/expenses/new` | `src/app/expenses/new/page.tsx` | Grid estático → `CategoryPicker` según `expenseType` (`shared`→`/api/spaces/[id]/categories`, `personal`→`/api/me/categories`); resetear selección si la key deja de existir al cambiar de tipo. `VALID_CATEGORY_IDS` (filtro del OCR) valida contra la lista efectiva, no el Set fijo. Default `food` sigue siendo key garantizada o primer elemento. Estados carga/vacío/error + enlace "Gestionar categorías". | Alta |
| `/expense/[id]/edit` | `src/app/expense/[id]/edit/client.tsx`, `.../page.tsx` | Grid estático → `CategoryPicker` en el contexto correcto (`isPersonal`→`/api/me`, si no `/api/spaces/[coupleId]`). Incluir la categoría **actual** aunque no esté en el set editable (no perderla). OCR re-scan valida contra el set efectivo. Render por `hex`/`emoji` DB-driven. | Alta |
| `/expenses/list` | `src/app/expenses/list/page.tsx`, `.../client.tsx`, `src/components/expenses/filters.tsx` | Chips de filtro con lista efectiva del espacio (prop desde `page.tsx` o fetch); incluir keys huérfanas presentes en los items. Filtrado client por key sigue igual. Chips y filas por metadata DB-driven. | Alta |
| `/analytics` | `src/app/analytics/page.tsx`, `.../client.tsx` | Eliminar `CATEGORY_COLORS` hardcode; el server emite `hex` y `label` reales por ítem; cliente pinta `fill={item.hex}`. `topCategory` con `label` DB-driven. | Alta |
| `/budget` | `src/app/budget/client.tsx`, `.../page.tsx`, `src/app/api/budget/route.ts` | Cargar lista efectiva por scope (toggle Común/Personal). Icono → `ICON_REGISTRY[iconName]`, color → `hex` inline. **Crítico:** `VALID_CATEGORIES = Object.keys(CATEGORIES)` rechaza custom con 400 → validar contra la lista efectiva; `resolveCategoryId` con `{groupId, ownerId}`. | Alta |
| `/settle/[id]`, `/settle` | `src/app/settle/[id]/page.tsx`, `src/app/settle/page.tsx` | `settle/[id]` resuelve el emoji desde metadata DB-driven del espacio (permitir `allowArchived`). `settle/page.tsx` solo transporta la key; sin cambios funcionales. | Media |
| `/settings` | `src/app/settings/settings-client.tsx` | Añadir fila "Categorías" → `/categories`, siguiendo el patrón de Etiquetas/Presupuestos. Visible para todos; CRUD de espacio gated dentro de la vista. | Media |
| `/expenses/import` | `src/app/expenses/import/page.tsx`, `src/app/api/expenses/import/route.ts` | (Opcional) Selector de categoría por defecto alimentado por la lista efectiva; en `route.ts` pasar `groupId/ownerId` a `resolveCategoryId` y validar la key. Hoy todo cae a `other`. | Baja |

### Vistas nuevas

- **`/categories`** — gestión (hermana de `/tags` y `/budget`). Toggle Común/Personal: en "Común" lista el MERGE del espacio (system fijas + custom) con CRUD solo `OWNER`/`ADMIN` y badge "Sistema" en las no editables; en "Personal" (o INDIVIDUAL) lista system + personales vía `/api/me/categories`. Cada fila: emoji/icono + label + chip `hex` + acciones (editar, borrar-con-reasignación, drag/reorder de custom). Botón "Nueva categoría" abre el editor. Estados vacío/carga/error; CRUD bloqueado en `SETTLING`/`ARCHIVED`.
- **`/categories/[id]/edit`** (opcional) — formulario dedicado si no se usa modal. Prohibido para `isSystem` (403). Por defecto se recomienda **modal/bottom-sheet**.

### Componentes / libs nuevos

| Fichero | Rol |
|---|---|
| `src/lib/category-icons.ts` | `ICON_REGISTRY` (~30–40 iconos estáticos, incluye los 8 system). Única fuente para picker, render y validación. |
| `src/components/category/category-picker.tsx` | Selector transversal (reemplaza los grids de `expenses/new`, `expense/[id]/edit` y la fuente de chips de `filters.tsx`). Carga MERGE por contexto; puede forzar la "categoría actual" para edición. |
| `src/components/category/category-badge.tsx` | Render puro DB-driven `{emoji,label,hex,iconName}`. Centraliza el pintado en expense-card, dashboard, analytics, budget, settle. |
| `src/components/category/category-editor.tsx` | Crear/editar. Campos `label` (obligatorio), `labelEn` (opcional→copiar de `label`), sub-pickers de emoji/icono/color. Validación cliente-espejo. Aviso si la key sombrea una system. |
| `src/components/category/emoji-picker.tsx`, `icon-picker.tsx`, `color-swatch-picker.tsx` | Sub-pickers: emoji (1 grapheme, `Intl.Segmenter`); icono (keys de `ICON_REGISTRY`); color (paleta cerrada de swatches hex, patrón de `TAG_PRESET_COLORS`). |
| `src/components/category/delete-category-modal.tsx` | Borrado con reasignación obligatoria; maneja el 409 de colisión de Budget; nunca ofrece borrar `isSystem`. |
| `src/app/api/spaces/[id]/categories/route.ts` | CRUD de espacio (gates `requireSpaceAccess`). |
| `src/app/api/me/categories/route.ts` | CRUD personal (sesión). |

**Refactors de libs existentes:** `src/lib/categories.ts` (deja de ser fuente de verdad de la UI; deriva icono de `category-icons.ts`, expone las 8 system como semilla/fallback), `src/lib/category-db.ts` (nueva firma de `resolveCategoryId`), `src/lib/category-read.ts` (metadata en `CATEGORY_REF_SELECT` + helper de MERGE), `src/lib/space-policy.ts` (`allowsCustomCategories`). Impacto menor en `src/app/api/export/route.ts` (opcional: emitir `label` DB-driven; no bloqueante).

---

## 5. Riesgos y decisiones abiertas

**Riesgos**
- **Whitelists silenciosas (bloqueante).** Mientras `VALID_CATEGORIES`/`Object.keys(CATEGORIES)` sigan vigentes, toda categoría custom se degrada a `other` (gastos) o se rechaza con 400 (budget/edición). Es el primer cambio a hacer al abrir la Fase 3; sin él las fases de UI no aportan valor.
- **Render DB-driven de las system.** Al unificar el render por `hex`, si `ICON_REGISTRY` no incluye los 8 nombres system, las propias categorías de sistema dejan de pintarse. La Fase 0 debe blindar esto con un test.
- **Componentes `use client` y N+1/flash.** Las páginas cliente consumen el mapa estático hoy; pasar a metadata DB-driven exige propagarla desde el server (props) o fetch, con estados carga/vacío/error para evitar parpadeos. Evitar consultas por-fila (resolver el MERGE una vez por request).
- **Colisión de Budget al reasignar.** El `@@unique([categoryId, periodStart, scope])` puede chocar durante el UPDATE del borrado; sin manejo explícito la transacción falla de forma opaca.
- **Colores tailwind purgados.** Cualquier intento de seguir usando clases dinámicas para color de custom fallará por el JIT; el inline por `hex` es obligatorio, no opcional.
- **`MySQL` + `UNIQUE` sobre `NULL`.** `@@unique([groupId,key])` y `@@unique([ownerId,key])` no se aplican cuando el discriminante es `NULL`; mantener el patrón `findFirst` en seed/resolución (ya en uso).

**Decisiones abiertas**
1. **¿Custom puede sombrear keys system** (p.ej. crear `food` propia) o se reservan las 8? El schema y el test `mascotas` lo permiten; decidir si la UI lo ofrece con aviso "reemplaza la del sistema" o lo prohíbe.
2. **¿V1 necesita ocultar/desactivar y reordenar las system por espacio?** Si sí, hay que introducir `CategoryPreference` (coste extra de schema y de lectura con LEFT JOIN). **Recomendación:** diferir a fase 2; V1 solo reordena/borra custom.
3. **Colisión de Budget al reasignar:** ¿sumar amounts, quedarse con el del target, o abortar con 409? Afecta a la contabilidad.
4. **i18n `labelEn`:** es NOT NULL pero la UI nunca lo renderiza. ¿Se mantiene y el editor pide ambos idiomas (copiando `label` si falta), o se hace nullable / se elimina hasta que exista locale switcher?
5. **¿`duplicar system→custom` en V1** (buena UX) o se pospone?
6. **Gestión de categorías de espacio:** ¿solo `OWNER`/`ADMIN`, o cualquier `MEMBER` puede crear/editar (`GUEST` siempre lectura)?
7. **Destino de reasignación al borrar:** ¿forzar default `other` o obligar a elegir explícitamente en el modal?
8. **Paleta de color:** ¿estrictamente cerrada (consistencia de marca) o hex libre (seguro vía inline, pero rompe consistencia)?
9. **Tamaño/curación de `ICON_REGISTRY`** (~30–40): qué iconos concretos, confirmando que cubre los 8 nombres system.