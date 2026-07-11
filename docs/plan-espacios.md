# Plan de implementación — Funcionalidad "Espacios" de Kill Bill

**Modos:** Individual · Pareja · Grupos · Grupos Efímeros (con invitados sin cuenta)
**Repositorio:** `/Users/jeromo/Dev/killbill` (todas las rutas de fichero son relativas a esta raíz)

---

## 1. Estado actual

Qué hay construido y qué falta, con referencias al código real:

- **La migración Couple→Group está hecha en semántica, no en nombre.** Las fases F1–F5 (julio 2026) crearon `Membership` (roles `OWNER/ADMIN/MEMBER`, status `ACTIVE/LEFT/REMOVED`) y eliminaron `User.coupleId`: Membership es la única fuente de pertenencia (`prisma/migrations/20260704093000_phase1_group_membership/`, `20260709100000_phase5_contract_drops/`). El rename de la tabla `Couple`→`Group` queda documentado en `prisma/schema.prisma` como fase contract futura y **no** forma parte de esta feature.
- **La matemática financiera ya es N-way.** `src/lib/finance.ts` (balances netos + `resolveMyDebts` greedy, testeado con 3-4 usuarios), `src/lib/splits.ts` (reparto de tickets a N miembros) y el ledger de doble entrada (`src/lib/ledger.ts`, `ledger-read.ts`, dedupeKeys idempotentes) funcionan con `MAX_GROUP_MEMBERS=20` (`src/lib/membership.ts`). Dashboard y settle ya leen balances del ledger.
- **Multi-grupo operativo (F4).** `getActiveGroup` valida la cookie `active_group` contra Membership ACTIVE con fallback a `getPrimaryGroup` (`src/lib/membership.ts`); existe `SpaceSwitcher` (`src/components/nav/space-switcher.tsx`) y gestión multi-grupo en `src/app/settings/settings-client.tsx`. El orden de miembros por `joinedAt` es *load-bearing* para el reparto determinista de céntimos.
- **El modo Individual existe a medias.** `Expense.visibility=PERSONAL` con `coupleId NULL` + `ownerId`, `Budget` personal por `ownerId`, import CSV 100 % personal (`src/app/api/expenses/import/route.ts`). Pero es "ausencia de grupo", no un modo: el dashboard trata al usuario solo como "pareja incompleta" (`InviteCard`, FAB deshabilitado en `src/app/dashboard/page.tsx`), y las etiquetas exigen grupo (`Tag.coupleId` NOT NULL — un gasto PERSONAL nunca puede llevar tag).
- **No existe tipo ni ciclo de vida de espacio.** `Couple` no tiene `type`, `status`, `archivedAt` ni `expiresAt` (`prisma/schema.prisma`). Un `Group` con `type ENUM('GROUP','COUPLE')` existió en enero 2026 y fue eliminado (`prisma/migrations/20260128202437_add_invite_codes/`). La salida del último miembro en `src/app/api/couple/unlink/route.ts` hace **hard-delete de todo el historial** — incompatible con efímeros archivables.
- **No hay acceso de invitado sin cuenta.** Toda identidad exige `User` con email+password: registro con código obligatorio (`src/app/register/actions.ts`), sesión JWT solo desde login (`src/lib/auth.ts`, `src/lib/jwt.ts`, payload `{userId, email, isAdmin}`, 7d, sin revocación server-side). El schema **ya** tolera invitados: `User.email/password/pin` son nullable, y `Split/Settlement/Account/LedgerEntry` cuelgan de `User.id` — un "User sombra" funciona sin tocar la matemática.
- **La invitación a grupo es insuficiente.** `Couple.code` es permanente, multi-uso, 6 hex (~16,7M, fuerza-brutable — `/api/couple/join` **sin rate limit**), y `InviteCode` es alta global de admin sin vínculo a grupo. Además `loginAction` hace **auto-join silencioso** vía `?code=` (`src/app/login/actions.ts`) — vulnerabilidad: un enlace mete a la víctima en un grupo ajeno sin consentimiento.
- **Restos de pareja que corrompen datos con N>2.** `PATCH /api/expenses/[id]` usa `partner = members.find(m => m.id !== paidById)` y la heurística `existingSplits.length === 2` — una edición sin customSplits puede colapsar un split N-way a 2 personas (`src/app/api/expenses/[id]/route.ts`). El archivado de `/settle` envía el checkpoint 0 € a un "partner" arbitrario (`src/app/settle/client.tsx`), el cutoff de "gastos sin liquidar" es una fecha global (incorrecto pairwise, `src/app/settle/page.tsx`), y el detalle de gasto renderiza "Solo {partner}" binario (`src/app/expense/[id]/page.tsx`).
- **Autorización inconsistente contra el grupo activo.** `expenses/[id]` y sus tags ya autorizan contra el grupo **del recurso** (correcto), pero `settle/[id]/status`, `tags/[id]`, `expenses/[id]/share`, `export` y `recurring` operan solo sobre `getActiveGroup` → 403 rotos y escrituras en el grupo equivocado en multi-grupo. `settle/[id]` (detalle) **no valida pertenencia al grupo** en absoluto.
- **Riesgos estructurales pendientes.** Cascadas `User→Expense` (`paidById`/`ownerId` onDelete Cascade): borrar un User destruiría la contabilidad del grupo. Gastos sin filas `Split` se re-dividen retroactivamente entre los miembros actuales en `finance.ts`, divergiendo del ledger congelado — hay que materializar Splits siempre. Recibos en `public/uploads` públicos por URL aleatoria (`src/app/api/upload/route.ts`). Rate limiting in-memory solo en login/register (`src/lib/rate-limit.ts`).

