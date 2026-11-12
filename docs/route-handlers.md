# Route handlers: el kit `route()`

Kit tipado para los handlers de `src/app/api/**` (`src/lib/http/`). Centraliza la
autenticación de sesión, el parseo con Zod y el mapeo de errores, para que cada
ruta contenga solo su lógica. Convención de todas las rutas nuevas o modificadas. Solo `mcp`, `health`, `cron/*`,
`test/*`, `auth/logout`, `invites/[token]/preview`, `setup` y el servidor de `/uploads` van a mano. Ejemplos:
`src/app/api/expenses/**`.

Forma: `export const POST = route({ auth, params, query, body, bodyOptions, errorMessage }, handler)`. Las primitivas Zod
están en `src/lib/http/schemas.ts`; los esquemas de cuerpo por dominio y sus opciones compartidas, en
`src/lib/<dominio>-schemas.ts`.

## API

```ts
import { route, HttpError, badRequest, unauthorized, forbidden, notFound, conflict,
         parseJson, parseQuery, validate, readJson, requireSpace, enforceRateLimit, noStore,
         toErrorResponse } from '@/lib/http';
import { jsonObject, id, idParams, cents, eurosToCents, eurosToCentsOrNull, isoDay,
         expenseDate, recurringInterval, categoryKey, categoryHex, listQuantity,
         intParam, paginationQuery } from '@/lib/http/schemas';
```

| Pieza | Qué hace |
|---|---|
| `route(options, handler)` | Devuelve el handler `(req, { params }) => Promise<Response>`. Orden: auth → `params` → `query` → `body` → handler; cualquier `throw` pasa por `toErrorResponse`. |
| `options.auth` | `'public'` (ctx puede ser `null`), `'user'` (sesión registrada o MCP; invitado → 403), `'user-or-guest'` (cualquier sesión revalidada), `'admin'` (solo sesión de navegador; invitado, MCP o usuario inexistente → 401 "No autorizado"; `User.isAdmin` leído de la BD, si es false → 403 "Acceso denegado"). |
| `options.body` / `query` / `params` | Esquemas Zod. El handler recibe `{ req, ctx, body, query, params }` ya tipados. Sin esquema de `params`, llegan como `Record<string, string>`. |
| `options.bodyOptions` | Las mismas opciones de `parseJson` (`invalidMessage`, `code`) para el cuerpo de `options.body`. |
| `options.errorMessage` / `logLabel` | Mensaje del 500 inesperado (el histórico de la ruta) y etiqueta del `console.error`. |
| `options.unauthorizedMessage` / `guestMessage` | Para conservar mensajes legados (`'Unauthorized'`, `'Los invitados no pueden…'`). |
| `HttpError(status, message, code?, extra?, headers?)` | Se serializa como `{ error, code?, ...extra }`. Atajos: `badRequest`, `unauthorized`, `forbidden`, `notFound`, `conflict`. |
| `toErrorResponse(e, { fallbackMessage, logLabel })` | `HttpError` → su JSON; `ZodError` → 400 `{ error: <primer mensaje>, issues: [{ path, message }] }`; `SettlementError`, `SpacePolicyError`, `ListError`, `CategoryError` → `{ error, code, ...extra }` con su `status`; resto → 500 + `console.error`. |
| `parseJson(req, schema, opts?)` / `readJson(req, opts?)` | Cuerpo vacío → `undefined` (el esquema decide); JSON inválido → 400 "Petición no válida", o `opts.invalidMessage` si la ruta tenía otro mensaje histórico ("Cuerpo inválido"…). `parseJson` acepta también `opts.code` (ver `validate`). |
| `parseQuery(req \| url, schema)` | Valores string; clave repetida → el primero (semántica de `searchParams.get`). |
| `validate(schema, value, { code? })` | `safeParse` con mensajes por defecto en español (locale `es` por parseo, no global: MCP no cambia) y 400 `{ error, code?, issues }` si falla. `code` es un string fijo o una función `(issues) => string \| undefined` (p. ej. `INVALID_AMOUNT` si el primer issue es `amount`; ver `BUDGET_BODY_OPTIONS`). Úsalo en vez de `schema.parse()`. |
| `requireSpace(ctx, groupId, opts)` | `requireSpaceAccess` que lanza su denegación tal cual (status, mensaje, `code` p. ej. 409 `SPACE_NOT_WRITABLE`). Devuelve `SpaceAccessOk`. |
| `enforceRateLimit(key, limit, windowMs, message?)` | 429 "Demasiadas solicitudes…" con `Retry-After`. |
| `noStore(handler)` | Envuelve el resultado de `route()` y pone `Cache-Control: no-store` en todas las respuestas, también las de error. |

Primitivas (`schemas.ts`), todas con mensaje configurable y envolviendo los validadores existentes:
`jsonObject(shape, msg='Petición no válida')` (objeto; claves desconocidas se descartan), `id()`/`idParams`,
`cents({min,max})`, `eurosToCents({max,maxMessage})` (número o string numérico → céntimos > 0),
`eurosToCentsOrNull` (null/"" → null), `isoDay`, `expenseDate` (`parseExpenseDate`), `recurringInterval`,
`categoryKey` (no vacía; la existencia se comprueba con `resolveCategoryId`), `categoryHex`
(`isValidCategoryHex`), `listQuantity` (`normalizeQuantity`), `intParam`/`paginationQuery` (laxos, nunca 400).

