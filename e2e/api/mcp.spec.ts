import type { APIRequestContext, BrowserContext } from '@playwright/test';
import { test, expect } from '../fixtures/test.fixture';
import { seedScenario } from '../fixtures/db.fixture';
import { loginAs } from '../fixtures/auth.fixture';

/**
 * Parsea respuestas de MCP que pueden venir formateadas como SSE (text/event-stream)
 * ("event: message\ndata: { ... }\n\n") o como JSON directo.
 */
function parseMcpResponse(bodyText: string) {
  const lines = bodyText.split('\n');
  const dataLine = lines.find((line) => line.startsWith('data: '));
  if (dataLine) {
    return JSON.parse(dataLine.slice(6));
  }
  return JSON.parse(bodyText);
}

const baseURL = process.env.TEST_BASE_URL || 'http://localhost:3000';

function mcpHeaders(bearer?: string): Record<string, string> {
  return {
    ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
}

const initialize = (id: number, client: string) => ({
  jsonrpc: '2.0',
  id,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: client, version: '1.0.0' },
  },
});

/** POST /api/mcp initialize with the given Bearer; returns the raw response. */
function mcpInitialize(request: APIRequestContext, bearer?: string, client = 'playwright-e2e-client') {
  return request.post('/api/mcp', { headers: mcpHeaders(bearer), data: initialize(1, client) });
}

/** Issue an opaque access token through the browser-session API. */
async function issueToken(api: APIRequestContext, name: string, expiresInDays: 30 | 90 | 365 | null) {
  const res = await api.post('/api/me/tokens', { data: { name, expiresInDays } });
  expect(res.status(), `POST /api/me/tokens (${name})`).toBe(201);
  expect(res.headers()['cache-control']).toContain('no-store');
  return (await res.json()) as {
    token: string;
    id: string;
    name: string;
    prefix: string;
    expiresAt: string | null;
    status: string;
  };
}

async function sessionCookie(context: BrowserContext): Promise<string> {
  const cookie = (await context.cookies(baseURL)).find((c) => c.name === 'session_token');
  expect(cookie?.value, 'cookie de sesión tras login').toBeTruthy();
  return cookie!.value;
}

