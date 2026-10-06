import { test, expect } from '../fixtures/test.fixture';
import { seedScenario } from '../fixtures/db.fixture';
import { loginAs, createAuthenticatedContext } from '../fixtures/auth.fixture';

interface SeedUser {
  email: string;
  password?: string;
  id?: string;
}

interface InviteEdgeCasesResult {
  owner: SeedUser;
  member: SeedUser;
  outsider1: SeedUser;
  outsider2: SeedUser;
  coupleId: string;
  tokens: {
    valid: string;
    expired: string;
    revoked: string;
    exhausted: string;
  };
  inviteIds: {
    valid: string;
    expired: string;
    revoked: string;
    exhausted: string;
  };
}

test.describe('API Invites - Enlaces de invitación de espacio', () => {
  test('1. OWNER crea invite -> token devuelto una sola vez; preview pública -> 200; preview inexistente -> 404', async ({
    page,
    context,
    request,
  }) => {
    const seedData = (await seedScenario(request, 'invite-edge-cases')) as unknown as InviteEdgeCasesResult;
    await loginAs(page, { email: seedData.owner.email, password: seedData.owner.password! });
    const ownerApi = context.request;

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const createRes = await ownerApi.post(`/api/spaces/${seedData.coupleId}/invites`, {
      data: { expiresAt, maxUses: 3 },
    });
    expect(createRes.status(), 'OWNER crea invite exitosamente').toBe(200);
    const body = await createRes.json();

    expect(body.success).toBe(true);
    expect(typeof body.token).toBe('string');
    expect(body.token.length).toBeGreaterThan(20);
    expect(body.invite).toBeDefined();
    expect(body.invite.id).toBeTruthy();
    expect(body.invite.tokenPrefix).toBe(body.token.slice(0, 8));
    expect(body.invite.maxUses).toBe(3);
    expect(body.invite.usedCount).toBe(0);

    // Preview con token válido (pública, sin sesión) -> 200 con metadata del espacio
    const previewRes = await request.get(`/api/invites/${body.token}/preview`);
    expect(previewRes.status(), 'preview con token válido').toBe(200);
    const preview = await previewRes.json();
    expect(preview.valid).toBe(true);
    expect(preview.kind).toBe('MEMBER');
    expect(preview.space).toBeDefined();
    expect(preview.space.name).toBe('Invite Edge Cases Group');
    expect(preview.space.type).toBe('GROUP');

    // Preview con token inventado (pública) -> 404 NOT_FOUND
    const fakeRes = await request.get('/api/invites/token-totalmente-inventado-que-no-existe/preview');
    expect(fakeRes.status(), 'preview token inventado debe devolver 404').toBe(404);
    const fakeBody = await fakeRes.json();
    expect(fakeBody.valid).toBe(false);
    expect(fakeBody.reason).toBe('NOT_FOUND');
  });

  test('2. Claim explícito: segundo usuario registrado hace claim -> queda Membership; sin claim no hay Membership (no auto-join)', async ({
    page,
    context,
    newContext,
    request,
  }) => {
    const seedData = (await seedScenario(request, 'invite-edge-cases')) as unknown as InviteEdgeCasesResult;

    // OWNER crea un invite nuevo
    await loginAs(page, { email: seedData.owner.email, password: seedData.owner.password! });
    const ownerApi = context.request;

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const createRes = await ownerApi.post(`/api/spaces/${seedData.coupleId}/invites`, {
      data: { expiresAt, maxUses: 2 },
    });
    expect(createRes.status()).toBe(200);
    const { token } = await createRes.json();

    // Segundo usuario registrado (outsider1)
    const outsiderCtx = await createAuthenticatedContext(newContext, {
      email: seedData.outsider1.email,
      password: seedData.outsider1.password!,
    });
    const outsiderApi = outsiderCtx.request;

    try {
      // 1. Verificar que inicialmente NO pertenece al espacio
      const spacesBeforeRes = await outsiderApi.get('/api/spaces');
      expect(spacesBeforeRes.ok()).toBeTruthy();
      const { spaces: spacesBefore } = await spacesBeforeRes.json();
      expect(
        spacesBefore.some((s: { id: string }) => s.id === seedData.coupleId),
        'no debe ser miembro antes del claim',
      ).toBe(false);

      // 2. Visitar la preview pública NO debe auto-unir al usuario (consent screen)
      const previewRes = await outsiderApi.get(`/api/invites/${token}/preview`);
      expect(previewRes.status()).toBe(200);

      const spacesAfterPreviewRes = await outsiderApi.get('/api/spaces');
      expect(spacesAfterPreviewRes.ok()).toBeTruthy();
      const { spaces: spacesAfterPreview } = await spacesAfterPreviewRes.json();
      expect(
        spacesAfterPreview.some((s: { id: string }) => s.id === seedData.coupleId),
        'preview no debe realizar auto-join',
      ).toBe(false);

      // 3. Claim explícito vía POST /api/invites/claim
      const claimRes = await outsiderApi.post('/api/invites/claim', { data: { token } });
      expect(claimRes.status(), 'claim explícito exitoso').toBe(200);
      const claimBody = await claimRes.json();
      expect(claimBody.success).toBe(true);
      expect(claimBody.groupId).toBe(seedData.coupleId);
      expect(claimBody.alreadyMember).toBe(false);

      // 4. Ahora sí queda Membership con rol MEMBER
      const spacesAfterClaimRes = await outsiderApi.get('/api/spaces');
      expect(spacesAfterClaimRes.ok()).toBeTruthy();
      const { spaces: spacesAfterClaim } = await spacesAfterClaimRes.json();
      const membership = spacesAfterClaim.find((s: { id: string }) => s.id === seedData.coupleId);
      expect(membership, 'debe aparecer en la lista de espacios tras el claim').toBeDefined();
      expect(membership.role).toBe('MEMBER');
    } finally {
      await outsiderCtx.close();
    }
  });

  test('3. maxUses: invite con maxUses=1 -> segundo claim retorna error 4xx (EXHAUSTED)', async ({
    page,
    context,
    newContext,
    request,
  }) => {
    const seedData = (await seedScenario(request, 'invite-edge-cases')) as unknown as InviteEdgeCasesResult;

    // OWNER crea invite de un único uso (maxUses = 1)
    await loginAs(page, { email: seedData.owner.email, password: seedData.owner.password! });
    const ownerApi = context.request;

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const createRes = await ownerApi.post(`/api/spaces/${seedData.coupleId}/invites`, {
      data: { expiresAt, maxUses: 1 },
    });
    expect(createRes.status()).toBe(200);
    const { token } = await createRes.json();

    const outsider1Ctx = await createAuthenticatedContext(newContext, {
      email: seedData.outsider1.email,
      password: seedData.outsider1.password!,
    });
    const outsider1Api = outsider1Ctx.request;

    const outsider2Ctx = await createAuthenticatedContext(newContext, {
      email: seedData.outsider2.email,
      password: seedData.outsider2.password!,
    });
    const outsider2Api = outsider2Ctx.request;

    try {
      // Primer claim por outsider1 -> 200 éxito
      const claim1Res = await outsider1Api.post('/api/invites/claim', { data: { token } });
      expect(claim1Res.status(), 'primer claim con maxUses=1 debe ser 200').toBe(200);
      expect((await claim1Res.json()).success).toBe(true);

      // Segundo claim por outsider2 -> error 400 (4xx) por estar agotado
      const claim2Res = await outsider2Api.post('/api/invites/claim', { data: { token } });
      expect(claim2Res.status(), 'segundo claim debe retornar 400').toBe(400);
      const errBody = await claim2Res.json();
      expect(errBody.code).toBe('EXHAUSTED');
    } finally {
      await outsider1Ctx.close();
      await outsider2Ctx.close();
    }
  });

  test('4. Token revocado: OWNER revoca invite via DELETE -> claim y preview fallan', async ({
    page,
    context,
    newContext,
    request,
  }) => {
    const seedData = (await seedScenario(request, 'invite-edge-cases')) as unknown as InviteEdgeCasesResult;

    // OWNER crea invite
    await loginAs(page, { email: seedData.owner.email, password: seedData.owner.password! });
    const ownerApi = context.request;

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const createRes = await ownerApi.post(`/api/spaces/${seedData.coupleId}/invites`, {
      data: { expiresAt, maxUses: 5 },
    });
    expect(createRes.status()).toBe(200);
    const { token, invite } = await createRes.json();

    // Revocar via endpoint DELETE /api/spaces/[id]/invites?inviteId=...
    const revokeRes = await ownerApi.delete(`/api/spaces/${seedData.coupleId}/invites?inviteId=${invite.id}`);
    expect(revokeRes.status(), 'revocación de invite').toBe(200);
    const revokeBody = await revokeRes.json();
    expect(revokeBody.success).toBe(true);

    // Preview sobre token revocado -> valid: false, reason: REVOKED
    const previewRes = await request.get(`/api/invites/${token}/preview`);
    expect(previewRes.status()).toBe(200);
    const previewBody = await previewRes.json();
    expect(previewBody.valid).toBe(false);
    expect(previewBody.reason).toBe('REVOKED');

    // Claim sobre token revocado -> 400 con code REVOKED
    const outsiderCtx = await createAuthenticatedContext(newContext, {
      email: seedData.outsider1.email,
      password: seedData.outsider1.password!,
    });
    const outsiderApi = outsiderCtx.request;

    try {
      const claimRes = await outsiderApi.post('/api/invites/claim', { data: { token } });
      expect(claimRes.status(), 'claim sobre token revocado debe ser 400').toBe(400);
      const claimBody = await claimRes.json();
      expect(claimBody.code).toBe('REVOKED');
    } finally {
      await outsiderCtx.close();
    }
  });

  test('5. Token expirado: invite con expiresAt pasado -> preview y claim fallan con EXPIRED', async ({
    newContext,
    request,
  }) => {
    const seedData = (await seedScenario(request, 'invite-edge-cases')) as unknown as InviteEdgeCasesResult;
    const expiredToken = seedData.tokens.expired;
    expect(expiredToken).toBeTruthy();

    // Preview sobre token expirado -> valid: false, reason: EXPIRED
    const previewRes = await request.get(`/api/invites/${expiredToken}/preview`);
    expect(previewRes.status()).toBe(200);
    const previewBody = await previewRes.json();
    expect(previewBody.valid).toBe(false);
    expect(previewBody.reason).toBe('EXPIRED');

    // Claim sobre token expirado -> 400 con code EXPIRED
    const outsiderCtx = await createAuthenticatedContext(newContext, {
      email: seedData.outsider1.email,
      password: seedData.outsider1.password!,
    });
    const outsiderApi = outsiderCtx.request;

    try {
      const claimRes = await outsiderApi.post('/api/invites/claim', { data: { token: expiredToken } });
      expect(claimRes.status(), 'claim sobre token expirado debe fallar con 400').toBe(400);
      const claimBody = await claimRes.json();
      expect(claimBody.code).toBe('EXPIRED');
    } finally {
      await outsiderCtx.close();
    }
  });

  test('6. Un MEMBER (no OWNER/ADMIN) intentando crear invites -> 403', async ({
    page,
    context,
    request,
  }) => {
    const seedData = (await seedScenario(request, 'invite-edge-cases')) as unknown as InviteEdgeCasesResult;

    // Iniciar sesión como miembro ordinario (rol MEMBER, no OWNER/ADMIN)
    await loginAs(page, { email: seedData.member.email, password: seedData.member.password! });
    const memberApi = context.request;

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const createRes = await memberApi.post(`/api/spaces/${seedData.coupleId}/invites`, {
      data: { expiresAt, maxUses: 1 },
    });
    expect(createRes.status(), 'MEMBER intentando crear invite debe recibir 403').toBe(403);
    const body = await createRes.json();
    // Las denegaciones por rol de requireSpaceAccess devuelven { error } sin code
    expect(body.error).toBe('No tienes permisos para esta acción');
  });

  test('7. El código corto legacy (Couple.code) ya no es una invitación: ni une ni revela el nombre', async ({
    newContext,
    request,
  }) => {
    const seed = await seedScenario(request, 'couple-with-debt');
    const userA = await createAuthenticatedContext(newContext, seed.userA as { email: string; password: string });
    // /api/couple no longer exposes the legacy code; the gated seed route returns it.
    const couple = await userA.request.get('/api/couple');
    expect(couple.ok()).toBeTruthy();
    expect((await couple.json()).couple).not.toHaveProperty('code');
    const { coupleCode: code, coupleName: name } = seed as unknown as { coupleCode: string; coupleName: string };
    expect(code).toMatch(/^[0-9A-Z]+$/);

    const outsiderSeed = await seedScenario(request, 'solo-user');
    const outsider = await createAuthenticatedContext(newContext, outsiderSeed.user as { email: string; password: string });
    const claim = await outsider.request.post('/api/invites/claim', { data: { token: code } });
    expect(claim.status()).toBe(404);
    expect((await outsider.request.post('/api/couple/join', { data: { code } })).status()).toBe(404);
    expect((await outsider.request.get(`/api/invites/${code.toLowerCase()}/preview`)).status()).toBe(404);

    const page = await (await newContext()).newPage();
    await page.goto(`/i/${code.toLowerCase()}`);
    await expect(page.getByRole('heading', { name: 'Este enlace no funciona' })).toBeVisible();
    await expect(page.locator('body')).not.toContainText(name);
    await userA.close();
    await outsider.close();
  });
});
