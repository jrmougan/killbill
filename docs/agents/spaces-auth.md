# Spaces, lifecycle, invites, guests and auth

Read before touching auth, invites, guests, space lifecycle, membership or `src/proxy.ts`. Core rules are in `AGENTS.md`.

## Space modes

A `Couple` row doubles as a **space**, with a `SpaceType` selected at creation and never inferred from member count. Caps and rules live in `src/lib/space-policy.ts`.

| Mode | Cap | Notes |
| --- | --- | --- |
| INDIVIDUAL | n/a | Virtual: no rows, `visibility=PERSONAL` + `ownerId` |
| COUPLE | 2 | Only allowed upgrade: COUPLE→GROUP |
| GROUP | 20 | |
| EPHEMERAL | 20 | Has `expiresAt`; the only mode allowing guests |

## Lifecycle

- `SpaceStatus`: `ACTIVE ⇄ SETTLING`, and either can go to `ARCHIVED` (`src/lib/space-policy.ts`). The closing checks in the PATCH handler still apply.
- Only `SETTLING` can be reopened (back to `ACTIVE`). `ARCHIVED` is terminal and read-only.
- `SETTLING` blocks new expenses but allows settling debts ("Saldar deuda"). The UI calls it "Cerrando cuentas".
- Spaces ARCHIVED for a long time are only removed by `/api/cron/purge`; see `docs/agents/deployment.md`.

## Authorization

- Membership and status are authorized **against the group of the resource**, not the `active_group` UI cookie, via `requireSpaceAccess` in `src/lib/authz.ts`. It re-checks the DB Membership row, not the JWT claim.
- `src/proxy.ts` is the request proxy (Next.js 16's rename of `middleware.ts`, Node.js runtime by default). It redirects or 401s anonymous requests on `PROTECTED_PATHS`, confines guests to the allowlist in `src/lib/authz-guest.ts` (deny-by-default), re-signs guest tokens and sets `Referrer-Policy` on `/i/*`. Other API routes authenticate themselves.

## Space lock

Every write whose validity depends on a space's status, roster or balances runs in `withSpaceLock` (`src/lib/expense-tx.ts`). That covers expenses including share and import, settlements, leave/kick, lifecycle and recurring materialization.

- It takes `SELECT … FOR UPDATE` on the `Couple` row first, at READ COMMITTED, and retries on deadlock.
- Under the lock it re-checks with `assertWritableUnderLock` / `assertRosterUnchanged` (409 `MEMBERS_CHANGED`).
- Kicking a member with an open balance is 409 `HAS_BALANCE`: settle first; there is no `force`.

## Invites

- `InviteCode` controls registration.
- `GroupInvite` replaces eternal `Couple.code` links. `Couple.code` is a legacy UNIQUE column and does not invite.
- Link tokens are 256-bit bearer secrets stored **only as sha256 hash** (`tokenHash` + `tokenPrefix`), with `expiresAt`, `maxUses` and `revokedAt`. The plaintext is shown once.
- Login and register never silently auto-join: `/i/[token]` is the explicit consent screen.

## Guests

- Shadow `User` with `isGuest=true` and Membership role `GUEST`.
- Short-lived `kind:'guest'` JWT: 72 h, sliding, hard-capped at the space `expiresAt`.
- `getSessionCtx` **revalidates it against the DB on every request** (revocation without a blacklist).
- The whole guest/ephemeral surface is gated behind `EPHEMERAL_SPACES_ENABLED` (`src/lib/flags.ts`), off by default. Turning it off never breaks already-upgraded accounts.

## Auth flow

1. Login: bcryptjs password check, then a JWT signed with `jose`, stored as an HttpOnly cookie.
2. The proxy verifies the JWT on every protected request.

`src/lib/auth.ts` manages the session and cookie; `src/lib/jwt.ts` signs and verifies tokens.

- Registered sessions are **not** refreshed per request: fixed 7 days from login. Only guest JWTs slide, in the proxy.
- Each JWT carries `tv` = `User.tokenVersion`. `getSession` rejects a stale `tv`, and `POST /api/me/sessions/revoke` bumps it ("cerrar sesión en todos los dispositivos"), which also kills MCP tokens.
- Route handlers (enforced by oxlint under `src/app/api/**`) and guest pages that read or write space data use `getSessionCtx`.
- Raw `getSession` remains only where a JWT-level read is enough (landing, `/i/[token]`, bottom nav, member-only pages the proxy already bars to guests). It does not revalidate guests against the DB.
- Login is rate-limited per IP **and** per email. The client IP is `X-Real-Ip` or the **last** `X-Forwarded-For` hop (`getClientIp`, assumes Traefik is the only ingress).