---

## 2. Diseño propuesto

Síntesis ganadora: **base del Diseño 3 (seguridad-primero)** + la policy y el ciclo `SETTLING` del Diseño 2 + el minimalismo migratorio del Diseño 1.

### 2.1 Los cuatro modos

| Modo | Representación | Cap | Balance/UI | Invitados |
|---|---|---|---|---|
| **Individual** | **Virtual**: `visibility=PERSONAL` + `ownerId` + entrada "Personal" del SpaceSwitcher. **No se crean filas** de espacio (cero migración de gastos personales); `INDIVIDUAL` queda reservado en el enum. | 1 | Sin balances/settle/ledger; presupuestos, import CSV y (nuevo) tags personales | No |
| **Pareja** (`COUPLE`) | Fila `Couple` con `type=COUPLE` | 2 estricto | `VisualBalance` (balanza de 2 platillos); presets "Mitad y mitad", "Favor para {nombre}" | No |
| **Grupo** (`GROUP`) | `type=GROUP` | 20 | `MemberBalanceList` + deudas pairwise (`resolveMyDebts`) | No |
| **Efímero** (`EPHEMERAL`) | `type=EPHEMERAL` + `expiresAt` | 20 | Como GROUP + countdown + flujo de cierre | **Sí** (solo aquí) |

Reglas clave:
- El tipo **se elige al crear y nunca se infiere del número de miembros**. Único upgrade permitido: `COUPLE→GROUP` ("Convertir en grupo", escape del cap 2 y del backfill mal clasificado).
- Ciclo de vida: `ACTIVE → SETTLING → ARCHIVED` (reabrible `SETTLING→ACTIVE`). `SETTLING` bloquea gastos nuevos pero permite liquidar; `ARCHIVED` es solo lectura y revoca invitaciones/sesiones guest.
- Salida del último miembro (sustituye el hard-delete de `unlink`): **borrar solo si el espacio está completamente vacío** de `Expense`/`Settlement`; **archivar si tiene historial**.
- Reglas centralizadas en un nuevo `src/lib/space-policy.ts`: `SPACE_CAPS = {COUPLE: 2, GROUP: 20, EPHEMERAL: 20}`, `allowsGuests` solo EPHEMERAL, join por `Couple.code` deshabilitado en EPHEMERAL (solo enlaces expirables) y rotable en COUPLE/GROUP, `assertSpaceWritable(status)`.

### 2.2 Modelo de datos (cambios Prisma concretos — todo *expand*, sin *contract*)

**Migración 1 — `add_space_type_lifecycle`** (sobre `Couple`, sin renombrar la tabla):

```prisma
enum SpaceType   { INDIVIDUAL COUPLE GROUP EPHEMERAL }   // INDIVIDUAL reservado, sin filas
enum SpaceStatus { ACTIVE SETTLING ARCHIVED }

model Couple {
  // ...existente...
  type        SpaceType   @default(COUPLE)
  status      SpaceStatus @default(ACTIVE)
  archivedAt  DateTime?
  expiresAt   DateTime?               // solo EPHEMERAL
  createdById String?                 // FK User, onDelete: SetNull (auditoría)
  @@index([status, expiresAt])
}
```
Todas las columnas con DEFAULT — el código viejo las ignora. El backfill de `type` **no va en el SQL**: script manual verificable `scripts/backfill-space-types.ts` (patrón `backfill-ledger.ts`): `UPDATE` a `GROUP` donde `COUNT(Membership ACTIVE) > 2`, con SELECT previo y reversible.

