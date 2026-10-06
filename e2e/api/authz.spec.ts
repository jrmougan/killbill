import { test, expect } from '../fixtures/test.fixture';
import { seedScenario, resetDb } from '../fixtures/db.fixture';
import { loginAs, createAuthenticatedContext } from '../fixtures/auth.fixture';

/**
 * Matriz de autorización (Fase 1 / Espacios):
 * Central authz validado contra la base de datos (requireSpaceAccess, space-policy, proxy).
 *
 * 1. Cross-tenant / IDOR: denegación entre espacios distintos.
 * 2. Estado SETTLING: gastos nuevos bloqueados, liquidaciones y lecturas permitidas.
 * 3. Estado ARCHIVED: espacio en solo lectura (gastos y liquidaciones bloqueados, lecturas y export permitidos).
 * 4. Miembro expulsado: JWT criptográficamente válido pero denegado en DB por requireSpaceAccess (sin blacklist).
 * 5. Invitado (GUEST): enjaulado en su espacio efímero, dashboard/expenses permitidos, listas/export y cross-space denegados.
 */
test.describe('API Authorization Matrix (authz & space policy)', () => {

  test('1. Cross-tenant / IDOR: un usuario no puede mutar ni leer recursos de otro espacio', async ({ page, context, request }) => {
    await resetDb(request);

    // Sembrar dos espacios independientes (ambos con deuda y gastos)
    const coupleX = await seedScenario(request, 'couple-with-debt');
    const coupleY = await seedScenario(request, 'couple-with-debt');

    const userAX = coupleX.userA as { email: string; password: string; id: string };
    const coupleYId = coupleY.coupleId as string;
    const expenseYId = coupleY.expenseId as string;

    // Login como userA de la pareja X
    await loginAs(page, userAX);
    const apiX = context.request;

    // A) PATCH sobre el gasto de la pareja Y -> 403 (No autorizado / no pertenece al grupo)
    const patchRes = await apiX.patch(`/api/expenses/${expenseYId}`, {
      data: { description: 'Intento de modificación cruzada' },
    });
    expect(patchRes.status(), 'PATCH cross-tenant sobre gasto ajeno').toBe(403);

    // B) DELETE sobre el gasto de la pareja Y -> 403
    const deleteRes = await apiX.delete(`/api/expenses/${expenseYId}`);
    expect(deleteRes.status(), 'DELETE cross-tenant sobre gasto ajeno').toBe(403);

    // C) GET sobre el desglose del gasto de la pareja Y -> 403 (requireSpaceAccess deniega pertenencia)
    const getLinesRes = await apiX.get(`/api/expenses/${expenseYId}/receipt-lines`);
    expect(getLinesRes.status(), 'GET receipt-lines cross-tenant').toBe(403);
    const linesBody = await getLinesRes.json();
    expect(linesBody.error).toBe('No perteneces a este espacio');

    // D) GET sobre /api/expenses/[id] directamente (no exporta GET -> 405 Method Not Allowed)
    const getExpenseDirect = await apiX.get(`/api/expenses/${expenseYId}`);
    expect([403, 404, 405], 'GET directo sobre ruta sin export GET').toContain(getExpenseDirect.status());

    // E) GET sobre listas de la pareja Y -> 403 (requireSpaceAccess deniega)
    const listsRes = await apiX.get(`/api/spaces/${coupleYId}/lists`);
    expect(listsRes.status(), 'GET listas de otro espacio').toBe(403);
    const listsBody = await listsRes.json();
    expect(listsBody.error).toBe('No perteneces a este espacio');

    // F) GET sobre budget de otro espacio -> 404 (no existe endpoint de espacio para budget; /api/budget aísla por sesión)
    const budgetOtherSpaceRes = await apiX.get(`/api/spaces/${coupleYId}/budget`);
    expect([403, 404], 'GET ruta inexistente de presupuesto de otro espacio').toContain(budgetOtherSpaceRes.status());
  });

  test('2. Estado SETTLING: POST /api/expenses rechazado (409), POST /api/settle permitido (200), GETs permitidos', async ({ page, context, request }) => {
    await resetDb(request);

    const seed = await seedScenario(request, 'space-settling');
    const userB = seed.userB as { email: string; password: string; id: string };
    const userA = seed.userA as { email: string; password: string; id: string };
    const spaceId = seed.coupleId as string;

    await loginAs(page, userB);
    const api = context.request;

    // A) POST /api/expenses debe ser rechazado con 409 (SPACE_NOT_WRITABLE)
    const createExpenseRes = await api.post('/api/expenses', {
      data: {
        description: 'Gasto prohibido en liquidación',
        amount: '25.00',
        category: 'supermercado',
      },
    });
    expect(createExpenseRes.status(), 'POST /api/expenses en SETTLING debe ser 409').toBe(409);
    const expenseErr = await createExpenseRes.json();
    expect(expenseErr.code).toBe('SPACE_NOT_WRITABLE');

    // B) POST /api/settle debe estar permitido (200)
    const settleRes = await api.post('/api/settle', {
      data: {
        amount: 25,
        toUserId: userA.id,
        method: 'BIZUM',
      },
    });
    expect(settleRes.status(), 'POST /api/settle en SETTLING debe permitirse').toBe(200);
    const settleJson = await settleRes.json();
    expect(settleJson.success).toBe(true);

    // C) GETs deben estar permitidos (200)
    const getExpensesRes = await api.get('/api/expenses?scope=shared');
    expect(getExpensesRes.status(), 'GET /api/expenses en SETTLING').toBe(200);

    const balanceRes = await api.get(`/api/spaces/${spaceId}/balance`);
    expect(balanceRes.status(), 'GET /api/spaces/[id]/balance en SETTLING').toBe(200);

    const listsRes = await api.get(`/api/spaces/${spaceId}/lists`);
    expect(listsRes.status(), 'GET /api/spaces/[id]/lists en SETTLING').toBe(200);

    const exportRes = await api.get('/api/export');
    expect(exportRes.status(), 'GET /api/export en SETTLING').toBe(200);
  });

  test('3. Estado ARCHIVED: POST /api/expenses y liquidación rechazados (409), GETs y GET /api/export permitidos', async ({ page, context, request }) => {
    await resetDb(request);

    const seed = await seedScenario(request, 'space-archived');
    const userA = seed.userA as { email: string; password: string; id: string };
    const userB = seed.userB as { email: string; password: string; id: string };
    const spaceId = seed.coupleId as string;

    await loginAs(page, userA);
    const api = context.request;

    // A) POST /api/expenses rechazado con 409 (SPACE_NOT_WRITABLE)
    const createExpenseRes = await api.post('/api/expenses', {
      data: {
        description: 'Gasto en espacio archivado',
        amount: '30.00',
        category: 'supermercado',
      },
    });
    expect(createExpenseRes.status(), 'POST /api/expenses en ARCHIVED debe ser 409').toBe(409);
    const expenseErr = await createExpenseRes.json();
    expect(expenseErr.code).toBe('SPACE_NOT_WRITABLE');

    // B) Liquidación rechazada en espacio ARCHIVED (solo lectura)
    // POST /api/spaces/[id]/settle-up valida el estado ARCHIVED y devuelve 409
    const settleUpRes = await api.post(`/api/spaces/${spaceId}/settle-up`);
    expect(settleUpRes.status(), 'POST /api/spaces/[id]/settle-up en ARCHIVED').toBe(409);
    const settleUpErr = await settleUpRes.json();
    expect(settleUpErr.code).toBe('SPACE_NOT_WRITABLE');

    // POST /api/settle también debe ser rechazado (4xx / 409)
    const settleRes = await api.post('/api/settle', {
      data: {
        amount: 10,
        toUserId: userB.id,
        method: 'CASH',
      },
    });
    expect([400, 403, 409], 'POST /api/settle en ARCHIVED debe ser rechazado').toContain(settleRes.status());

    // C) GETs permitidos (espacio archivado permanece como "recuerdo del viaje")
    const getExpensesRes = await api.get('/api/expenses?scope=shared');
    expect(getExpensesRes.status(), 'GET /api/expenses en ARCHIVED').toBe(200);

    const balanceRes = await api.get(`/api/spaces/${spaceId}/balance`);
    expect(balanceRes.status(), 'GET /api/spaces/[id]/balance en ARCHIVED').toBe(200);

    const listsRes = await api.get(`/api/spaces/${spaceId}/lists`);
    expect(listsRes.status(), 'GET /api/spaces/[id]/lists en ARCHIVED').toBe(200);

    // D) GET /api/export permitido (allowArchived: true en requireSpaceAccess)
    const exportRes = await api.get('/api/export');
    expect(exportRes.status(), 'GET /api/export en ARCHIVED').toBe(200);
    const csvContent = await exportRes.text();
    expect(csvContent).toContain('fecha,descripcion,importe');
    expect(csvContent).toContain('Viaje (histórico)');
  });

  test('4. Miembro expulsado (409 con saldo; tras liquidar): JWT sigue válido pero requireSpaceAccess deniega en DB (403)', async ({ page, newContext, context, request }) => {
    await resetDb(request);

    const seed = await seedScenario(request, 'group-of-3');
    const userA = seed.userA as { email: string; password: string; id: string }; // OWNER
    const userB = seed.userB as { email: string; password: string; id: string }; // MEMBER expulsable
    const spaceId = seed.coupleId as string;
    const expenseId = seed.expenseId as string;

    // Crear contexto autenticado previo para userB (su cookie JWT ya está emitida y vigente)
    const ctxB = await createAuthenticatedContext(newContext, userB);
    const apiB = ctxB.request;

    // Verificación preliminar: userB puede acceder antes de ser expulsado
    const preCheck = await apiB.get(`/api/spaces/${spaceId}/lists`);
    expect(preCheck.status(), 'userB accede normalmente antes de ser expulsado').toBe(200);

    // OWNER (userA) se loguea y expulsa a userB mediante DELETE /api/spaces/[id]/members/[userId]
    await loginAs(page, userA);
    const apiA = context.request;

    // userB debe 33,33 € (cena a tres pagada por A): con saldo abierto no se le
    // puede expulsar -> 409 HAS_BALANCE con enlace a liquidar.
    const blockedRes = await apiA.delete(`/api/spaces/${spaceId}/members/${userB.id}`);
    expect(blockedRes.status(), 'expulsar con saldo abierto -> 409').toBe(409);
    const blocked = await blockedRes.json();
    expect(blocked.code).toBe('HAS_BALANCE');
    expect(blocked.balanceCents).not.toBe(0);

    // El acreedor (A) registra "Ya me ha pagado" -> CONFIRMED y saldo de B a cero.
    const settleRes = await apiA.post('/api/settle', {
      data: { fromUserId: userB.id, amount: 33.33, method: 'CASH', groupId: spaceId },
    });
    expect(settleRes.status(), 'A registra el pago recibido de B').toBe(200);
    expect((await settleRes.json()).settlement.status).toBe('CONFIRMED');

    const expelRes = await apiA.delete(`/api/spaces/${spaceId}/members/${userB.id}`);
    expect(expelRes.status(), 'OWNER expulsa a userB ya sin deuda').toBe(200);
    const expelJson = await expelRes.json();
    expect(expelJson.status).toBe('REMOVED');

    // userB intenta usar su sesión token existente (no expirado, sin blacklist)
    // requireSpaceAccess consulta la tabla Membership en DB y detecta status != ACTIVE -> 403
    const listsDenied = await apiB.get(`/api/spaces/${spaceId}/lists`);
    expect(listsDenied.status(), 'userB expulsado denegado en /lists').toBe(403);
    const listsErr = await listsDenied.json();
    expect(listsErr.error).toBe('No perteneces a este espacio');

    const balanceDenied = await apiB.get(`/api/spaces/${spaceId}/balance`);
    expect(balanceDenied.status(), 'userB expulsado denegado en /balance').toBe(403);

    const categoriesDenied = await apiB.get(`/api/spaces/${spaceId}/categories`);
    expect(categoriesDenied.status(), 'userB expulsado denegado en /categories').toBe(403);

    const receiptLinesDenied = await apiB.get(`/api/expenses/${expenseId}/receipt-lines`);
    expect(receiptLinesDenied.status(), 'userB expulsado denegado en /receipt-lines').toBe(403);

    await ctxB.close();
  });

  test('5. Guest: enjaulado en espacio efímero, dashboard/gastos permitidos, listas/export y cross-space denegados', async ({ newContext, request }) => {
    await resetDb(request);

    // Escenario efímero con guest + otro espacio ajeno
    const seed = await seedScenario(request, 'ephemeral-with-guest');
    const otherSpace = await seedScenario(request, 'couple-no-expenses');

    const ephemeralSpaceId = seed.coupleId as string;
    const foreignSpaceId = otherSpace.coupleId as string;
    const expenseId = seed.expenseId as string;
    const guestData = seed.guest as { id: string; sessionToken: string };

    // Crear contexto para el guest inyectando la cookie session_token emitida en el seed
    const guestContext = await newContext();
    const baseURL = (test.info().project.use.baseURL as string) || process.env.TEST_BASE_URL || 'http://localhost:3000';
    await guestContext.addCookies([
      {
        name: 'session_token',
        value: guestData.sessionToken,
        url: baseURL,
      },
    ]);
    const guestApi = guestContext.request;
    const guestPage = await guestContext.newPage();

    // A) Guest PUEDE acceder al dashboard y ver gastos de su espacio efímero
    await guestPage.goto('/dashboard');
    await expect(guestPage).toHaveURL(/.*dashboard/);

    const expensesRes = await guestApi.get('/api/expenses?scope=shared');
    expect(expensesRes.status(), 'Guest puede listar gastos de su espacio').toBe(200);
    const expensesBody = await expensesRes.json();
    expect(expensesBody.expenses.length).toBeGreaterThan(0);

    const receiptRes = await guestApi.get(`/api/expenses/${expenseId}/receipt-lines`);
    expect(receiptRes.status(), 'Guest puede leer receipt-lines (allowGuest: true)').toBe(200);

    const categoriesRes = await guestApi.get(`/api/spaces/${ephemeralSpaceId}/categories`);
    expect(categoriesRes.status(), 'Guest puede leer categorías de su espacio (allowGuest: true)').toBe(200);

    // B) Guest NO PUEDE acceder a endpoints prohibidos para guest en su propio espacio (allowGuest: false)
    const listsRes = await guestApi.get(`/api/spaces/${ephemeralSpaceId}/lists`);
    expect(listsRes.status(), 'Guest bloqueado en listas (allowGuest: false)').toBe(403);
    const listsErr = await listsRes.json();
    expect(listsErr.error).toBe('Acción no permitida para invitados');

    const createListRes = await guestApi.post(`/api/spaces/${ephemeralSpaceId}/lists`, {
      data: { name: 'Lista prohibida' },
    });
    expect(createListRes.status(), 'Guest bloqueado al crear listas').toBe(403);

    const exportRes = await guestApi.get('/api/export');
    expect(exportRes.status(), 'Guest bloqueado en /api/export (allowGuest: false)').toBe(403);

    // C) Proxy enjaula rutas no permitidas redirigiendo al dashboard
    await guestPage.goto('/personal');
    await expect(guestPage, 'Guest enjaulado redirige a dashboard').toHaveURL(/.*dashboard/);

    // D) Guest NO PUEDE acceder a recursos fuera de su espacio (enjaulado por groupId en JWT y DB)
    const otherCatRes = await guestApi.get(`/api/spaces/${foreignSpaceId}/categories`);
    expect(otherCatRes.status(), 'Guest bloqueado en espacio ajeno').toBe(403);
    const otherCatErr = await otherCatRes.json();
    expect(otherCatErr.error).toBe('Un invitado solo puede acceder a su espacio');

    const otherListsRes = await guestApi.get(`/api/spaces/${foreignSpaceId}/lists`);
    expect(otherListsRes.status(), 'Guest bloqueado en listas de espacio ajeno').toBe(403);

    await guestPage.close();
    await guestContext.close();
  });

  for (const scenario of ['space-archived', 'space-settling'] as const) {
    test(`6. Presupuestos en ${scenario}: POST/DELETE rechazados con 409 SPACE_NOT_WRITABLE`, async ({ newContext, request }) => {
      await resetDb(request);
      const seed = await seedScenario(request, scenario);
      const userA = seed.userA as { email: string; password: string };
      const ctx = await createAuthenticatedContext(newContext, userA);
      const api = ctx.request;
      const spaceId = seed.coupleId as string;

      const create = await api.post('/api/budget', { data: { category: 'food', amount: 30, groupId: spaceId } });
      expect(create.status()).toBe(409);
      expect((await create.json()).code).toBe('SPACE_NOT_WRITABLE');

      // Reading the (read-only) space still works.
      expect((await api.get(`/api/budget?scope=shared&groupId=${spaceId}`)).status()).toBe(200);
      await ctx.close();
    });
  }

  test('7. Presupuestos: un invitado no lee ni borra el presupuesto del dueño; importes absurdos son 400', async ({ newContext, request }) => {
    await resetDb(request);
    const seed = await seedScenario(request, 'couple-with-debt');
    const owner = await createAuthenticatedContext(newContext, seed.userA as { email: string; password: string });
    const spaceId = seed.coupleId as string;

    const huge = await owner.request.post('/api/budget', { data: { category: 'food', amount: 99999999, groupId: spaceId } });
    expect(huge.status()).toBe(400);
    expect((await huge.json()).error).toMatch(/máximo/);

    const created = await owner.request.post('/api/budget', { data: { category: 'food', amount: 100, groupId: spaceId } });
    expect(created.status()).toBe(201);
    const budgetId = (await created.json()).budget.id as string;

    const trip = await seedScenario(request, 'ephemeral-with-guest');
    const guestCtx = await newContext();
    await guestCtx.addCookies([{ name: 'session_token', value: (trip.guest as { sessionToken: string }).sessionToken, url: process.env.TEST_BASE_URL || 'http://localhost:3000' }]);
    expect((await guestCtx.request.delete(`/api/budget?id=${budgetId}`)).status()).toBe(403);
    expect((await guestCtx.request.post('/api/budget', { data: { category: 'food', amount: 5 } })).status()).toBe(403);

    // An outsider cannot even learn the budget exists.
    const outsider = await createAuthenticatedContext(newContext, trip.owner as { email: string; password: string });
    expect((await outsider.request.delete(`/api/budget?id=${budgetId}`)).status()).toBe(404);

    expect((await owner.request.delete(`/api/budget?id=${budgetId}`)).status()).toBe(200);
    await owner.close();
    await guestCtx.close();
    await outsider.close();
  });
});