## Ejemplo

```ts
const Body = jsonObject({ name: z.string({ error: 'Falta el nombre' }).refine((s) => s.trim().length > 0, 'Falta el nombre') });

export const POST = route(
    { auth: 'user', params: idParams, body: Body, errorMessage: 'Error al hacer X', logLabel: 'Error X:' },
    async ({ ctx, params: { id }, body }) => {
        await requireSpace(ctx, id);
        // ... (throw notFound('…') / conflict('…', 'CODE') donde antes había un return)
        return NextResponse.json({ success: true });
    },
);
```

## Reglas

1. **No cambies el contrato.** Mismos status, mismas formas JSON (`{ error, code? }`, campos extra como
   `maxAmountCents`) y los mismos mensajes en español: pásalos a los esquemas (`{ error: '…' }`, `.min(1, '…')`)
   y a `HttpError`. Lo único nuevo admitido: 400 para entradas mal tipadas que antes se colaban o daban 500
   (con `issues`), y 500 JSON donde antes había una excepción no capturada. Respeta `401 'Unauthorized'` en las
   rutas que lo usan (`unauthorizedMessage`).
2. **El esquema de `body` solo valida forma** (tipos, no vacíos, límites, fechas). Lo que depende del espacio
   (pertenencia de pagador/beneficiario, que el reparto sume, que la categoría exista) va en el handler
   **después** de autorizar. Si el orden 404/403 → 400 importa (no revelar nada a un extraño), no uses
   `options.body`: llama a `parseJson(req, Schema)` dentro del handler tras la autorización (ver `expenses/[id]/tags`).
   Cada texto libre necesita un `max` de Zod no mayor que su columna (normalmente VARCHAR(191) para `String` de Prisma)
   y el mismo `maxLength` en el input; si no, P2000 acaba en 500.
3. **La autorización de espacio sigue explícita**: `requireSpace(ctx, groupId, { allowGuest, allowArchived, roles })`
   contra el grupo del recurso. `route()` solo sabe quién llama. Elige `auth` según el comportamiento previo con
   invitados (`'user'` si se les negaba con 403 antes de tocar nada; `'user-or-guest'` si el handler los enjaula).
4. **Errores: lanza, no devuelvas.** `throw notFound('Gasto no encontrado')`. Los errores de dominio
   (`SettlementError`, `SpacePolicyError`, `ListError`, `CategoryError`) ya se mapean solos: borra los `instanceof`
   de los `catch`. Si una ruta mapea un error de dominio con otro mensaje (p. ej. `invites/claim`), captúralo
   localmente y lanza el `HttpError` que corresponda.
5. **Mantén intactos** `withSpaceLock`/`runLedgerTransaction`, los `assert*UnderLock` y los comentarios de diseño.
6. **Esquemas compartidos** de un dominio en `src/lib/<dominio>-schemas.ts` (`expense-`, `list-`, `space-`,
   `settlement-`, `budget-`, `category-`, `ai-settings-schemas.ts`…), junto con sus opciones compartidas: de parseo
   (`SPACE_BODY_OPTIONS`, `BUDGET_BODY_OPTIONS`) o de la ruta entera (`PERSONAL_LIST_ROUTE`); reutiliza validadores existentes con
   `refine`/`transform`, no dupliques reglas. Un mensaje histórico de JSON inválido o un `code` en los 400 de
   validación se expresan con `bodyOptions` / `parseJson(…, opts)`, no con `try/catch` locales.
7. **Exports**: `export const GET = route(...)`. No exportes métodos que la ruta no tenía (un GET ausente debe
   seguir siendo 405).
8. Respuestas no JSON: `route()` funciona igual, el handler devuelve cualquier `Response` (ver `export/route.ts`, CSV
   con `auth: 'user'`). `auth: 'public'` es para rutas sin sesión obligatoria que aceptan `ctx` null (`invites/claim`,
   `guest/upgrade`). Auth propia (`cron` con `x-cron-secret`, `mcp` con Bearer): esas rutas van a mano; no las migres sin
   motivo. Si una ruta a mano necesita el mapeo de errores, usa `toErrorResponse` en su `catch` (`setup`,
   `invites/[token]/preview`).

## Tests

- Los tests existentes de la ruta deben seguir verdes **sin tocarlos** (salvo añadir mocks que el kit necesite,
  p. ej. `prisma.membership.findUnique` si el test usa una sesión de invitado real vía `getSessionCtx`).
- `route()` importa `getSessionCtx` de `@/lib/authz` y `requireSpace` usa `requireSpaceAccess`: los
  `vi.mock('@/lib/authz', …)` existentes siguen funcionando.
- Las rutas exportadas por `route()` aceptan llamarse sin segundo argumento (`POST(req)`) o con `{ params }`.
- Añade casos para cada 400 nuevo: JSON inválido → `{ error: 'Petición no válida' }`, campo mal tipado →
  `issues[0].path`, y que el handler no escribe nada (`expect(mockCreate).not.toHaveBeenCalled()`).
- Gate: `mise run check`, `mise run build` y los e2e de la zona (`mise run e2e -- e2e/<carpeta>`).
