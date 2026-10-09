# Revisión crítica del plan de QA — Kill Bill

> Autor: Claude (worker Orca, task_6fd4ca96b840) · Fecha: 2026-10-02
> Alcance: solo lectura de código. No se ha ejecutado la suite e2e ni levantado servicios.
> Archivos consultados: `playwright.config.ts`, `e2e/**`, `e2e/fixtures/{auth,db}.fixture.ts`,
> `e2e/global-setup.ts`, `src/app/api/test/{seed,reset}/route.ts`, `src/app/api/test/gating.test.ts`,
> `prisma/schema.prisma`, `prisma/seed.ts`, `src/lib/ledger.ts`, `src/lib/flags.ts`,
> `src/lib/rate-limit.ts`, `src/lib/receipt-ocr-ai.ts`, `.github/workflows/e2e.yml`, `mise.toml`, `package.json`.

---

## 1. Valoración general del plan

El plan es **sólido en dirección** (capas, priorización por riesgo, "no duplicar en e2e lo que ya cubren los unit") y el diagnóstico de infra es mayoritariamente correcto. Pero **subestima el estado real de la infraestructura de test** y propone escalar en volumen (más e2e de UI, visual, agéntico) antes de garantizar que la base es fiable. Concretamente:

- El "problema" de `/api/test/reset` no es que *no limpie* algunas tablas: **casi seguro falla con 500 en la práctica, y nadie se entera** (ver §4.1). El aislamiento actual funciona por accidente (emails únicos por seed), no por diseño.
- Hay una capa ausente que, para esta app, tiene mejor ratio coste/beneficio que la mayoría del e2e de UI propuesto: **tests de API/autorización** (matriz rol × estado del espacio × recurso) con el `request` context de Playwright, al estilo de `e2e/shopping/smoke.spec.ts`.
- La capa visual (fase 3) está bien acotada pero ignora el problema número uno de `toHaveScreenshot`: **las baselines dependen del SO/fuentes**, y el CI corre en `ubuntu-latest` mientras el desarrollo local es Fedora.
- La capa agéntica (fase 4) es la de menor certeza de retorno y debería ser un **experimento con time-box**, no una fase del roadmap.

Valoración: **7/10**. Buen esqueleto; necesita re-ordenar fases, endurecer la infra antes de crecer y añadir la capa API/authz.

---

## 2. Puntos de acuerdo

| Punto del plan | Por qué estoy de acuerdo |
|---|---|
| **(0) No duplicar invariantes de dinero en e2e** | Hay 25 ficheros `*.test.ts` en `src/lib/`, incluidos `finance`, `splits` y `ledger`. El e2e debe verificar *integración* (que la UI muestra lo que el ledger dice), no recomputar repartos. Un e2e que comprueba "33,33/33,33/33,34" es lento y redundante. |
| **Priorizar dinero y estados primero** | Es donde un bug cuesta confianza del usuario. Hoy `e2e/settlements/create-and-confirm.spec.ts` es el único test de settle-up y su aserción final es prácticamente tautológica (ver §3.4). |
| **Settle-up con 2 contextos de navegador** | Es el patrón correcto y ya existe (`createAuthenticatedContext` en `e2e/fixtures/auth.fixture.ts`). El flujo PENDING→CONFIRMED implica dos actores; con un solo contexto no se prueba la autorización del receptor. |
| **Proyecto Playwright separado para guests/efímeros** | Correcto aislar el flag `EPHEMERAL_SPACES_ENABLED` (`src/lib/flags.ts`), aunque la implementación propuesta no funciona tal cual (ver §3.2). |
| **`toHaveScreenshot` nativo, sin dependencias nuevas** | Para una app de este tamaño (1 dev, ~10 pantallas) un SaaS (Percy/Chromatic/Argos) añade coste y una cuenta externa sin beneficio claro. |
| **2 viewports con móvil primero** | La app es mobile-first (`sm:max-w-md`), pero `playwright.config.ts` solo tiene `Desktop Chrome`: **hoy ningún test corre en el viewport real de uso**. Esto es un hueco funcional, no solo visual. |
| **OCR fuera de e2e** | `receipt-ocr-ai.ts` llama a `generativelanguage.googleapis.com` y OpenRouter con `fetch`. El CI ya pone `GEMINI_API_KEY: fake_key_not_needed_for_e2e`. Correcto no depender de proveedores reales. |
| **Arreglar `global-setup.ts`** | Está desconectado (no hay `globalSetup` en `playwright.config.ts`) y además es redundante con `webServer.url`, que ya espera a que el servidor responda. **Recomiendo borrarlo**, no cablearlo. |
| **Más `data-testid`** | Solo hay 16 ocurrencias en `src/`, concentradas en 4 páginas (`login`, `register`, `dashboard`, `expenses/new`). Con copy en español hardcodeado, cualquier cambio de texto rompe tests. |