**Migración 2 — `add_guest_access`:**

```prisma
enum MembershipRole { OWNER ADMIN MEMBER GUEST }  // GUEST AL FINAL del enum
                                                  // (metadata-only en MySQL 8; revisar el SQL
                                                  //  generado por Prisma para que no reordene)

model GroupInvite {
  id          String    @id @default(cuid())
  groupId     String                        // FK Couple, onDelete: Cascade
  tokenHash   String    @unique             // sha256 del token; el token en claro no se guarda
  tokenPrefix String                        // para listarlo en la UI
  kind        InviteKind                    // MEMBER | GUEST (GUEST solo en EPHEMERAL activo)
  maxUses     Int
  usedCount   Int       @default(0)
  expiresAt   DateTime                      // OBLIGATORIO
  revokedAt   DateTime?
  createdById String
  createdAt   DateTime  @default(now())
}

// User:       isGuest Boolean @default(false), upgradedAt DateTime?
// Membership: guestTokenHash String? @unique   (enlace personal de recuperación; NULLs múltiples OK en MySQL)
// Expense:    createdById String? (FK SetNull + índice) — backfill COALESCE(ownerId, paidById)
// Tag:        ownerId String? nullable — XOR por convención con coupleId (patrón Budget) → tags personales
```

**Migración 3 — `restrict_user_money_cascades`** (posterior, aislada): `Expense.paidById`/`ownerId` pasan de `Cascade` a `Restrict` desde `User`, precedida de script de validación (patrón `scripts/validate-check-constraints.ts`). Convierte "nunca borrar un User con actividad" de disciplina a garantía de schema.

**Sin cambios** en `Split`, `Settlement`, `Account`, `Ledger*`, `Budget`, `Category`, `RecurringSeries` ni `InviteCode` (sigue siendo el alta global de admin). Regla de aplicación sin schema: **materializar filas `Split` SIEMPRE** al crear gasto SHARED + `scripts/backfill-splits.ts` para históricos, verificado con `scripts/reconcile-ledger.ts` **antes** de habilitar rotación de miembros.

### 2.3 Acceso de invitados sin cuenta (solo EPHEMERAL)

- **Identidad:** invitado = **User sombra** `{name, isGuest: true, email/password NULL}` + `Membership role=GUEST`. Split/Settlement/Account/LedgerEntry funcionan sin tocar `finance.ts`, `splits.ts` ni `ledger.ts`; la conversión a cuenta real es un `UPDATE` de la misma fila.
- **Token de invitación:** `base64url(randomBytes(32))` (256 bits), se muestra **una sola vez**; en DB solo `tokenHash` (sha256) + `tokenPrefix`. Canje transaccional con `updateMany` condicional (mismo patrón anti-carrera del `InviteCode` actual). `maxUses`, `expiresAt` obligatorio, `revokedAt`.
- **Enlace y consentimiento:** página pública `/i/[token]` (fuera del guard de `src/proxy.ts`), `Referrer-Policy: no-referrer`, preview rate-limited por IP, redirect a URL limpia tras canje. Pantalla de consentimiento con tres opciones: entrar como invitado (solo un nombre + aviso RGPD), login, o registro. **Sustituye y elimina el auto-join silencioso de `/login?code=`.** Con sesión activa: confirmación explícita "Unirte a {espacio} como miembro".
- **Sesión guest:** misma cookie `session_token`, JWT `{userId, kind:'guest', groupId, role, exp: 72h}` con renovación deslizante que **re-firma** (tope duro en `Couple.expiresAt`). `getSession` devuelve un `SessionContext` y para guests **revalida siempre en DB** Membership ACTIVE + status del espacio → revocación per-request sin blacklist: expulsar = `REMOVED`, archivar corta a todos.
- **Recuperación multi-dispositivo:** al canjear se emite un enlace personal (por `Membership.guestTokenHash`, rotable) mostrado una vez — resuelve el invitado duplicado si cambia de móvil.
- **Upgrade a cuenta:** `POST /api/guest/upgrade {email, password}` sobre la misma fila User (`isGuest→false`, rol `GUEST→MEMBER`, JWT normal 7d). `P2002` → "Ese email ya tiene cuenta: inicia sesión" (v1 sin merge de identidades).
- **Bajas y RGPD:** los User sombra con actividad **nunca** se borran físicamente (las cascadas destruirían la contabilidad); baja = `REMOVED`, supresión = anonimización (`name→'Invitado'`) que preserva el zero-sum del ledger. Purga de espacios archivados con orden correcto (espacio antes que Users) + limpieza de `public/uploads`, vía cron opcional.

