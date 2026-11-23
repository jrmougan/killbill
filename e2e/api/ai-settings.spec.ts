import type { APIRequestContext, APIResponse } from '@playwright/test';
import { test, expect } from '../fixtures/test.fixture';
import { resetDb, seedScenario } from '../fixtures/db.fixture';
import { loginAs, createAuthenticatedContext } from '../fixtures/auth.fixture';

const SETTINGS_URL = '/api/admin/ai-settings';
const MODELS_URL = '/api/admin/ai-settings/models';
const PROVIDERS = ['gemini', 'openrouter'] as const;
// Never a real credential; the test server's env fake ("ocr-e2e-fake") has a different hint.
const PLAINTEXT_KEY = 'e2e-ai-settings-plaintext-W9xZ';
const KEY_HINT = 'W9xZ';
const MODEL = 'gemini-e2e-model';

interface ProviderView {
  provider: (typeof PROVIDERS)[number];
  keySource: string;
  keyHint: string | null;
  keyUndecryptable: boolean;
  model: string;
  modelSource: string;
  defaultModel: string;
  fallbackModel: string;
}

function geminiOf(body: { providers: ProviderView[] }): ProviderView {
  const gemini = body.providers.find((provider) => provider.provider === 'gemini');
  if (!gemini) throw new Error('La vista no incluye el proveedor gemini');
  return gemini;
}

async function readSettings(api: APIRequestContext): Promise<{ providers: ProviderView[] }> {
  const res = await api.get(SETTINGS_URL);
  expect(res.status(), 'GET ai-settings como admin').toBe(200);
  expectNoPlaintext(res, await res.text());
  return res.json();
}

function expectNoPlaintext(res: APIResponse, text: string): void {
  expect(text, 'la respuesta no expone la clave').not.toContain(PLAINTEXT_KEY);
  expect(res.headers()['cache-control'], 'la respuesta no es cacheable').toContain('no-store');
}