---

## 3. Desacuerdos y cambios propuestos

### 3.1 "Ampliar `/api/test/reset`" → **rediseñar el aislamiento, no ampliar el reset**

`src/app/api/test/reset/route.ts` hace `deleteMany` global en orden fijo: split → expense → settlement → inviteCode → **user** → couple. Problemas:

1. **Orden roto por FKs `Restrict`.** `prisma/schema.prisma` define `Account.user … onDelete: Restrict` y `src/lib/ledger.ts:44` (`ensureAccount`) crea `Account` en cuanto se postea un gasto compartido. Como el reset borra `User` *antes* que `Couple` (que es quien cascadea `Account`), `user.deleteMany()` debería fallar con violación de FK tras cualquier seed `couple-with-*`. Igual con `Budget` → `Category` (`Restrict`) si se añade el borrado de categorías custom.
2. **El fallo es silencioso.** `resetDb` en `e2e/fixtures/db.fixture.ts` hace `await request.post('/api/test/reset')` **sin comprobar `res.ok()`** (al contrario que `seedScenario`).
3. **Es destructivo fuera de CI.** `mise run e2e` usa el `DATABASE_URL` del `.env` del worktree (la BD de desarrollo) y el reset borra **todos** los usuarios, incluido el admin de `prisma/seed.ts`.
4. **Es global**, lo que impide paralelizar jamás.

**Propuesta:** el aislamiento ya funciona en la práctica gracias a `uniqueEmail()` en el seed. Formalizarlo: cada test crea su *tenant* (seed con IDs únicos) y **no hay reset global entre tests**. Si se quiere limpieza, que sea un `DELETE /api/test/tenant/:coupleId` que borre solo lo creado (cascade desde `Couple` + usuarios del seed), o un `TRUNCATE` de todas las tablas **una sola vez** en `globalSetup` contra una BD dedicada (`killbill_e2e`), nunca contra la de dev. Y en cualquier caso `resetDb` debe lanzar si `!res.ok()`.

### 3.2 "Proyecto Playwright aparte con `EPHEMERAL_SPACES_ENABLED=true`" → no funciona con un solo `webServer`

El flag se lee de `process.env` **del servidor** (`src/lib/flags.ts`). Los `projects` de Playwright comparten el `webServer` definido en `playwright.config.ts`; un proyecto distinto no cambia el entorno del proceso Next. Opciones reales:

- **(Recomendada)** Encender el flag en el único `webServer` de test. El flag está pensado para estar apagado *en producción*; en e2e no hay razón para apagarlo, salvo para un test específico que verifique que con el flag apagado las rutas guest devuelven 404 — y eso es un **unit test** de la ruta (mismo patrón que `src/app/api/test/gating.test.ts`), no un e2e.
- `webServer` como array con dos servidores en puertos distintos (uno con flag y otro sin él). Duplica tiempo de arranque y build-memory en CI; solo merece la pena si hay comportamiento de UI que diverge.

### 3.3 Visual regression: el diseño necesita condiciones que el plan no fija