test.describe('API MCP - Smoke y autenticación Bearer', () => {
  test('1. Login normal -> POST /api/me/tokens (90 días) -> token opaco; initialize + tools/list', async ({
    page,
    context,
    request,
  }) => {
    const seed = await seedScenario(request, 'solo-user');
    await loginAs(page, { email: seed.user!.email, password: seed.user!.password! });
    const api = context.request;

    const issued = await issueToken(api, 'Cliente e2e', 90);
    expect(issued.token).toMatch(/^kb_[A-Za-z0-9_-]{43}$/);
    expect(issued.prefix).toBe(issued.token.slice(0, 11));
    expect(issued.name).toBe('Cliente e2e');
    expect(issued.status).toBe('active');
    expect(issued.expiresAt).toBeTruthy();
    const days = (new Date(issued.expiresAt!).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(89);
    expect(days).toBeLessThanOrEqual(90);

    // The list exposes metadata only, never the plaintext.
    const list = await api.get('/api/me/tokens');
    expect(list.status()).toBe(200);
    const listText = await list.text();
    expect(listText).not.toContain(issued.token);
    const { tokens } = JSON.parse(listText) as { tokens: Array<{ id: string; status: string }> };
    expect(tokens).toEqual([expect.objectContaining({ id: issued.id, status: 'active' })]);

    const initRes = await mcpInitialize(request, issued.token);
    expect(initRes.status(), 'POST /api/mcp initialize').toBe(200);
    const initRpc = parseMcpResponse(await initRes.text());
    expect(initRpc.jsonrpc).toBe('2.0');
    expect(initRpc.id).toBe(1);
    expect(initRpc.result.protocolVersion).toBe('2024-11-05');
    expect(initRpc.result.serverInfo.name).toBe('killbill');
    expect(initRpc.result.serverInfo.version).toBe('1.0.0');

    const toolsRes = await request.post('/api/mcp', {
      headers: mcpHeaders(issued.token),
      data: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    });
    expect(toolsRes.status(), 'POST /api/mcp tools/list').toBe(200);
    const toolsRpc = parseMcpResponse(await toolsRes.text());
    expect(toolsRpc.id).toBe(2);
    const toolNames = (toolsRpc.result.tools as Array<{ name: string }>).map((t) => t.name);
    for (const name of ['list_spaces', 'get_balance', 'list_expenses', 'create_expense', 'get_budgets', 'get_categories', 'list_shopping_lists', 'ping']) {
      expect(toolNames).toContain(name);
    }

    // A tool round-trips through the internal JWT to the real API routes.
    const callRes = await request.post('/api/mcp', {
      headers: mcpHeaders(issued.token),
      data: { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_spaces', arguments: {} } },
    });
    expect(callRes.status(), 'tools/call list_spaces').toBe(200);
    const callRpc = parseMcpResponse(await callRes.text());
    expect(callRpc.result, JSON.stringify(callRpc)).toBeDefined();
    expect(callRpc.result.isError ?? false, JSON.stringify(callRpc.result)).toBe(false);
  });

  test('2. Token sin caducidad funciona (initialize + tools/list)', async ({ page, context, request }) => {
    const seed = await seedScenario(request, 'solo-user');
    await loginAs(page, { email: seed.user!.email, password: seed.user!.password! });

    const issued = await issueToken(context.request, 'Sin caducidad e2e', null);
    expect(issued.expiresAt).toBeNull();
    expect(issued.status).toBe('active');

    const initRes = await mcpInitialize(request, issued.token);
    expect(initRes.status()).toBe(200);
    expect(parseMcpResponse(await initRes.text()).result.serverInfo.name).toBe('killbill');

    const toolsRes = await request.post('/api/mcp', {
      headers: mcpHeaders(issued.token),
      data: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    });
    expect(toolsRes.status()).toBe(200);
    expect(parseMcpResponse(await toolsRes.text()).result.tools.length).toBeGreaterThan(0);
  });

  test('3. Token revocado (DELETE /api/me/tokens/[id]) -> 401; revocar es idempotente; id ajeno -> 404', async ({
    page,
    context,
    request,
  }) => {
    const seed = await seedScenario(request, 'solo-user');
    await loginAs(page, { email: seed.user!.email, password: seed.user!.password! });
    const api = context.request;

    const issued = await issueToken(api, 'Para revocar', 30);
    expect((await mcpInitialize(request, issued.token)).status()).toBe(200);

    const del = await api.delete(`/api/me/tokens/${issued.id}`);
    expect(del.status()).toBe(200);
    expect(await del.json()).toEqual({ success: true });
    expect((await mcpInitialize(request, issued.token)).status(), 'token revocado').toBe(401);

    expect((await api.delete(`/api/me/tokens/${issued.id}`)).status(), 'revocar dos veces').toBe(200);
    const missing = await api.delete('/api/me/tokens/no-existe');
    expect(missing.status()).toBe(404);
    expect((await missing.json()).error).toBe('Token no encontrado');

    const { tokens } = (await (await api.get('/api/me/tokens')).json()) as { tokens: Array<{ id: string; status: string }> };
    expect(tokens.find((t) => t.id === issued.id)?.status).toBe('revoked');
  });

  test('4. JWT de sesión como Bearer -> 401; token opaco como cookie session_token -> 401', async ({
    page,
    context,
    request,
    newContext,
  }) => {
    const seed = await seedScenario(request, 'solo-user');
    await loginAs(page, { email: seed.user!.email, password: seed.user!.password! });
    const sessionJwt = await sessionCookie(context);
    const issued = await issueToken(context.request, 'Cruce', 90);

    // A browser session JWT is never an MCP Bearer.
    expect((await mcpInitialize(request, sessionJwt)).status(), 'JWT de sesión como Bearer').toBe(401);

    // The opaque token is never a session cookie.
    const tokenCtx = await newContext();
    await tokenCtx.addCookies([{ name: 'session_token', value: issued.token, url: baseURL }]);
    const meTokens = await tokenCtx.request.get('/api/me/tokens');
    expect(meTokens.status(), 'token opaco como cookie en /api/me/tokens').toBe(401);
    const expenses = await tokenCtx.request.get('/api/expenses?scope=personal');
    expect(expenses.status(), 'token opaco como cookie en /api/expenses').toBe(401);
    await tokenCtx.close();
  });

  test('5. Tras POST /api/me/sessions/revoke los tokens de acceso dejan de funcionar', async ({
    page,
    context,
    request,
  }) => {
    const seed = await seedScenario(request, 'solo-user');
    await loginAs(page, { email: seed.user!.email, password: seed.user!.password! });
    const api = context.request;

    const a = await issueToken(api, 'Portátil', 90);
    const b = await issueToken(api, 'Servidor', null);
    expect((await mcpInitialize(request, a.token)).status()).toBe(200);
    expect((await mcpInitialize(request, b.token)).status()).toBe(200);

    const revoke = await api.post('/api/me/sessions/revoke');
    expect(revoke.ok(), `sessions/revoke → ${revoke.status()}`).toBe(true);

    expect((await mcpInitialize(request, a.token)).status(), 'token 90 días tras revocar sesiones').toBe(401);
    expect((await mcpInitialize(request, b.token)).status(), 'token sin caducidad tras revocar sesiones').toBe(401);

    // The current device is logged out too; after logging in again both rows show as revoked.
    expect((await api.get('/api/me/tokens')).status(), 'la cookie actual también se invalida').toBe(401);
    await loginAs(page, { email: seed.user!.email, password: seed.user!.password! });
    const list = await api.get('/api/me/tokens');
    expect(list.status()).toBe(200);
    const { tokens } = (await list.json()) as { tokens: Array<{ status: string }> };
    expect(tokens.map((t) => t.status)).toEqual(['revoked', 'revoked']);
  });

  test('6. Bearer token guest (ephemeral-with-guest) -> rechazado con 401/403', async ({ request }) => {
    const seed = await seedScenario(request, 'ephemeral-with-guest');
    const guestData = seed.guest as { id: string; sessionToken: string };
    expect(guestData?.sessionToken).toBeTruthy();

    const res = await mcpInitialize(request, guestData.sessionToken, 'guest-client');
    expect([401, 403], 'token guest no debe autorizar MCP').toContain(res.status());
  });

  test('7. Bearer inventado, con formato kb_ desconocido o JWT manipulado -> 401', async ({ request }) => {
    expect((await mcpInitialize(request, 'token-falso-inventado-invalido', 'fake-client')).status()).toBe(401);
    expect((await mcpInitialize(request, `kb_${'A'.repeat(43)}`, 'fake-kb-client')).status()).toBe(401);
    const forgedJwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJjb3JydXB0ZWQiLCJraW5kIjoibWNwIiwiZXhwIjoxNjAwMDAwMDAwfQ.invalid_signature';
    expect((await mcpInitialize(request, forgedJwt, 'expired-client')).status()).toBe(401);
  });

  test('8. Sin header Authorization -> 401', async ({ request }) => {
    expect((await mcpInitialize(request, undefined, 'no-auth-client')).status()).toBe(401);
  });
});