### 2.4 Autorización por modo y rol

Helper central nuevo **`src/lib/authz.ts` → `requireSpaceAccess(ctx, groupId, {roles?, allowGuest?, allowArchived?})`**: autoriza **siempre contra el grupo del recurso** (la cookie `active_group` queda como preferencia de UI), verifica rol contra Membership en DB (nunca solo el claim del JWT), aplica `assertSpaceWritable` por status, y para guests exige `groupId === guestGroupId` del JWT + Membership ACTIVE.

Matriz del rol **GUEST** (acotado a su único espacio EPHEMERAL):

| Permitido | Vetado |
|---|---|
| Ver miembros, gastos y balance del espacio | Todo lo personal (scope personal, import/export, promote/share) |
| Crear gastos SHARED | Tags CRUD (solo selección), budgets, analytics |
| Editar/borrar **solo los suyos** (por `Expense.createdById` — campo nuevo imprescindible) | Crear/unirse a otros espacios, gestionar invitaciones |
| Settle como emisor y **confirmar como receptor** (desbloquea "solo el receptor confirma") | `/api/admin/*`, `/api/setup`, `/settings`, perfil |
| Upload/OCR con rate limit por userId + cap por espacio/día (coste Gemini) | Unlink de otros (solo salir él mismo) |

`src/proxy.ts`: `/i/*` público; guests solo a `/dashboard`, `/expenses/*`, `/expense/*`, `/settle*` (ojo: `/expenses/import` cuelga de `/expenses/*` → guard adicional en página/handler).

**Endpoints nuevos:** `POST/GET /api/spaces` (creación tipada; `/api/couple` POST queda como alias deprecado→COUPLE), `PATCH /api/spaces/[id]` (transiciones de estado), `POST /api/spaces/[id]/settle-up` (→SETTLING + Settlements PENDING sugeridos por `resolveMyDebts`), `POST/GET/DELETE /api/spaces/[id]/invites`, `GET /i/[token]` + preview, `POST /api/invites/claim`, `POST /api/guest/upgrade`, `GET /api/spaces/[id]/balance` (los balances hoy solo viven en server components; los guests lo necesitan como API), `DELETE /api/spaces/[id]/members/[userId]` (→REMOVED/LEFT, nunca DELETE físico), `POST /api/spaces/[id]/rotate-code`, `POST /api/cron/purge` (x-cron-secret).

**Endpoints modificados:** `/api/couple/join` gana rate limit por IP + cap por `SPACE_CAPS[type]` (error `SPACE_FULL` con sugerencia "Convertir en grupo") + rechaza EPHEMERAL y no-ACTIVE; `/api/couple/unlink` archiva en vez de borrar cuando hay historial; `loginAction` elimina el auto-join (redirect a consentimiento); `PATCH /api/expenses/[id]` se **reescribe N-way** desde `splitStrategy` persistido; `settle/[id]/status`, `settle/[id]`, `tags/[id]`, `share` (con `targetGroupId`), `export` y `recurring` migran a `requireSpaceAccess` contra el recurso; `POST /api/expenses` persiste Splits siempre + `createdById` + `assertSpaceWritable`; `/api/tags` gana variante personal; el cutoff de `/settle` se rehace pairwise/desde ledger.

---

## 3. Plan por fases

Cada fase es un deploy Coolify normal (`prisma migrate deploy` en el `CMD` del contenedor; si la migración falla, el contenedor anterior sigue sirviendo; rollback = imagen previa — las columnas nuevas no molestan). Gates: e2e Playwright + unit/lint bloqueantes en `.github/workflows/deploy.yml`.

### Fase 0 — Schema expand (deploy 1)
- **Objetivo:** aterrizar todas las columnas/tablas nuevas sin cambiar comportamiento.
- **Schema:** migraciones 1 (`add_space_type_lifecycle`) y 2 (`add_guest_access`) — aditivas, con DEFAULT; el código actual las ignora. Backfill `Expense.createdById = COALESCE(ownerId, paidById)` dentro de la migración 2.
- **API/UI:** ninguno.
- **Hecho cuando:** pre-vuelo en staging contra dump de prod pasa; deploy en prod sin errores; la app funciona idéntica; revisado el SQL generado para `MembershipRole` (GUEST añadido al final, sin reorden).