- **Baselines por plataforma.** Playwright añade sufijo `-linux` pero Fedora y Ubuntu renderizan fuentes/emoji distinto (los seeds usan avatar `'👤'`). Las baselines deben generarse **siempre en el contenedor oficial `mcr.microsoft.com/playwright:v1.61.x-noble`**, tanto en local (`docker run …`) como en CI. Si no, habrá diffs permanentes y el equipo acabará subiendo `maxDiffPixelRatio` hasta que el test no sirva.
- **Fechas y reloj.** Los seeds usan `new Date()` (p. ej. `monthStart` del budget en `couple-with-personal-expense`) y la UI formatea con `toLocale*`/`Intl` (7 sitios en `src/components` + `currency.ts`). Hace falta `page.clock.setFixedTime(...)`, `timezoneId: 'Europe/Madrid'` y `locale: 'es-ES'` en `use` — hoy `playwright.config.ts` no fija ninguno, lo que también afecta a los tests funcionales que lean importes con formato.
- **Animaciones.** `framer-motion` está en dependencias; `toHaveScreenshot` desactiva animaciones CSS pero no las de JS. Usar `reducedMotion: 'reduce'` en el contexto (y verificar que los componentes lo respetan).
- **Recharts** (`/analytics`) es la pantalla más inestable visualmente; dejarla fuera de las primeras 10 o enmascarar el gráfico.
- **No hay dark mode**: no hace falta duplicar temas. Bien que el plan no lo haga.

### 3.4 "E2E funcional priorizado por riesgo" → primero **arreglar la calidad de los existentes**

Antes de añadir tests, los actuales tienen patrones que el plan replicaría:

- `e2e/settlements/create-and-confirm.spec.ts:92-102`: `waitForTimeout(1000)` + `if (await balanceEl.isVisible()) { expect(text).toBeTruthy() }`. **El test pasa aunque la confirmación no haga nada.** Debería esperar a la respuesta de red y aserir el importe exacto (`toHaveText('0,00 €')` o similar).
- Los dos tests de ese archivo comparten la misma pareja (`beforeAll`) y el segundo depende del estado del primero (dos settlements de 50 € sobre una deuda de 50 €). Cada test debe sembrar su escenario.
- Selectores frágiles: `locator('input[type="number"]').last()`.
- `retries: 2` en CI enmascara flakiness. Mantenerlo, pero **fallar el job si hay tests `flaky`** en el reporte (o al menos publicarlos), para que los reintentos no oculten problemas reales.

### 3.5 Usar más tests **a nivel API** y menos a nivel UI

El plan pone casi todo en "E2E funcional Playwright" en navegador. Para CRUD secundario (categorías, budgets, tags, listas, import CSV, export) el riesgo está en reglas de servidor (400 por categoría desconocida, 409 por colisión de budget, reasignación obligatoria al borrar, XOR grupo/personal de listas). Eso se prueba **10× más rápido y más estable con `request`** que vía UI, como ya hace `e2e/shopping/smoke.spec.ts`. Reservar UI para 1 happy-path por feature.

### 3.6 Capa agéntica como fase 4 del roadmap → experimento acotado

Un agente con Playwright MCP es no determinista, caro por ejecución y sus hallazgos necesitan triage humano. No debe ser un gate ni una "fase" con la misma entidad que las otras. Propongo: time-box (p. ej. 2–3 sesiones), misiones escritas, salida obligatoria en forma de **issue + test reproducible propuesto** (si no se puede convertir en test determinista, el hallazgo se queda en backlog). Medir: bugs reales encontrados / horas. Si es 0 tras el time-box, se archiva.

---

## 4. Riesgos y huecos que el plan no contempla

