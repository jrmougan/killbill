import { APIRequestContext } from '@playwright/test';

export async function seedScenario(request: APIRequestContext, scenario: string): Promise<any> {
  const res = await request.post('/api/test/seed', { data: { scenario } });
  if (!res.ok()) throw new Error(`Seed failed: ${await res.text()}`);
  return res.json();
}

export async function resetDb(request: APIRequestContext): Promise<void> {
  await request.post('/api/test/reset');
}
