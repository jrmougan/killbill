import { APIRequestContext } from '@playwright/test';

export interface SeedUser {
  id?: string;
  email: string;
  password?: string;
  name?: string;
}

/** A registered user as returned by /api/test/seed (always id + shared password). */
export interface SeededUser extends SeedUser {
  id: string;
  password: string;
}

export interface SeedResult {
  inviteCode?: string;
  admin?: SeedUser;
  user?: SeededUser;
  userA?: SeededUser;
  userB?: SeededUser;
  [key: string]: unknown;
}

export async function seedScenario(request: APIRequestContext, scenario: string): Promise<SeedResult> {
  const res = await request.post('/api/test/seed', { data: { scenario } });
  if (!res.ok()) throw new Error(`Seed failed: ${await res.text()}`);
  return res.json();
}

export async function resetDb(request: APIRequestContext): Promise<void> {
  const res = await request.post('/api/test/reset');
  if (!res.ok()) throw new Error(`Reset failed: ${await res.text()}`);
}