1. **El reset roto (§3.1)** es el riesgo más inmediato: cualquier test nuevo que dependa de "BD limpia" (p. ej. contar elementos de una lista, comprobar que no hay categorías custom) fallará de forma no determinista según qué tests corrieron antes.
2. **Autorización / IDOR.** No aparece en el plan. `requireSpaceAccess` (`src/lib/authz.ts`) re-valida la `Membership` contra BD, hay roles OWNER/ADMIN/MEMBER/GUEST y estados SETTLING/ARCHIVED que bloquean escrituras. Es la superficie con más impacto (fuga de datos entre parejas) y es perfectamente testeable vía API: usuario de la pareja X intenta `GET/PATCH/DELETE` sobre gasto/lista/categoría de la pareja Y → 403/404. Hoy `e2e/expenses/personal.spec.ts` cubre algo de privacidad, pero no la matriz.
3. **Invitaciones `/i/[token]`**: tokens de 256 bits guardados como hash, con `expiresAt`, `maxUses`, `revokedAt`. Los casos borde (token revocado, usado `maxUses` veces, expirado, login que *no* debe autounirse) son de alto riesgo de seguridad y no están priorizados explícitamente.
4. **Endpoint MCP (`POST /api/mcp`)**: superficie pública con Bearer JWT, rechazo de tokens guest, 90 días de TTL. Ni un smoke test. Un test API que haga `initialize` + `tools/list` + `get_balance` con token válido, guest y caducado es barato y protege una integración externa (Hermes).
5. **Gastos recurrentes y `api/cron/purge`**: lógica dependiente del tiempo (`RecurringSeries`, purga de efímeros por `expiresAt`). Se testean con `page.clock` / llamada directa al endpoint cron con reloj controlado; el plan no los menciona.
6. **Concurrencia en listas**: el toggle `checked` está diseñado idempotente (`updateMany` condicionado). Un test con 2 contextos marcando el mismo ítem a la vez es justo el tipo de caso que los 2 contextos del settle-up habilitan y que la capa agéntica nunca encontrará de forma reproducible.
7. **Servidor de dev en local vs standalone en CI.** `playwright.config.ts` usa `npm run dev` en local (compilación on-demand, primeras navegaciones lentas → timeouts de 10 s explícitos por todo el código) y `node .next/standalone/server.js` en CI. Los tests se calibran contra dos runtimes distintos. Para visual regression esto es crítico: **las baselines solo deben generarse contra el build de producción**.
8. **Migraciones en CI vs prod**: el CI usa `mariadb:10.11` pero producción es **MySQL 8.0** (`killbill-mysql-8`). Diferencias de collation/ordenación pueden cambiar el orden de listas o resultados de búsqueda. Mínimo, documentarlo; idealmente añadir una matriz `mysql:8.0` en el job.
9. **Rate limiter desactivado en test** (`src/lib/rate-limit.ts` se salta con `TEST_ROUTES_ENABLED`): el login rate-limit no tiene cobertura e2e por diseño. Asegurarse de que tiene unit test.
10. **Accesibilidad**: con más `getByRole` (preferible a `data-testid` donde sea posible) y opcionalmente `@axe-core/playwright` en las mismas ~10 pantallas de la capa visual se obtiene una auditoría a11y casi gratis. El plan no la menciona.
11. **Tiempo de CI**: `workers: 1` y `fullyParallel: false`. Añadir ~40–60 tests de UI + 20 screenshots × 2 viewports puede llevar el job de e2e (que bloquea el deploy, `deploy.yml` → `needs: [e2e]`) a 10–15 min. El plan no fija presupuesto de tiempo.

---

## 5. Alternativas de tooling / enfoque

| Alternativa | Qué aporta | Trade-off |
|---|---|---|
| **Aislamiento por tenant + workers > 1** en vez de reset global | Permite `fullyParallel: true` con 2–4 workers; mitiga el coste de CI del punto 4.11. | Requiere que *ningún* test haga aserciones globales (contar todas las filas de una tabla). Los seeds ya usan emails únicos, así que el coste es bajo. |
| **Fixtures tipadas de Playwright (`test.extend`)** en vez de `beforeAll` + `apiContext` manual repetido en cada spec | Elimina el boilerplate actual (cada spec crea y destruye su `apiContext`), da `seed`, `asUserA`, `asUserB` como fixtures con teardown automático. | Refactor de los 18 tests existentes (~1 día). |
| **`storageState` / sesión inyectada** en lugar de `loginAs` por UI | `loginAs` rellena el formulario en cada test. El login es un server action (`src/app/login/actions.ts`, no hay `/api/auth/login`), así que la vía barata es que el seed devuelva un JWT firmado (o un `/api/test/session` gated por `TEST_ROUTES_ENABLED`) y añadirlo como cookie `session_token` con `context.addCookies`. Mantener 1–2 tests de login real por UI. | Una ruta de test más (mismo gating que seed/reset). |
| **Mock de OCR a nivel de servidor** (provider `fake` activado con env, p. ej. `OCR_PROVIDER=fake` que devuelve un JSON fijo) en vez de interceptar en navegador | `page.route()` no sirve: la llamada a Gemini la hace el servidor. Un provider falso permite probar e2e el flujo *upload → confirmación de ítems → gasto* sin claves. | Toca código de producción (pequeño, detrás de flag de test, igual que `TEST_ROUTES_ENABLED`). Alternativa sin tocar código: no testear OCR en e2e y cubrir `receipt-ocr-ai.ts` con unit + `fetch` mockeado. |
| **Contenedor Playwright oficial para visual** (`mcr.microsoft.com/playwright`) | Baselines idénticas local/CI. | Requiere Docker en local para regenerar baselines; ya está en el flujo (`services:up`). |
| **Argos/Lost Pixel/Chromatic** (SaaS de visual) | UI de revisión de diffs, aprobación en PR. | Cuenta externa, coste; para ~20 snapshots no compensa. Revisitar si se superan ~100. |
| **Agente exploratorio con salida estructurada** (misiones → `findings.json` → issues) frente a "agente libre" | Hace la capa 3 medible y reproducible. | Más trabajo de prompt/infra inicial. |
| **Tests de contrato del MCP** con el SDK cliente `@modelcontextprotocol/sdk` (ya es dependencia) | Valida el endpoint exactamente como lo consume Hermes. | Ninguno; reutiliza dependencia existente. |