### Fase 0.5 — Backfills manuales (sin deploy)
- **Objetivo:** datos correctos antes de ramificar por tipo y abrir rotación de miembros.
- **Cambios:** `scripts/backfill-space-types.ts` (→GROUP donde >2 miembros ACTIVE, con SELECT previo) y `scripts/backfill-splits.ts` (materializar Splits históricos).
- **Hecho cuando:** `scripts/reconcile-ledger.ts` confirma igualdad ledger==finance tras el backfill. **Bloqueante** antes de la Fase 3.

### Fase 1 — Tipos, ciclo de vida y corrección N-way (deploy 2)
- **Objetivo:** los modos Pareja/Grupo funcionan correcta y visiblemente; el modo Individual es operativo; se arreglan los bugs que corrompen datos.
- **API:** `src/lib/space-policy.ts` + `src/lib/authz.ts`; `POST/GET /api/spaces` + `PATCH` (estados) + `settle-up` + `members/[userId]` + `balance`; caps por tipo en join; `unlink`→archivar-si-historial; **reescritura N-way del PATCH de gasto** (fuera `partner=members.find(...)` y `existingSplits.length===2`); `requireSpaceAccess` en `settle/[id]/status`, `settle/[id]`, `tags/[id]`, `share`, `export`, `recurring`; fix del cutoff pairwise de settle; Splits siempre persistidos + `createdById` en el POST; tags personales (`Tag.ownerId`).
- **UI:** dashboard bifurca por `space.type` (no `members.length`); espacio de 1 miembro operativo; `NoGroupState` pasa de muro a invitación opcional; SpaceSwitcher tipado con sección Archivados; `/spaces/new`, `/spaces/[id]`, `/spaces/[id]/close`; `SplitEditor` N-way compartido entre alta y **edición reescrita** de gasto; fix del footer binario del ticket en `/expense/[id]`; fix del archivado de pareja en `/settle`; hub de espacios en Ajustes; toggle personal en `/tags`; `SpaceStatusBanner`.
- **Hecho cuando:** e2e nuevos de grupo de 3-4 miembros (crear/editar/liquidar sin corrupción de splits) y de archivado pasan; los e2e existentes de pareja siguen verdes; un settlement de un grupo no activo se confirma sin 403.

### Fase 2 — Invitaciones por enlace para registrados + cierre del auto-join (deploy 3)
- **Objetivo:** mejora de seguridad independiente de los invitados.
- **API:** `POST/GET/DELETE /api/spaces/[id]/invites` (kind MEMBER), `GET /i/[token]` + preview (RL por IP), `POST /api/invites/claim` (con sesión → join con consentimiento), `rotate-code`, RL por IP en `/api/couple/join`.
- **UI:** página `/i/[token]` con consentimiento; `loginAction` deja de hacer join (redirige a consentimiento — no rompe enlaces antiguos `/login?code=X`); `InviteCard` y `JoinGroupCard` migran a GroupInvite/enlaces; `InviteManager`; `registerAction` canjea GroupInvite y respeta `SPACE_CAPS`.
- **Hecho cuando:** ningún camino hace join sin consentimiento explícito; el token solo se muestra una vez; e2e de canje/expiración/revocación pasan.

### Fase 3 — Invitados GUEST, detrás de `EPHEMERAL_SPACES_ENABLED` (deploy 4)
- **Objetivo:** grupos efímeros completos con invitados sin cuenta.
- **API:** claim GUEST (User sombra + Membership GUEST + JWT `kind:'guest'` 72h re-firmado, revalidación DB per-request en `getSession`), matriz de permisos GUEST vía `requireSpaceAccess`, `POST /api/guest/upgrade`, enlace de recuperación (`guestTokenHash`), rama guest en `src/proxy.ts`, cap OCR por espacio/día.
- **UI:** opción "Entrar como invitado" en `/i/[token]` + intersticial "Guarda tu enlace personal"; `GuestBanner`; `/guest/upgrade`; dashboard/lista/settle en modo guest (sin scope personal, sin import, confirmar settlements como receptor); BottomNav sensible a guest; flujo `/spaces/[id]/close` con countdown de `expiresAt`.
- **Hecho cuando:** un invitado entra en <30 s con solo un nombre, crea gastos, liquida y confirma; expulsarlo o archivar el espacio le corta la sesión en la siguiente request; apagar el flag no rompe sesiones ya convertidas; e2e del ciclo viaje completo (crear → invitar → gastar → settle-up → archivar) pasa.

