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

/** POST /api/mcp initialize with the given Bearer; returns the raw response. */
function mcpInitialize(request: APIRequestContext, bearer?: string, client = 'playwright-e2e-client') {
  return request.post('/api/mcp', {
    headers: mcpHeaders(bearer),
    data: {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: client, version: '1.0.0' } },
    },
  });
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

/**
 * Sign a legacy 90-day `kind:'mcp'` JWT for the logged-in user (test-only route).
 * "Conectar Hermes Agent" emitted it until #60; the ones already issued must keep
 * working as Bearer until #61 retires them.
 */
async function issueLegacyJwt(api: APIRequestContext) {
  const res = await api.post('/api/test/legacy-mcp-jwt');
  expect(res.status(), 'POST /api/test/legacy-mcp-jwt').toBe(201);
  const { token } = (await res.json()) as { token: string };
  expect(token.startsWith('eyJ'), 'JWT compacto').toBe(true);
  return token;
}

/** "Conectar Hermes Agent": POST /api/me/mcp-token → access token «Hermes Agent». */
async function connectHermes(api: APIRequestContext) {
  const res = await api.post('/api/me/mcp-token');
  expect(res.status(), 'POST /api/me/mcp-token').toBe(201);
  expect(res.headers()['cache-control']).toContain('no-store');
  return (await res.json()) as {
    token: string;
    id: string;
    name: string;
    prefix: string;
    expiresAt: string;
    expiresInDays: number;
    status: string;
    replaced: number;
  };
}

async function sessionCookie(context: BrowserContext): Promise<string> {
  const cookie = (await context.cookies(baseURL)).find((c) => c.name === 'session_token');
  expect(cookie?.value, 'cookie de sesión tras login').toBeTruthy();
  return cookie!.value;
}

test.describe('API MCP - Smoke y autenticación Bearer', () => {
  test('1. Login normal -> POST /api/me/mcp-token -> token; POST /api/mcp initialize -> respuesta válida; tools/list -> tools conocidas', async ({
    page,
    context,
    request,
  }) => {
    // Escenario con usuario registrado
    const seed = await seedScenario(request, 'solo-user');
    await loginAs(page, { email: seed.user!.email, password: seed.user!.password! });
    const api = context.request;

    // "Conectar Hermes Agent": token de acceso opaco «Hermes Agent» de 90 días
    const tokenBody = await connectHermes(api);
    expect(tokenBody.token).toMatch(/^kb_[A-Za-z0-9_-]{43}$/);
    expect(tokenBody.name).toBe('Hermes Agent');
    expect(tokenBody.status).toBe('active');
    expect(tokenBody.replaced).toBe(0);
    expect(tokenBody.expiresInDays).toBe(90);
    const days = (new Date(tokenBody.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(89);
    expect(days).toBeLessThanOrEqual(90);

    const mcpToken = tokenBody.token as string;
    const mcpHeaders = {
      Authorization: `Bearer ${mcpToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };

    // JSON-RPC initialize
    const initRes = await request.post('/api/mcp', {
      headers: mcpHeaders,
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'playwright-e2e-client',
            version: '1.0.0',
          },
        },
      },
    });
    expect(initRes.status(), 'POST /api/mcp initialize').toBe(200);

    const sessionId = initRes.headers()['mcp-session-id'];
    const initText = await initRes.text();
    const initRpc = parseMcpResponse(initText);

    expect(initRpc.jsonrpc).toBe('2.0');
    expect(initRpc.id).toBe(1);
    expect(initRpc.result).toBeDefined();
    expect(initRpc.result.protocolVersion).toBe('2024-11-05');
    expect(initRpc.result.serverInfo).toBeDefined();
    expect(initRpc.result.serverInfo.name).toBe('killbill');
    expect(initRpc.result.serverInfo.version).toBe('1.0.0');

    // JSON-RPC tools/list
    const toolsHeaders: Record<string, string> = { ...mcpHeaders };
    if (sessionId) {
      toolsHeaders['mcp-session-id'] = sessionId;
    }

    const toolsRes = await request.post('/api/mcp', {
      headers: toolsHeaders,
      data: {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      },
    });
    expect(toolsRes.status(), 'POST /api/mcp tools/list').toBe(200);

    const toolsText = await toolsRes.text();
    const toolsRpc = parseMcpResponse(toolsText);

    expect(toolsRpc.jsonrpc).toBe('2.0');
    expect(toolsRpc.id).toBe(2);
    expect(toolsRpc.result).toBeDefined();
    expect(Array.isArray(toolsRpc.result.tools)).toBe(true);

    const toolNames = toolsRpc.result.tools.map((t: { name: string }) => t.name);
    // Verificación de herramientas clave esperadas
    expect(toolNames).toContain('list_spaces');
    expect(toolNames).toContain('get_balance');
    expect(toolNames).toContain('list_expenses');
    expect(toolNames).toContain('create_expense');
    expect(toolNames).toContain('get_budgets');
    expect(toolNames).toContain('get_categories');
    expect(toolNames).toContain('list_shopping_lists');
    expect(toolNames).toContain('ping');
  });

  test('2. Bearer token guest (ephemeral-with-guest) -> rechazado con 401/403', async ({
    request,
  }) => {
    // Escenario con usuario guest shadow que tiene sessionToken de tipo guest
    const seed = await seedScenario(request, 'ephemeral-with-guest');
    const guestData = seed.guest as { id: string; sessionToken: string };
    expect(guestData?.sessionToken).toBeTruthy();

    const res = await request.post('/api/mcp', {
      headers: {
        Authorization: `Bearer ${guestData.sessionToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'guest-client', version: '1.0.0' },
        },
      },
    });
    expect([401, 403], 'token guest no debe autorizar MCP').toContain(res.status());
  });

  test('3. Bearer inventado o expirado -> 401', async ({ request }) => {
    // Token completamente inventado
    const fakeRes = await request.post('/api/mcp', {
      headers: {
        Authorization: 'Bearer token-falso-inventado-invalido',
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'fake-client', version: '1.0.0' },
        },
      },
    });
    expect(fakeRes.status(), 'token inventado debe ser 401').toBe(401);

    // JWT con firma manipulada / expirado
    const expiredRes = await request.post('/api/mcp', {
      headers: {
        Authorization:
          'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJjb3JydXB0ZWQiLCJraW5kIjoibWNwIiwiZXhwIjoxNjAwMDAwMDAwfQ.invalid_signature',
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      data: {
        jsonrpc: '2.0',
        id: 2,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'expired-client', version: '1.0.0' },
        },
      },
    });
    expect(expiredRes.status(), 'token expirado/firma inválida debe ser 401').toBe(401);
  });

  test('4. Sin header Authorization -> 401', async ({ request }) => {
    const res = await request.post('/api/mcp', {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'no-auth-client', version: '1.0.0' },
        },
      },
    });
    expect(res.status(), 'petición sin Authorization header debe ser 401').toBe(401);
  });
});