---

## 6. Priorización recomendada

Difiere del plan en tres cosas: (a) la infra se divide en "bloqueante" y "habilitadora", (b) se inserta una capa **API/authz** antes del e2e de UI, (c) lo agéntico pasa a experimento opcional.

**Fase 0 — Base fiable (bloqueante, ~1–2 días)**
1. `resetDb` falla si `!res.ok()`; decidir entre aislamiento por tenant (recomendado) o reset corregido (orden FK + Account/Ledger/Budget/Category custom/ShoppingList/GroupInvite/Tag) contra **BD de e2e dedicada**, nunca la de dev.
2. Borrar `e2e/global-setup.ts`.
3. Fijar en `playwright.config.ts`: `locale: 'es-ES'`, `timezoneId: 'Europe/Madrid'`, proyecto móvil (`devices['iPhone 13']` o `Pixel 7` en Chromium) además de desktop.
4. Arreglar las aserciones débiles de `create-and-confirm.spec.ts` y quitar `waitForTimeout`.
5. Encender `EPHEMERAL_SPACES_ENABLED=true` en el `webServer` de test.

**Fase 1 — Seeds y fixtures (~2 días)**
6. `test.extend` con fixtures `seed(scenario)`, `asUser(user)` y login vía API.
7. Nuevos escenarios: grupo de 3+, espacio SETTLING, ARCHIVED, efímero con guest, lista pre-poblada, invitación (válida/expirada/revocada/agotada), categorías custom + budget.
8. `data-testid` en las pantallas que se vayan a testear (incremental, no barrido global); preferir `getByRole` donde el rol sea inequívoco.

**Fase 2 — API / autorización (alto riesgo, bajo coste)**
9. Matriz authz: cross-tenant (IDOR), rol × estado del espacio (SETTLING bloquea gastos pero permite settle; ARCHIVED read-only), guest con flag.
10. Reglas de negocio de CRUD vía API: categorías (400/409/reasignación), budgets, tags, listas, import CSV idempotente, export.
11. Invitaciones `/i/[token]` (casos borde) y smoke del MCP (`initialize`, `tools/list`, token guest rechazado).

**Fase 3 — E2E de UI de dinero/estado (lo que el plan llama fase 2, parte 1)**
12. Settle-up 2 contextos con aserción de importe exacto; editar/borrar gasto y comprobar balance; ciclo ACTIVE→SETTLING→ARCHIVED desde la UI; ciclo guest completo; 1 happy-path de UI por feature CRUD.
13. Presupuesto de tiempo del job e2e (p. ej. ≤ 8 min); si se supera, paralelizar (posible gracias a la Fase 0).

**Fase 4 — Visual (~10 pantallas × 2 viewports)**
14. Solo contra build standalone, en contenedor oficial de Playwright, reloj fijo, `reducedMotion`, máscaras para avatares/fechas, sin `/analytics` al principio. Opcional: `@axe-core/playwright` en las mismas pantallas.

**Experimento (paralelo, time-boxed, no gate) — QA agéntico**
15. 2–3 sesiones con misiones; todo hallazgo debe convertirse en test determinista de las fases 2–4 o descartarse. Evaluar continuidad con métricas.

**Fuera de alcance de e2e:** OCR real (unit con `fetch` mockeado; provider `fake` solo si se quiere el flujo completo de UI).