test.describe('API Admin - Configuración de claves y modelos de IA', () => {
  // Every test runs with an admin session in `page`/`context`, also used to clean up.
  test.beforeEach(async ({ page, request }) => {
    await resetDb(request);
    const seed = await seedScenario(request, 'admin-with-invite');
    await loginAs(page, { email: seed.admin!.email, password: seed.admin!.password! });
  });

  // resetDb deletes the users, so the admin session has to clear the settings first.
  test.afterEach(async ({ context, request }) => {
    try {
      for (const provider of PROVIDERS) {
        const res = await context.request.patch(SETTINGS_URL, {
          data: { provider, apiKey: null, model: null },
        });
        expect(res.status(), `limpieza de ${provider}`).toBe(200);
      }
    } finally {
      await resetDb(request);
    }
  });

  test('1. Admin guarda una clave: PATCH y GET muestran solo la pista, nunca el texto plano', async ({ context }) => {
    const api = context.request;

    const patchRes = await api.patch(SETTINGS_URL, {
      data: { provider: 'gemini', apiKey: PLAINTEXT_KEY, model: MODEL },
    });
    expect(patchRes.status(), 'PATCH ai-settings como admin').toBe(200);
    expectNoPlaintext(patchRes, await patchRes.text());

    for (const body of [await patchRes.json(), await readSettings(api)]) {
      expect(body.providers.map((provider: ProviderView) => provider.provider)).toEqual([...PROVIDERS]);
      expect(geminiOf(body)).toMatchObject({
        keySource: 'database',
        keyHint: KEY_HINT,
        keyUndecryptable: false,
        model: MODEL,
        modelSource: 'database',
      });
    }
  });

  test('2. Limpiar clave y modelo restaura el estado anterior', async ({ context }) => {
    const api = context.request;
    const before = await readSettings(api);

    const setRes = await api.patch(SETTINGS_URL, {
      data: { provider: 'gemini', apiKey: PLAINTEXT_KEY, model: MODEL },
    });
    expect(setRes.status()).toBe(200);
    expect(geminiOf(await readSettings(api)).keySource).toBe('database');

    const clearRes = await api.patch(SETTINGS_URL, {
      data: { provider: 'gemini', apiKey: null, model: null },
    });
    expect(clearRes.status()).toBe(200);
    expect(await clearRes.json()).toEqual(before);
    expect(await readSettings(api)).toEqual(before);
  });

  test('3. Una clave inválida da 400, no se guarda y el error no la repite', async ({ context }) => {
    const api = context.request;
    const before = await readSettings(api);
    const invalidKey = 'invalid key with spaces W9xZ';

    const res = await api.patch(SETTINGS_URL, { data: { provider: 'gemini', apiKey: invalidKey } });
    expect(res.status()).toBe(400);
    expect(await res.text()).not.toContain(invalidKey);
    expect(await readSettings(api)).toEqual(before);
  });

  test('4. Un usuario sin rol de administración recibe 403 y no cambia nada', async ({ context, request, newContext }) => {
    const before = await readSettings(context.request);
    const seed = await seedScenario(request, 'couple-no-expenses');
    const userContext = await createAuthenticatedContext(newContext, {
      email: seed.userA!.email,
      password: seed.userA!.password,
    });

    const getRes = await userContext.request.get(SETTINGS_URL);
    expect(getRes.status(), 'GET como no admin').toBe(403);

    const patchRes = await userContext.request.patch(SETTINGS_URL, {
      data: { provider: 'gemini', apiKey: PLAINTEXT_KEY },
    });
    expect(patchRes.status(), 'PATCH como no admin').toBe(403);

    expect(await readSettings(context.request)).toEqual(before);
  });

  test('5. Una petición anónima recibe 401 y no cambia nada', async ({ context, request }) => {
    const before = await readSettings(context.request);

    const getRes = await request.get(SETTINGS_URL);
    expect(getRes.status(), 'GET anónimo').toBe(401);

    const patchRes = await request.patch(SETTINGS_URL, {
      data: { provider: 'gemini', apiKey: PLAINTEXT_KEY },
    });
    expect(patchRes.status(), 'PATCH anónimo').toBe(401);

    expect(await readSettings(context.request)).toEqual(before);
  });

  // The lists come from the loopback provider stub (e2e/ocr/provider-stub.mjs),
  // always with the env fake key: a key saved here never reaches it.
  test('6. Lista solo los modelos con visión de cada proveedor, sin exponer la clave', async ({ context }) => {
    const api = context.request;
    const saved = await api.patch(SETTINGS_URL, { data: { provider: 'gemini', apiKey: PLAINTEXT_KEY } });
    expect(saved.status()).toBe(200);

    const geminiRes = await api.get(`${MODELS_URL}?provider=gemini`);
    expect(geminiRes.status(), 'GET modelos de gemini').toBe(200);
    expectNoPlaintext(geminiRes, await geminiRes.text());
    // Two pages merged; embedding, TTS, image and non-gemini models are dropped.
    expect(await geminiRes.json()).toEqual({
      provider: 'gemini',
      models: [
        { id: 'gemini-flash-latest', label: 'Gemini Flash Latest' },
        { id: 'gemini-e2e-pro', label: 'Gemini E2E Pro' },
        { id: 'gemini-e2e-flash', label: 'Gemini E2E Flash' },
      ],
    });

    const routerRes = await api.get(`${MODELS_URL}?provider=openrouter`);
    expect(routerRes.status(), 'GET modelos de openrouter').toBe(200);
    expectNoPlaintext(routerRes, await routerRes.text());
    // Text-only, image output, no structured outputs, :batch and ~alias are dropped.
    expect(await routerRes.json()).toEqual({
      provider: 'openrouter',
      models: [
        { id: 'e2e/vision-flash', label: 'E2E: Vision Flash' },
        { id: 'xiaomi/mimo-v2.6-flash', label: 'Xiaomi: MiMo V2.6 Flash' },
      ],
    });
  });

  test('7. Un proveedor desconocido da 400 al listar modelos', async ({ context }) => {
    for (const query of ['', '?provider=openai']) {
      const res = await context.request.get(`${MODELS_URL}${query}`);
      expect(res.status(), `GET modelos ${query}`).toBe(400);
      expect((await res.json()).error).toBe('Proveedor no válido');
      expect(res.headers()['cache-control']).toContain('no-store');
    }
  });

  test('8. Solo administración puede listar modelos', async ({ request, newContext }) => {
    const anonymous = await request.get(`${MODELS_URL}?provider=openrouter`);
    expect(anonymous.status(), 'GET modelos anónimo').toBe(401);

    const seed = await seedScenario(request, 'couple-no-expenses');
    const userContext = await createAuthenticatedContext(newContext, {
      email: seed.userA!.email,
      password: seed.userA!.password,
    });
    const res = await userContext.request.get(`${MODELS_URL}?provider=openrouter`);
    expect(res.status(), 'GET modelos como no admin').toBe(403);
  });
});