test.describe('API MCP - Tokens de acceso opacos (kb_…) junto al JWT de 90 días', () => {
  test('5. POST /api/me/tokens (90 días) -> token opaco; initialize + tools/list + tools/call; el JWT antiguo sigue valiendo', async ({
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
    expect(initRpc.result.serverInfo.name).toBe('killbill');

    const toolsRes = await request.post('/api/mcp', {
      headers: mcpHeaders(issued.token),
      data: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    });
    expect(toolsRes.status(), 'POST /api/mcp tools/list').toBe(200);
    const toolNames = (parseMcpResponse(await toolsRes.text()).result.tools as Array<{ name: string }>).map((t) => t.name);
    for (const name of ['list_spaces', 'get_balance', 'create_expense', 'ping']) {
      expect(toolNames).toContain(name);
    }

    // A tool round-trips to the real API routes with BOTH credentials: the opaque
    // token through the per-request internal JWT, the legacy JWT forwarded as is.
    const legacyJwt = await issueLegacyJwt(api);
    for (const [label, bearer] of [['token opaco', issued.token], ['JWT de 90 días', legacyJwt]] as const) {
      const callRes = await request.post('/api/mcp', {
        headers: mcpHeaders(bearer),
        data: { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_spaces', arguments: {} } },
      });
      expect(callRes.status(), `tools/call list_spaces (${label})`).toBe(200);
      const callRpc = parseMcpResponse(await callRes.text());
      expect(callRpc.result, JSON.stringify(callRpc)).toBeDefined();
      expect(callRpc.result.isError ?? false, `${label}: ${JSON.stringify(callRpc.result)}`).toBe(false);
    }

    // lastUsedAt is written fire-and-forget on the first authenticated request.
    await expect
      .poll(async () => {
        const body = (await (await api.get('/api/me/tokens')).json()) as { tokens: Array<{ lastUsedAt: string | null }> };
        return body.tokens[0]?.lastUsedAt;
      })
      .toBeTruthy();
  });

  test('6. Token sin caducidad funciona (initialize + tools/list)', async ({ page, context, request }) => {
    const seed = await seedScenario(request, 'solo-user');
    await loginAs(page, { email: seed.user!.email, password: seed.user!.password! });

    const issued = await issueToken(context.request, 'Sin caducidad e2e', null);
    expect(issued.expiresAt).toBeNull();
    expect(issued.status).toBe('active');

    expect((await mcpInitialize(request, issued.token)).status()).toBe(200);
    const toolsRes = await request.post('/api/mcp', {
      headers: mcpHeaders(issued.token),
      data: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    });
    expect(toolsRes.status()).toBe(200);
    expect(parseMcpResponse(await toolsRes.text()).result.tools.length).toBeGreaterThan(0);
  });

  test('7. Token revocado -> 401 sin afectar a los demás; revocar es idempotente; id inexistente -> 404', async ({
    page,
    context,
    request,
  }) => {
    const seed = await seedScenario(request, 'solo-user');
    await loginAs(page, { email: seed.user!.email, password: seed.user!.password! });
    const api = context.request;

    const issued = await issueToken(api, 'Para revocar', 30);
    const other = await issueToken(api, 'Sigue vivo', 365);
    const legacyJwt = await issueLegacyJwt(api);
    expect((await mcpInitialize(request, issued.token)).status()).toBe(200);

    const del = await api.delete(`/api/me/tokens/${issued.id}`);
    expect(del.status()).toBe(200);
    expect(await del.json()).toEqual({ success: true });
    expect((await mcpInitialize(request, issued.token)).status(), 'token revocado').toBe(401);
    expect((await mcpInitialize(request, other.token)).status(), 'otro token opaco intacto').toBe(200);
    expect((await mcpInitialize(request, legacyJwt)).status(), 'JWT de 90 días intacto').toBe(200);

    expect((await api.delete(`/api/me/tokens/${issued.id}`)).status(), 'revocar dos veces').toBe(200);
    const missing = await api.delete('/api/me/tokens/no-existe');
    expect(missing.status()).toBe(404);
    expect((await missing.json()).error).toBe('Token no encontrado');

    const { tokens } = (await (await api.get('/api/me/tokens')).json()) as { tokens: Array<{ id: string; status: string }> };
    expect(tokens.find((t) => t.id === issued.id)?.status).toBe('revoked');
    expect(tokens.find((t) => t.id === other.id)?.status).toBe('active');
  });

  test('8. JWT de sesión como Bearer -> 401; token opaco como cookie session_token -> 401; un token MCP no gestiona tokens', async ({
    page,
    context,
    request,
    newContext,
  }) => {
    const seed = await seedScenario(request, 'solo-user');
    await loginAs(page, { email: seed.user!.email, password: seed.user!.password! });
    const sessionJwt = await sessionCookie(context);
    const issued = await issueToken(context.request, 'Cruce', 90);
    const legacyJwt = await issueLegacyJwt(context.request);

    // A browser session JWT is never an MCP Bearer.
    expect((await mcpInitialize(request, sessionJwt)).status(), 'JWT de sesión como Bearer').toBe(401);

    // The opaque token is never a session cookie.
    const tokenCtx = await newContext();
    await tokenCtx.addCookies([{ name: 'session_token', value: issued.token, url: baseURL }]);
    expect((await tokenCtx.request.get('/api/me/tokens')).status(), 'token opaco como cookie en /api/me/tokens').toBe(401);
    expect((await tokenCtx.request.get('/api/expenses?scope=personal')).status(), 'token opaco como cookie en /api/expenses').toBe(401);
    await tokenCtx.close();

    // An MCP JWT forwarded as cookie must not list, mint or revoke access tokens.
    const mcpCtx = await newContext();
    await mcpCtx.addCookies([{ name: 'session_token', value: legacyJwt, url: baseURL }]);
    expect((await mcpCtx.request.get('/api/me/tokens')).status()).toBe(403);
    expect((await mcpCtx.request.post('/api/me/tokens', { data: { name: 'Auto', expiresInDays: null } })).status()).toBe(403);
    expect((await mcpCtx.request.delete(`/api/me/tokens/${issued.id}`)).status()).toBe(403);
    await mcpCtx.close();
    expect((await mcpInitialize(request, issued.token)).status(), 'el token sigue activo').toBe(200);
  });

  test('9. Tras POST /api/me/sessions/revoke dejan de funcionar los tokens opacos y el JWT de 90 días', async ({
    page,
    context,
    request,
  }) => {
    const seed = await seedScenario(request, 'solo-user');
    await loginAs(page, { email: seed.user!.email, password: seed.user!.password! });
    const api = context.request;

    const a = await issueToken(api, 'Portátil', 90);
    const b = await issueToken(api, 'Servidor', null);
    const legacyJwt = await issueLegacyJwt(api);
    expect((await mcpInitialize(request, a.token)).status()).toBe(200);
    expect((await mcpInitialize(request, b.token)).status()).toBe(200);
    expect((await mcpInitialize(request, legacyJwt)).status()).toBe(200);

    const revoke = await api.post('/api/me/sessions/revoke');
    expect(revoke.ok(), `sessions/revoke → ${revoke.status()}`).toBe(true);

    expect((await mcpInitialize(request, a.token)).status(), 'token 90 días tras revocar sesiones').toBe(401);
    expect((await mcpInitialize(request, b.token)).status(), 'token sin caducidad tras revocar sesiones').toBe(401);
    expect((await mcpInitialize(request, legacyJwt)).status(), 'JWT de 90 días tras revocar sesiones').toBe(401);

    // The current device is logged out too; after logging in again both rows show as revoked.
    expect((await api.get('/api/me/tokens')).status(), 'la cookie actual también se invalida').toBe(401);
    await loginAs(page, { email: seed.user!.email, password: seed.user!.password! });
    const list = await api.get('/api/me/tokens');
    expect(list.status()).toBe(200);
    const { tokens } = (await list.json()) as { tokens: Array<{ status: string }> };
    expect(tokens.map((t) => t.status)).toEqual(['revoked', 'revoked']);
  });

  test('10. Token con formato kb_ desconocido o mal formado -> 401; cuerpo de alta inválido -> 400', async ({
    page,
    context,
    request,
  }) => {
    expect((await mcpInitialize(request, `kb_${'A'.repeat(43)}`, 'fake-kb-client')).status()).toBe(401);
    expect((await mcpInitialize(request, 'kb_corto', 'fake-kb-client')).status()).toBe(401);

    const seed = await seedScenario(request, 'solo-user');
    await loginAs(page, { email: seed.user!.email, password: seed.user!.password! });
    const api = context.request;
    expect((await api.post('/api/me/tokens', { data: { name: 'Sin duración' } })).status()).toBe(400);
    expect((await api.post('/api/me/tokens', { data: { name: 'Mala', expiresInDays: 7 } })).status()).toBe(400);
    expect((await api.post('/api/me/tokens', { data: { name: '  ', expiresInDays: 30 } })).status()).toBe(400);
  });

  test('11. Reconectar Hermes revoca solo el token «Hermes Agent» anterior; los demás tokens y el JWT antiguo siguen valiendo', async ({
    page,
    context,
    request,
  }) => {
    const seed = await seedScenario(request, 'solo-user');
    await loginAs(page, { email: seed.user!.email, password: seed.user!.password! });
    const api = context.request;

    const other = await issueToken(api, 'Otro cliente', 30);
    const legacyJwt = await issueLegacyJwt(api);
    const first = await connectHermes(api);
    expect((await mcpInitialize(request, first.token)).status(), 'primer token Hermes').toBe(200);

    const second = await connectHermes(api);
    expect(second.token).not.toBe(first.token);
    expect(second.replaced).toBe(1);
    expect((await mcpInitialize(request, first.token)).status(), 'token Hermes anterior revocado').toBe(401);
    expect((await mcpInitialize(request, second.token)).status(), 'token Hermes nuevo').toBe(200);
    expect((await mcpInitialize(request, other.token)).status(), 'otro token intacto').toBe(200);
    expect((await mcpInitialize(request, legacyJwt)).status(), 'JWT de 90 días ya emitido intacto').toBe(200);

    const { tokens } = (await (await api.get('/api/me/tokens')).json()) as {
      tokens: Array<{ id: string; name: string; status: string }>;
    };
    expect(tokens.filter((t) => t.name === 'Hermes Agent' && t.status === 'active').map((t) => t.id)).toEqual([second.id]);
    expect(tokens.find((t) => t.id === first.id)?.status).toBe('revoked');
    expect(tokens.find((t) => t.id === other.id)?.status).toBe('active');

    // Revoked individually like any other access token.
    expect((await api.delete(`/api/me/tokens/${second.id}`)).status()).toBe(200);
    expect((await mcpInitialize(request, second.token)).status(), 'token Hermes revocado desde la lista').toBe(401);
    expect((await mcpInitialize(request, legacyJwt)).status()).toBe(200);

    // A token cannot reconnect Hermes on its own behalf.
    const mcpCall = await request.post('/api/me/mcp-token', { headers: { Authorization: `Bearer ${other.token}` } });
    expect(mcpCall.status(), 'Bearer en /api/me/mcp-token').toBe(401);
  });
});
