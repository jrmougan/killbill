import { test, expect } from '../fixtures/test.fixture';
import { seedScenario } from '../fixtures/db.fixture';
import { loginAs } from '../fixtures/auth.fixture';

// Smoke del flujo de listas de la compra (planificación; el gasto lo contabiliza
// el OCR del ticket, no la lista — sin puente lista→gasto).
test('lista de grupo: crear, añadir, auto-pasillo, marcar idempotente, vaciar comprados', async ({ page, context, request }) => {
  const seed = await seedScenario(request, 'couple-with-debt');
  const groupId = seed.coupleId;
  await loginAs(page, { email: seed.userA!.email, password: seed.userA!.password });
  const api = context.request; // comparte cookies de sesión con el contexto logueado

  // crear lista
  let res = await api.post(`/api/spaces/${groupId}/lists`, { data: { name: 'Súper smoke' } });
  expect(res.status(), 'crear lista').toBe(201);
  const { list } = await res.json();

  // añadir 2 items (sin precio; el pasillo se auto-asigna por nombre)
  for (const name of ['Leche', 'Pan']) {
    const r = await api.post(`/api/spaces/${groupId}/lists/${list.id}/items`, { data: { name } });
    expect(r.ok(), `añadir ${name}`).toBeTruthy();
    const created = (await r.json()).item;
    expect(created.aisle, `pasillo auto de ${name}`).toBeTruthy();
  }

  // marcar ambos como comprados (toggle idempotente)
  res = await api.get(`/api/spaces/${groupId}/lists/${list.id}/items`);
  const { items } = await res.json();
  expect(items.length).toBe(2);
  for (const item of items) {
    const r = await api.patch(`/api/spaces/${groupId}/lists/${list.id}/items/${item.id}`, { data: { checked: true } });
    expect(r.ok(), 'marcar comprado').toBeTruthy();
  }
  // re-marcar es no-op (idempotente)
  const again = await api.patch(`/api/spaces/${groupId}/lists/${list.id}/items/${items[0].id}`, { data: { checked: true } });
  expect(again.ok()).toBeTruthy();
  expect((await again.json()).changed, 're-check no-op').toBe(false);

  // vaciar comprados → borra los marcados, la lista se conserva
  res = await api.post(`/api/spaces/${groupId}/lists/${list.id}/clear-checked`);
  expect(res.status(), 'vaciar comprados').toBe(200);
  expect((await res.json()).cleared, 'nº de comprados borrados').toBe(2);

  res = await api.get(`/api/spaces/${groupId}/lists/${list.id}/items`);
  const after = await res.json();
  expect(after.items.length, 'la lista queda vacía de comprados').toBe(0);

  // con `ids` (los tachados que mostraba la hoja) solo borra esos: uno tachado
  // después por otro miembro sobrevive, y `cleared` da el número real
  const ids: string[] = [];
  for (const name of ['Huevos', 'Arroz']) {
    const r = await api.post(`/api/spaces/${groupId}/lists/${list.id}/items`, { data: { name } });
    const { item } = await r.json();
    await api.patch(`/api/spaces/${groupId}/lists/${list.id}/items/${item.id}`, { data: { checked: true } });
    ids.push(item.id);
  }
  res = await api.post(`/api/spaces/${groupId}/lists/${list.id}/clear-checked`, { data: { ids: [ids[0]] } });
  expect(res.status(), 'vaciar solo los mostrados').toBe(200);
  expect((await res.json()).cleared, 'borra solo el id enviado').toBe(1);
  res = await api.get(`/api/spaces/${groupId}/lists/${list.id}/items`);
  expect((await res.json()).items.map((i: { id: string }) => i.id), 'el tachado no mostrado sigue').toEqual([ids[1]]);

  res = await api.post(`/api/spaces/${groupId}/lists/${list.id}/clear-checked`, { data: { ids: 'x' } });
  expect(res.status(), 'ids no válidos').toBe(400);
  expect((await res.json()).code).toBe('INVALID_IDS');
});

test('lista personal se crea vía /api/me/lists', async ({ page, context, request }) => {
  const seed = await seedScenario(request, 'couple-with-debt');
  await loginAs(page, { email: seed.userA!.email, password: seed.userA!.password });
  const api = context.request;
  const res = await api.post('/api/me/lists', { data: { name: 'Personal smoke' } });
  expect(res.status(), 'crear lista personal').toBe(201);
  const list = (await res.json()).list;
  expect(list?.id).toBeTruthy();
});