### Fase 4 — Endurecimiento de cascadas (deploy posterior, aislado)
- Migración 3 `restrict_user_money_cascades` (Cascade→Restrict en `Expense.paidById/ownerId`) precedida del script de validación. **Hecho cuando:** borrar un User con actividad falla a nivel de DB.

### Fase 5 — Purga (opcional)
- `POST /api/cron/purge` + Coolify cron o GitHub Actions schedule. El sistema es correcto sin él (solo no purga). Depende de la decisión de retención (§5).

**Fuera de alcance:** rename `Couple`→`Group`, retirada de `User.pin`, `Couple.code` nullable (contracts futuros); migrar rate limiting a store compartido (aceptable single-instance).

---

## 4. Inventario de vistas

### 4.1 Vistas a modificar

| Ruta | Ficheros | Cambios clave | Prioridad |
|---|---|---|---|
| `/dashboard` | `src/app/dashboard/page.tsx`, `src/components/nav/space-switcher.tsx`, `src/components/ui/visual-balance.tsx`, `member-balance-list.tsx`, `no-group-state.tsx`, `src/components/dashboard/{invite-card,join-group-card,pending-settlements}.tsx` | Bifurcar por `space.type` (no tamaño); eliminar `partner=members.find(...)`; usuario sin grupo → modo Personal operativo; banners SETTLING/ARCHIVED + countdown; vista guest (sin scope personal, GuestBanner, confirmar settlements); copys neutros; misma fuente de balance que `GET /api/spaces/[id]/balance` | Alta |
| `/expense/[id]/edit` | `src/app/expense/[id]/edit/{page,client}.tsx` | **Reescritura** (prerequisito bloqueante): hidratar desde `splitStrategy` persistido, SplitEditor N-way único, fuera `splitWithPartner` y fallbacks "pareja"; guards guest (`createdById`) y SETTLING/ARCHIVED. Va con el rewrite del PATCH | Alta |
| `/expenses/new` | `src/app/expenses/new/page.tsx` | Retirar eje `isTwoMember` → SplitEditor N-way (iguales/importes/%/exclusive/favor con selector); items por chips de miembro; persistir Splits + `splitStrategy` + `createdById`; guard `assertSpaceWritable`; guest solo SHARED; preset "Mitad y mitad" destacado en COUPLE | Alta |
| `/expense/[id]` | `src/app/expense/[id]/page.tsx`, `src/components/expense/{delete-button,promote-button}.tsx` | Bug binario del footer del ticket ("Solo {partner}") → asignatario real por item; "Añadido por {createdBy}"; permisos guest (editar/borrar solo suyos, sin Promote/share); solo lectura en SETTLING/ARCHIVED | Alta |
| `/settle` | `src/app/settle/{page,client}.tsx` | Bug de archivado de pareja (`handleArchive`→`partner.id`, client.tsx:89-101) → pairwise; retirar prop `partner`; funcionar con sesión guest; centro del cierre en SETTLING (progreso de Settlements sugeridos + CTA archivar) | Alta |
| `/login` | `src/app/login/{page.tsx,actions.ts}` | **Eliminar auto-join silencioso** `?code=` → redirect a consentimiento tras autenticar; enlace "Tengo un enlace de invitación" | Alta |
| `/settings` | `src/app/settings/{page.tsx,settings-client.tsx}` | Hub de espacios: creación tipada → `POST /api/spaces`; lista con icono de tipo + badge de estado + Archivados; enlaces a `/spaces/[id]`; "Salir" con semántica archivar-si-historial; errores nuevos de join (`SPACE_FULL`…); "Crear enlace de invitación" + "Rotar código" | Alta |
| `/register` | `src/app/register/{page.tsx,actions.ts}` | Canje de GroupInvite transaccional al venir de `/i/[token]`; `SPACE_CAPS`/`SPACE_FULL`; rechazar EPHEMERAL/no-ACTIVE por código clásico; copy con nombre y tipo del espacio | Media |
| `/expenses/list` | `src/app/expenses/list/{page,client}.tsx`, `src/components/expenses/filters.tsx` | Accesible a guests sin acciones vetadas; solo lectura en ARCHIVED; "Favor para X" generalizado; indicador de espacio activo en header | Media |
| `/expenses/import` | `src/app/expenses/import/page.tsx` | Guard obligatorio anti-guest en página/handler (cuelga de `/expenses/*`, permitido a guests en el proxy) | Media |
| `/settle/history` | `src/app/settle/history/{page,client}.tsx` | Guests confirman/rechazan como receptor; solo lectura en ARCHIVED; dejar de ser huérfana (enlaces desde /settle y dashboard) | Media |
| `/settle/[id]` | `src/app/settle/[id]/page.tsx` | **Seguridad:** migrar a `requireSpaceAccess` (hoy no valida grupo); eliminar fallback 50/50 `Math.floor(amount/2)` | Media |
| `/budget` | `src/app/budget/{page,client}.tsx` | Guests vetados (coherente con proxy); condicional por `space.type` en EPHEMERAL (open question); solo lectura en ARCHIVED; chip de espacio activo | Media |
| `/tags` | `src/app/tags/{page,client}.tsx` | Tags personales (`Tag.ownerId`) con toggle Común/Personal; sin grupo ya no hay NoGroupState; DELETE migra a contra-recurso | Media |
| `/settle/[id]/edit` | `src/app/settle/[id]/edit/{page,client}.tsx` | `requireSpaceAccess`; guest solo como fromUser; bloquear en ARCHIVED | Baja |
| `/analytics` | `src/app/analytics/{page,client}.tsx` | Verificar redirect (no crash) para guest; NoGroupState → invitación opcional; solo lectura en ARCHIVED ("recuerdo del viaje"); desglose pairwise opcional | Baja |
| `/` | `src/app/page.tsx` | Solo copy: presentar los 4 modos; sin cambios de lógica | Baja |
| `/admin` | `src/app/admin/page.tsx` | Solo copy: distinguir InviteCode (registro en instancia) de GroupInvite (invitación a espacio) | Baja |

