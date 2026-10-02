import { test, expect } from '@playwright/test';
import { seedScenario, resetDb } from '../fixtures/db.fixture';
import { loginAs, createAuthenticatedContext } from '../fixtures/auth.fixture';

/**
 * Suite de tests Playwright a nivel API (CRUD):
 *
 * 1. Categorías: validación de keys, paleta cerrada, icono, permisos OWNER/ADMIN y DELETE con reasignación / colisión de Budget.
 * 2. Budget: validación de categoría desconocida (400), importe válido e idempotencia/upsert con reflejo en GET.
 * 3. Tags: creación de tag de grupo y personal, aislamiento por scope en GET y autorización en DELETE.
 * 4. Import CSV: importación por lotes idempotente por fingerprint sha256 y visibilidad PERSONAL.
 * 5. Export: GET /api/export devuelve CSV con gastos del grupo activo y aísla los gastos de otros espacios.
 */
test.describe('API CRUD Suite (Categories, Budget, Tags, Import & Export)', () => {

  test('1. Categorías: validación de keys, paleta, icono, permisos y borrado con reasignación / colisión budget', async ({
    page,
    browser,
    context,
    request,
  }) => {
    await resetDb(request);

    // Sembrar pareja base (userA: OWNER, userB: MEMBER)
    const seed = await seedScenario(request, 'couple-no-expenses');
    const userA = seed.userA as { email: string; password: string; id: string };
    const userB = seed.userB as { email: string; password: string; id: string };
    const coupleId = seed.coupleId as string;

    await loginAs(page, userA);
    const apiA = context.request;

    // A) Crear gasto con category key inexistente -> 400 (resolveCategoryId retorna null, no coerción a other)
    const badExpenseRes = await apiA.post('/api/expenses', {
      data: {
        description: 'Gasto categoría falsa',
        amount: '15.50',
        category: 'categoria_inexistente_xyz',
      },
    });
    expect(badExpenseRes.status(), 'POST /api/expenses con categoría inexistente debe ser 400').toBe(400);
    const badExpenseErr = await badExpenseRes.json();
    expect(badExpenseErr.error).toBe('Invalid category');

    // B) Hex fuera de paleta cerrada (isValidCategoryHex) -> 400
    const badHexRes = await apiA.post(`/api/spaces/${coupleId}/categories`, {
      data: {
        label: 'Color Raro',
        emoji: '🎨',
        iconName: 'Gift',
        hex: '#123456', // No forma parte de CATEGORY_PALETTE
      },
    });
    expect(badHexRes.status(), 'hex fuera de paleta debe ser 400').toBe(400);
    const badHexErr = await badHexRes.json();
    expect(badHexErr.code).toBe('INVALID_COLOR');

    // C) Icono no registrado en ICON_REGISTRY (isValidIconName) -> 400
    const badIconRes = await apiA.post(`/api/spaces/${coupleId}/categories`, {
      data: {
        label: 'Icono Raro',
        emoji: '⭐',
        iconName: 'NonExistentIconName123',
        hex: '#8b5cf6',
      },
    });
    expect(badIconRes.status(), 'icono no registrado debe ser 400').toBe(400);
    const badIconErr = await badIconRes.json();
    expect(badIconErr.code).toBe('INVALID_ICON');

    // D) Key de sistema reservada (RESERVED_SYSTEM_KEYS) -> 400
    const reservedKeyRes = await apiA.post(`/api/spaces/${coupleId}/categories`, {
      data: {
        label: 'Comida Custom',
        key: 'food',
        emoji: '🍔',
        iconName: 'Utensils',
        hex: '#fb923c',
      },
    });
    expect(reservedKeyRes.status(), 'clave de sistema reservada debe ser 400').toBe(400);
    const reservedErr = await reservedKeyRes.json();
    expect(reservedErr.code).toBe('RESERVED_KEY');

    // E) MEMBER (no OWNER/ADMIN) intentando crear categoría de espacio -> 403
    const ctxB = await createAuthenticatedContext(browser, userB);
    const apiB = ctxB.request;
    const memberCatRes = await apiB.post(`/api/spaces/${coupleId}/categories`, {
      data: {
        label: 'Categoría Prohibida Member',
        emoji: '⚡',
        iconName: 'Zap',
        hex: '#8b5cf6',
      },
    });
    expect(memberCatRes.status(), 'MEMBER creando categoría en espacio debe ser 403').toBe(403);
    const memberCatErr = await memberCatRes.json();
    // Las denegaciones por rol de requireSpaceAccess devuelven { error } sin code
    expect(memberCatErr.error).toBe('No tienes permisos para esta acción');
    await ctxB.close();

    // F) OWNER crea categoría custom válida -> 201
    const validCatRes = await apiA.post(`/api/spaces/${coupleId}/categories`, {
      data: {
        label: 'Veterinario',
        key: 'veterinario',
        emoji: '🐾',
        iconName: 'Heart',
        hex: '#8b5cf6',
      },
    });
    expect(validCatRes.status(), 'crear categoría custom válida debe ser 201').toBe(201);
    const validCatBody = await validCatRes.json();
    const createdCat = validCatBody.category;
    expect(createdCat.id).toBeTruthy();
    expect(createdCat.key).toBe('veterinario');
    expect(createdCat.isSystem).toBe(false);

    // G) Crear gasto usando la nueva categoría custom
    const expenseRes = await apiA.post('/api/expenses', {
      data: {
        description: 'Vacunas gato',
        amount: '45.00',
        category: 'veterinario',
      },
    });
    expect(expenseRes.status(), 'crear gasto con categoría custom creada').toBe(200);
    const expenseBody = await expenseRes.json();
    // POST /api/expenses devuelve { success, expenseId }; la categoría se verifica vía GET más abajo
    expect(expenseBody.expenseId).toBeTruthy();

    // H) DELETE sin target de reasignación -> 400 (REASSIGN_REQUIRED)
    const deleteNoTargetRes = await apiA.delete(`/api/spaces/${coupleId}/categories?id=${createdCat.id}`);
    expect(deleteNoTargetRes.status(), 'DELETE sin target de reasignación debe ser 400').toBe(400);
    const deleteNoTargetErr = await deleteNoTargetRes.json();
    expect(deleteNoTargetErr.code).toBe('REASSIGN_REQUIRED');

    // I) DELETE con reasignación -> 200 y gastos asociados actualizados
    const catsRes = await apiA.get(`/api/spaces/${coupleId}/categories`);
    expect(catsRes.status()).toBe(200);
    const { categories } = (await catsRes.json()) as { categories: Array<{ id: string; key: string }> };
    const targetCat = categories.find((c) => c.key === 'other');
    expect(targetCat, 'categoría destino "other" debe existir').toBeDefined();

    const deleteWithReassignRes = await apiA.delete(
      `/api/spaces/${coupleId}/categories?id=${createdCat.id}&reassignTo=${targetCat!.id}`,
    );
    expect(deleteWithReassignRes.status(), 'DELETE con reasignación válida debe ser 200').toBe(200);
    const deleteBody = await deleteWithReassignRes.json();
    expect(deleteBody.deleted).toBe(createdCat.id);
    expect(deleteBody.reassignedTo).toBe(targetCat!.id);

    // Comprobar que el gasto se movió a targetCat.id
    const expensesRes = await apiA.get('/api/expenses?scope=shared');
    expect(expensesRes.status()).toBe(200);
    const { expenses } = (await expensesRes.json()) as { expenses: Array<{ id: string; categoryId: string }> };
    const movedExpense = expenses.find((e) => e.id === expenseBody.expenseId);
    expect(movedExpense).toBeDefined();
    expect(movedExpense!.categoryId).toBe(targetCat!.id);

    // J) DELETE con colisión de Budget -> 409 (escenario categories-custom-with-budget)
    const seedBudget = await seedScenario(request, 'categories-custom-with-budget');
    const ownerSeed = seedBudget.userA as { email: string; password: string };
    const spaceWithBudgetId = seedBudget.coupleId as string;
    const customCatId = seedBudget.categoryId as string;

    const ctxBudget = await createAuthenticatedContext(browser, ownerSeed);
    const apiBudget = ctxBudget.request;

    // Obtener la categoría del sistema 'food' en el espacio
    const spaceCatsRes = await apiBudget.get(`/api/spaces/${spaceWithBudgetId}/categories`);
    const spaceCats = ((await spaceCatsRes.json()) as { categories: Array<{ id: string; key: string }> }).categories;
    const foodCat = spaceCats.find((c) => c.key === 'food');
    expect(foodCat, 'categoría food debe existir').toBeDefined();

    // Crear un budget en 'food' para el mismo mes actual
    const createFoodBudgetRes = await apiBudget.post('/api/budget', {
      data: {
        category: 'food',
        amount: 150,
        scope: 'shared',
      },
    });
    expect(createFoodBudgetRes.status(), 'crear budget en food para preparar colisión').toBe(201);

    // Intentar borrar 'mascotas' (que ya tiene budget) reasignándola a 'food' (que ahora también tiene budget)
    const collisionRes = await apiBudget.delete(
      `/api/spaces/${spaceWithBudgetId}/categories?id=${customCatId}&reassignTo=${foodCat!.id}`,
    );
    expect(collisionRes.status(), 'DELETE con colisión de Budget en target debe ser 409').toBe(409);
    const collisionErr = await collisionRes.json();
    expect(collisionErr.code).toBe('BUDGET_CONFLICT');

    await ctxBudget.close();
  });

  test('2. Budget: validación de categoría desconocida (400) y creación/actualización con reflejo en GET', async ({
    page,
    context,
    request,
  }) => {
    await resetDb(request);

    const seed = await seedScenario(request, 'couple-no-expenses');
    const userA = seed.userA as { email: string; password: string };

    await loginAs(page, userA);
    const api = context.request;

    // A) POST con categoría desconocida -> 400
    const badCatRes = await api.post('/api/budget', {
      data: {
        category: 'categoria_no_existente_999',
        amount: 100,
        scope: 'shared',
      },
    });
    expect(badCatRes.status(), 'POST /api/budget con categoría desconocida debe ser 400').toBe(400);
    const badCatErr = await badCatRes.json();
    expect(badCatErr.error).toBe('Invalid category');

    // B) POST con importe inválido (0 o negativo) -> 400
    const zeroAmountRes = await api.post('/api/budget', {
      data: {
        category: 'food',
        amount: 0,
        scope: 'shared',
      },
    });
    expect(zeroAmountRes.status(), 'POST /api/budget con importe 0 debe ser 400').toBe(400);

    // C) Crear budget válido -> 201 y GET lo refleja con periodStart half-open y porcentaje
    const createRes = await api.post('/api/budget', {
      data: {
        category: 'food',
        amount: 250,
        scope: 'shared',
      },
    });
    expect(createRes.status(), 'crear budget válido debe ser 201').toBe(201);
    const createdBudget = ((await createRes.json()) as { budget: { amount: number; periodType: string } }).budget;
    expect(createdBudget.amount).toBe(25000); // 250€ en céntimos
    expect(createdBudget.periodType).toBe('MONTH');

    const getRes = await api.get('/api/budget?scope=shared');
    expect(getRes.status(), 'GET /api/budget?scope=shared').toBe(200);
    const { budgets } = (await getRes.json()) as {
      budgets: Array<{ budget: { category: string; amount: number }; spent: number; percentage: number }>;
    };
    const found = budgets.find((b) => b.budget.category === 'food');
    expect(found, 'budget creado para food debe aparecer en GET').toBeDefined();
    expect(found!.budget.amount).toBe(25000);

    // D) Actualizar (upsert) budget existente -> 201 y GET refleja el nuevo importe
    const updateRes = await api.post('/api/budget', {
      data: {
        category: 'food',
        amount: 350,
        scope: 'shared',
      },
    });
    expect(updateRes.status(), 'actualizar budget vía upsert debe ser 201').toBe(201);

    const getUpdatedRes = await api.get('/api/budget?scope=shared');
    expect(getUpdatedRes.status()).toBe(200);
    const updatedBudgets = ((await getUpdatedRes.json()) as {
      budgets: Array<{ budget: { category: string; amount: number } }>;
    }).budgets;
    const updated = updatedBudgets.find((b) => b.budget.category === 'food');
    expect(updated, 'budget actualizado para food debe reflejar nuevo importe').toBeDefined();
    expect(updated!.budget.amount).toBe(35000); // 350€
  });

  test('3. Tags: creación de tag de grupo y personal, aislamiento por scope en GET y autorización en DELETE', async ({
    page,
    browser,
    context,
    request,
  }) => {
    await resetDb(request);

    // Sembrar dos parejas independientes para validar aislamiento entre espacios y usuarios
    const couple1 = await seedScenario(request, 'couple-no-expenses');
    const couple2 = await seedScenario(request, 'couple-no-expenses');

    const userA1 = couple1.userA as { email: string; password: string; id: string };
    const userB1 = couple1.userB as { email: string; password: string; id: string };
    const userA2 = couple2.userA as { email: string; password: string; id: string };

    await loginAs(page, userA1);
    const apiA1 = context.request;

    // A) Crear tag de grupo (coupleId asignado, ownerId null)
    const groupTagRes = await apiA1.post('/api/tags', {
      data: {
        name: 'Vacaciones Verano',
        color: '#3b82f6',
        personal: false,
      },
    });
    expect(groupTagRes.status(), 'crear tag de grupo debe ser 201').toBe(201);
    const groupTag = ((await groupTagRes.json()) as { tag: { id: string; coupleId: string | null; ownerId: string | null } }).tag;
    expect(groupTag.coupleId).toBe(couple1.coupleId);
    expect(groupTag.ownerId).toBeNull();

    // B) Crear tag personal (ownerId asignado, coupleId null)
    const personalTagRes = await apiA1.post('/api/tags', {
      data: {
        name: 'Ahorro Personal',
        color: '#10b981',
        personal: true,
      },
    });
    expect(personalTagRes.status(), 'crear tag personal debe ser 201').toBe(201);
    const personalTag = ((await personalTagRes.json()) as { tag: { id: string; coupleId: string | null; ownerId: string | null } }).tag;
    expect(personalTag.ownerId).toBe(userA1.id);
    expect(personalTag.coupleId).toBeNull();

    // C) userA1 ve ambos tags (grupo + personal propio) en GET /api/tags
    const getTagsA1 = await apiA1.get('/api/tags');
    expect(getTagsA1.status()).toBe(200);
    const tagsA1 = ((await getTagsA1.json()) as { tags: Array<{ id: string }> }).tags;
    expect(tagsA1.some((t) => t.id === groupTag.id), 'userA1 ve el tag de grupo').toBe(true);
    expect(tagsA1.some((t) => t.id === personalTag.id), 'userA1 ve su tag personal').toBe(true);

    // D) Miembro de la misma pareja (userB1) ve el tag de grupo pero NO el personal de userA1
    const ctxB1 = await createAuthenticatedContext(browser, userB1);
    const apiB1 = ctxB1.request;
    const getTagsB1 = await apiB1.get('/api/tags');
    expect(getTagsB1.status()).toBe(200);
    const tagsB1 = ((await getTagsB1.json()) as { tags: Array<{ id: string }> }).tags;
    expect(tagsB1.some((t) => t.id === groupTag.id), 'userB1 ve el tag de grupo compartido').toBe(true);
    expect(tagsB1.some((t) => t.id === personalTag.id), 'userB1 NO debe ver el tag personal de userA1').toBe(false);

    // Intento de userB1 de borrar tag personal ajeno -> 403
    const forbiddenPersonalDelete = await apiB1.delete(`/api/tags/${personalTag.id}`);
    expect(forbiddenPersonalDelete.status(), 'userB1 no puede borrar tag personal de userA1').toBe(403);
    await ctxB1.close();

    // E) Usuario de otro espacio (userA2) no ve los tags de pareja 1 ni puede borrarlos
    const ctxA2 = await createAuthenticatedContext(browser, userA2);
    const apiA2 = ctxA2.request;
    const getTagsA2 = await apiA2.get('/api/tags');
    expect(getTagsA2.status()).toBe(200);
    const tagsA2 = ((await getTagsA2.json()) as { tags: Array<{ id: string }> }).tags;
    expect(tagsA2.some((t) => t.id === groupTag.id), 'userA2 no ve el tag de grupo ajeno').toBe(false);
    expect(tagsA2.some((t) => t.id === personalTag.id), 'userA2 no ve el tag personal ajeno').toBe(false);

    const forbiddenGroupDelete = await apiA2.delete(`/api/tags/${groupTag.id}`);
    expect(forbiddenGroupDelete.status(), 'userA2 no puede borrar tag de grupo ajeno').toBe(403);
    await ctxA2.close();

    // F) Propietario (userA1) elimina exitosamente sus tags con 200
    const delPersonalRes = await apiA1.delete(`/api/tags/${personalTag.id}`);
    expect(delPersonalRes.status(), 'userA1 borra su tag personal').toBe(200);
    const delPersonalJson = (await delPersonalRes.json()) as { success: boolean };
    expect(delPersonalJson.success).toBe(true);

    const delGroupRes = await apiA1.delete(`/api/tags/${groupTag.id}`);
    expect(delGroupRes.status(), 'userA1 borra tag de grupo').toBe(200);
    const delGroupJson = (await delGroupRes.json()) as { success: boolean };
    expect(delGroupJson.success).toBe(true);
  });

  test('4. Import CSV: importación por lotes idempotente por fingerprint y visibilidad PERSONAL', async ({
    page,
    context,
    request,
  }) => {
    await resetDb(request);

    const seed = await seedScenario(request, 'couple-no-expenses');
    const userA = seed.userA as { email: string; password: string };

    await loginAs(page, userA);
    const api = context.request;

    const importPayload = {
      rows: [
        {
          dateISO: '2026-10-01',
          amountCents: 1850,
          description: 'Compra Panadería Import',
          category: 'food',
        },
        {
          dateISO: '2026-10-02',
          amountCents: 4500,
          description: 'Gasolina Import Repsol',
          category: 'transport',
        },
      ],
    };

    // Primera importación: crea 2 gastos, 0 omitidos
    const firstImportRes = await api.post('/api/expenses/import', { data: importPayload });
    expect(firstImportRes.status(), 'primera importación debe responder 200').toBe(200);
    const firstBody = (await firstImportRes.json()) as { created: number; skipped: number };
    expect(firstBody.created, 'gastos creados en primer intento').toBe(2);
    expect(firstBody.skipped, 'gastos omitidos en primer intento').toBe(0);

    // Segunda importación (mismo contenido): fingerprint sha256 idéntico -> 0 creados, 2 omitidos
    const secondImportRes = await api.post('/api/expenses/import', { data: importPayload });
    expect(secondImportRes.status(), 'segunda importación debe responder 200').toBe(200);
    const secondBody = (await secondImportRes.json()) as { created: number; skipped: number };
    expect(secondBody.created, 'gastos creados en reimportación debe ser 0').toBe(0);
    expect(secondBody.skipped, 'gastos omitidos en reimportación debe ser 2').toBe(2);

    // Verificar que los gastos importados tienen visibilidad PERSONAL
    const personalExpensesRes = await api.get('/api/expenses?scope=personal');
    expect(personalExpensesRes.status()).toBe(200);
    const { expenses: personalList } = (await personalExpensesRes.json()) as {
      expenses: Array<{ description: string; visibility: string; amount: number }>;
    };

    const item1 = personalList.find((e) => e.description === 'Compra Panadería Import');
    const item2 = personalList.find((e) => e.description === 'Gasolina Import Repsol');
    expect(item1, 'gasto 1 importado presente en scope personal').toBeDefined();
    expect(item1!.visibility).toBe('PERSONAL');
    expect(item1!.amount).toBe(1850);

    expect(item2, 'gasto 2 importado presente en scope personal').toBeDefined();
    expect(item2!.visibility).toBe('PERSONAL');
    expect(item2!.amount).toBe(4500);

    // Verificar que NO aparecen en gastos compartidos del grupo
    const sharedExpensesRes = await api.get('/api/expenses?scope=shared');
    expect(sharedExpensesRes.status()).toBe(200);
    const { expenses: sharedList } = (await sharedExpensesRes.json()) as {
      expenses: Array<{ description: string }>;
    };
    expect(sharedList.some((e) => e.description === 'Compra Panadería Import')).toBe(false);
    expect(sharedList.some((e) => e.description === 'Gasolina Import Repsol')).toBe(false);
  });

  test('5. Export: GET /api/export devuelve CSV con los gastos del grupo y NO incluye gastos de otro espacio', async ({
    page,
    browser,
    context,
    request,
  }) => {
    await resetDb(request);

    // Sembrar dos espacios independientes
    const coupleX = await seedScenario(request, 'couple-no-expenses');
    const coupleY = await seedScenario(request, 'couple-no-expenses');

    const userAX = coupleX.userA as { email: string; password: string };
    const userAY = coupleY.userA as { email: string; password: string };

    // userAX crea un gasto compartido único en la pareja X
    await loginAs(page, userAX);
    const apiX = context.request;
    const createX = await apiX.post('/api/expenses', {
      data: {
        description: 'Cena Especial Pareja X',
        amount: '75.50',
        category: 'food',
      },
    });
    expect(createX.status(), 'crear gasto en pareja X').toBe(200);

    // userAY crea un gasto compartido único en la pareja Y
    const ctxY = await createAuthenticatedContext(browser, userAY);
    const apiY = ctxY.request;
    const createY = await apiY.post('/api/expenses', {
      data: {
        description: 'Alojamiento Secreto Pareja Y',
        amount: '130.00',
        category: 'other',
      },
    });
    expect(createY.status(), 'crear gasto en pareja Y').toBe(200);
    await ctxY.close();

    // userAX realiza export CSV de su grupo activo
    const exportRes = await apiX.get('/api/export');
    expect(exportRes.status(), 'GET /api/export debe ser 200').toBe(200);
    expect(exportRes.headers()['content-type']).toContain('text/csv');

    const csvText = await exportRes.text();

    // 1. Cabecera CSV obligatoria
    expect(csvText).toContain('fecha,descripcion,importe,categoria,pagado_por,mi_parte,notas');

    // 2. Contiene los datos del gasto de Pareja X
    expect(csvText).toContain('Cena Especial Pareja X');
    expect(csvText).toContain('75.50');

    // 3. NO contiene ningún dato del gasto de Pareja Y
    expect(csvText).not.toContain('Alojamiento Secreto Pareja Y');
    expect(csvText).not.toContain('130.00');
  });

});
