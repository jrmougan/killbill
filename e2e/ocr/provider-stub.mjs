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

// Only Gemini-compatible provider HTTP is substituted. OCR auth, image validation,
// response parsing, upload and expense persistence remain in the real app.
export function createProviderStub() {
  return createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
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