### 4.2 Vistas nuevas

| Ruta | Propósito |
|---|---|
| `/i/[token]` | Página pública de invitación (Fases 2-3): preview rate-limited, consentimiento con 3 opciones (invitado/login/registro), estados de error (expirado/revocado/agotado/`SPACE_FULL`/archivado), aviso RGPD, intersticial "Guarda tu enlace personal" tras canje GUEST. `Referrer-Policy: no-referrer` |
| `/spaces/new` | Creación tipada: nombre + tarjetas 💑/👪/✈️ + `expiresAt` solo EPHEMERAL. El tipo se elige aquí, nunca se infiere |
| `/spaces/[id]` | Gestión del espacio (hoy inexistente): miembros con roles y expulsión (→REMOVED), invitaciones (crear/listar por `tokenPrefix`/revocar), rotar código, "Convertir en grupo", "Cerrar y liquidar", "Reabrir", "Archivar", salida propia |
| `/spaces/[id]/close` | Flujo guiado de cierre del viaje: resumen pairwise, settle-up, checklist de Settlements con progreso, "Archivar espacio" |
| `/guest/upgrade` | Conversión invitado→cuenta: `{email, password}` sobre la misma fila User; manejo de P2002; solo sesión `kind:'guest'` |
| `/welcome` (opcional) | Onboarding de primer uso sin grupo: "Solo para mí" / "Crear un espacio" / "Tengo una invitación". Saltable |

### 4.3 Componentes

**Modificados:** `src/components/nav/space-switcher.tsx` (iconos por tipo, subtítulos contextuales, Archivados, render también en list/budget/analytics/tags, versión guest sin switcher), `src/components/nav/bottom-nav.tsx` (sensible a guest y a modo Personal), `src/components/ui/no-group-state.tsx` (de muro a invitación opcional, prop `variant`), `src/components/ui/member-balance-list.tsx` (deudas pairwise + badge "Invitado"), `src/components/dashboard/invite-card.tsx` (GroupInvite en vez de enlaces eternos), `join-group-card.tsx` (acepta enlaces `/i/…`, errores nuevos), `expense-card.tsx` ("Favor para X e Y"), `pending-settlements.tsx` (confirmar como receptor incl. guest), `src/components/ui/visual-balance.tsx` (sin cambios internos; solo cambia quién la monta).

**Nuevos:** `src/components/expense/split-editor.tsx` (editor N-way único new+edit — elimina de raíz `isTwoMember`/`splitWithPartner`), `src/components/space/space-status-banner.tsx`, `src/components/space/member-list.tsx`, `src/components/space/invite-manager.tsx`, `src/components/space/create-space-form.tsx`, `src/components/guest/guest-banner.tsx`.

---

## 5. Riesgos y decisiones abiertas

