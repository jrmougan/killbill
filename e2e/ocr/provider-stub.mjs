import { createServer } from 'node:http';

export const receipt = {
  store: 'Tienda E2E',
  category: 'shopping',
  items: [
    { description: 'Pan', quantity: 1, price: 3.4, total: 3.4 },
    { description: 'Cafe', quantity: 1, price: 2.15, total: 2.15 },
    { description: 'Leche', quantity: 1, price: 1.2, total: 1.2 },
  ],
  total: 6.75,
};

// Model listings served to /api/admin/ai-settings/models. Each list carries one
// model the vision filter must keep and several it must drop.
export const geminiModelPages = {
  '': {
    models: [
      { name: 'models/gemini-e2e-flash', displayName: 'Gemini E2E Flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
      { name: 'models/gemini-embedding-001', displayName: 'Gemini Embedding', supportedGenerationMethods: ['embedContent'] },
      { name: 'models/gemini-e2e-flash-tts', displayName: 'Gemini E2E TTS', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-e2e-flash-image', displayName: 'Gemini E2E Image', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemma-e2e', displayName: 'Gemma E2E', supportedGenerationMethods: ['generateContent'] },
    ],
    nextPageToken: 'page-2',
  },
  'page-2': {
    models: [
      { name: 'models/gemini-flash-latest', displayName: 'Gemini Flash Latest', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-e2e-pro', displayName: 'Gemini E2E Pro', supportedGenerationMethods: ['generateContent'] },
    ],
  },
};

const chat = '/api/v1/chat/completions';
const openRouterModel = (id, name, over = {}) => ({
  id,
  name,
  architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
  supported_parameters: ['structured_outputs', 'temperature'],
  endpoints: [chat],
  ...over,
});

export const openRouterModels = {
  data: [
    openRouterModel('e2e/vision-flash', 'E2E: Vision Flash'),
    openRouterModel('xiaomi/mimo-v2.6-flash', 'Xiaomi: MiMo V2.6 Flash'),
    openRouterModel('e2e/text-only', 'E2E: Text Only', { architecture: { input_modalities: ['text'], output_modalities: ['text'] } }),
    openRouterModel('e2e/image-maker', 'E2E: Image Maker', { architecture: { input_modalities: ['text', 'image'], output_modalities: ['image', 'text'] } }),
    openRouterModel('e2e/no-schema', 'E2E: No Schema', { supported_parameters: ['temperature'] }),
    openRouterModel('e2e/vision-flash:batch', 'E2E: Vision Flash (batch)'),
    openRouterModel('~e2e/vision-latest', 'E2E: Vision Alias'),
  ],
  total_count: 7,
  links: { next: null },
};

function modelListing(request, url) {
  if (url.pathname === '/gemini/models') {
    // Same answer as Google for a wrong key: 400, not 401.
    if (request.headers['x-goog-api-key'] !== 'ocr-e2e-fake') {
      return [400, { error: { code: 400, status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } }];
    }
    const page = geminiModelPages[url.searchParams.get('pageToken') ?? ''];
    return page ? [200, page] : [400, { error: { code: 400, status: 'INVALID_ARGUMENT' } }];
  }
  if (url.pathname === '/openrouter/models') {
    // The app lists OpenRouter without credentials: a key here would be a leak.
    if (request.headers.authorization) return [400, { error: { code: 400, message: 'Unexpected credentials' } }];
    return [200, openRouterModels];
  }
  return null;
}

// Only Gemini-compatible provider HTTP is substituted. OCR auth, image validation,
// response parsing, upload and expense persistence remain in the real app.
export function createProviderStub() {
  return createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'GET') {
      const listing = modelListing(request, new URL(request.url, 'http://127.0.0.1'));
      if (listing) {
        response.writeHead(listing[0]).end(JSON.stringify(listing[1]));
        return;
      }
    }
    if (request.method !== 'POST' || !['/gemini', '/openrouter'].includes(request.url)) {
      response.writeHead(404).end('{}');
      return;
    }
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const image = request.url === '/gemini'
        ? body.contents?.[0]?.parts?.[1]?.inline_data
        : null;
      // This fixture intentionally requires the real image and Gemini schema.
      if (!image || image.mime_type !== 'image/png' ||
          !Buffer.from(image.data, 'base64').subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ||
          body.generationConfig?.responseMimeType !== 'application/json') {
        response.writeHead(400).end(JSON.stringify({ error: 'Unexpected provider request' }));
        return;
      }
      response.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(receipt) }] } }] }));
    } catch {
      response.writeHead(400).end(JSON.stringify({ error: 'Invalid provider request' }));
    }
  });
}
