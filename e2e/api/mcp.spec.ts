import { test, expect } from '@playwright/test';
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

    // Emisión de token MCP para agente externo (kind: 'mcp', 90 días)
    const tokenRes = await api.post('/api/me/mcp-token');
    expect(tokenRes.status(), 'generar token MCP con sesión de usuario').toBe(201);
    const tokenBody = await tokenRes.json();
    expect(typeof tokenBody.token).toBe('string');
    expect(tokenBody.token.length).toBeGreaterThan(20);
    expect(tokenBody.expiresInDays).toBe(90);
    expect(tokenBody.expiresAt).toBeTruthy();

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