### Riesgos técnicos y de seguridad

- **Cascadas `User→Expense`** (Cascade en `paidById`/`ownerId`): borrar un User sombra destruiría la contabilidad del grupo. Mitigado por disciplina (nunca DELETE físico, solo REMOVED/anonimización) hasta la Fase 4 (Restrict en schema). Ventana de riesgo entre Fase 3 y Fase 4.
- **Divergencia finance/ledger en grupos dinámicos:** gastos sin Splits se re-dividen retroactivamente entre los miembros actuales mientras el ledger congela entries. El backfill de Splits + `reconcile-ledger.ts` es **bloqueante** antes de abrir rotación de miembros; si se salta, los balances de analytics y del ledger divergirán en efímeros.
- **Bug destructivo existente en el PATCH de gasto** (`existingSplits.length===2` + partner arbitrario): cualquier grupo de 3+ que edite gastos **hoy** puede corromper splits. Por eso el rewrite N-way va en Fase 1, antes de promocionar GROUP en la UI.
- **Enlaces = credenciales portadoras:** mitigado con hash-only en DB, 256 bits, `expiresAt` obligatorio, `maxUses`, revocación, no-referrer y URL limpia tras canje — pero una fuga por chat sigue dando acceso hasta expirar. Defaults conservadores recomendados.
- **`ALTER ENUM` de `MembershipRole` en MySQL:** añadir GUEST al final es metadata-only; si Prisma genera un SQL que reordena valores, la migración reescribe la tabla y puede corromper roles. Revisar el `migration.sql` a mano antes del deploy.
- **Auto-join silencioso de `/login?code=`:** vulnerabilidad activa hoy; se elimina en Fase 2. Hasta entonces, no publicitar enlaces `/login?code=`.
- **`Couple.code` de 6 hex sin rate limit en join:** fuerza-brutable (~16,7M). RL por IP en Fase 2 + rotación de código; el RL sigue siendo in-memory (aceptable single-instance en Coolify; migrar a store compartido antes de escalar).
- **Recibos públicos en `public/uploads`:** los invitados amplifican la exposición (suben tickets ajenos a un espacio temporal). Ver decisión abierta.
- **Revocación guest depende de `getSession`:** la revalidación per-request contra Membership debe vivir centralizada en `getSession`/`requireSpaceAccess`, no repartida por handlers — un handler que se la salte deja un guest expulsado con acceso hasta 72 h.
- **Backfill de `type` heurístico:** grupos de 1-2 miembros quedan como COUPLE aunque sean grupos nacientes. Mitigado con script manual verificable (no SQL embebido) + acción "Convertir en grupo".

### Decisiones abiertas (dueño de producto)

1. **Retención de efímeros archivados:** ¿purga RGPD a los 90 días o "recuerdo del viaje" en solo lectura indefinido? Afecta a Fase 5 y a la política de backups.
2. **¿Registro self-service** para el modo Individual, o instancia cerrada por InviteCode de admin? Determina si Kill Bill deja de ser una instancia privada familiar.
3. **¿Budgets y recurrentes en EPHEMERAL?** Prohibirlos es decisión de producto, no técnica (la policy lo soporta en ambos sentidos).
4. **Cap estricto COUPLE=2:** ¿pareja estricta con "Convertir en grupo", o etiqueta cosmética sin cap? Afecta al backfill de los grupos actuales de 1-2 miembros.
5. **OCR para invitados:** ¿permitido con cap por espacio/día o vetado a GUEST (coste Gemini)?
6. **`expiresAt` de efímeros:** ¿auto-archivado por cron al vencer, o solo sugerencia de cierre al organizador?
7. **Merge de invitado con cuenta preexistente** en el upgrade: ¿limitación v1 (error + "inicia sesión") o fusión de identidades (reasignar Splits/Settlements/Account)?
8. **Defaults de enlaces GUEST:** `maxUses` (¿10?) y expiración (¿7/30 días o la fecha del viaje?) — fricción del organizador vs superficie de exposición.
9. **Modo Individual como entidad real en el futuro** (con backfill de gastos personales) ¿o virtual permanente? El enum reserva `INDIVIDUAL` para no cerrar la puerta.
10. **Recibos autenticados:** ¿mover `public/uploads` a servido autenticado dentro de esta feature, o deuda aparte?
11. **Settlements de un invitado inactivo** (no volverá a abrir su enlace): ¿auto-confirmación al archivar o confirmación delegada en OWNER/ADMIN?