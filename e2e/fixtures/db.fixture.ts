import { APIRequestContext } from '@playwright/test';

export interface SeedUser {
  id?: string;
  email: string;
  password?: string;
  name?: string;
}

export interface SeedResult {
  inviteCode?: string;
  admin?: SeedUser;
  user?: SeedUser;
  userA?: SeedUser;
  userB?: SeedUser;
  [key: string]: unknown;
}

export async function seedScenario(request: APIRequestContext, scenario: string): Promise<SeedResult> {
  const res = await request.post('/api/test/seed', { data: { scenario } });
  if (!res.ok()) throw new Error(`Seed failed: ${await res.text()}`);
  return res.json();
}

export async function resetDb(request: APIRequestContext): Promise<void> {
  await request.post('/api/test/reset');
}
