# MCP server (Model Context Protocol)

Read before touching `src/mcp/**` or `src/app/api/mcp/`. The app exposes an MCP endpoint at `POST /api/mcp` (Streamable HTTP) so external AI agents (Hermes Agent, Claude Desktop…) can use Kill Bill programmatically.

## Architecture

- Served by the existing Next.js standalone process: no second process, no Docker changes.
- **Auth**: `Authorization: Bearer <credential>`, validated on every request in `src/lib/mcp-auth.ts` (`validateBearerToken`), which picks the branch by format:
  - `kb_…` is an opaque access token, resolved by `resolveAccessToken` (`src/lib/access-tokens.ts`). A malformed `kb_…` is a 401 and is never tried as a JWT.
  - Anything else is the legacy 90-day JWT. Only `kind:'mcp'` is accepted; browser-session and guest JWTs get 401, even though they share `JWT_SECRET`.
- **Stateless**: every POST builds a fresh `McpServer` (`src/mcp/server.ts`, `createServer`) and transport bound to that request's bearer, and tears them down after responding. There is no session map and `Mcp-Session-Id` is ignored. GET/DELETE → 405 (401 without a valid bearer).
- **Transport**: `WebStandardStreamableHTTPServerTransport` (Web-standard `Request`/`Response`, native to route handlers).
- **Reuse**: each server wraps a `kind:'mcp'` JWT in an `InternalApiClient` (`src/mcp/internal-client.ts`), which injects it as the `session_token` cookie on internal HTTP calls to the existing API routes. Every tool therefore reuses the full authorization stack (`requireSpaceAccess`, role gates, space policy) with no duplication. With the legacy 90-day JWT that cookie is the caller's own token; with an opaque token the route mints a 5-minute internal JWT per request (`signInternalMcpToken`, claims `tv` + `tid` = the `AccessToken` id), so the opaque token is never forwarded and never works as a cookie. The internal JWT is rejected as a Bearer.
- `auth:'admin'` routes reject MCP sessions, and so do the token routes below: a token cannot list, mint or revoke tokens.

## Credentials

The app issues only access tokens. The legacy 90-day JWT is no longer issued (since #60) but the ones already out there are still accepted as Bearer until they expire; do not remove that branch of `mcp-auth.ts` until its retirement (#61).

| | Access token (`kb_…`) | Legacy 90-day JWT |
| --- | --- | --- |
| Issued by | `POST /api/me/tokens` `{ name, expiresInDays: 30 \| 90 \| 365 \| null }`, and `POST /api/me/mcp-token` (Hermes, below) | Nobody since #60 (`signMcpToken`; e2e mints it with `POST /api/test/legacy-mcp-jwt`) |
| UI (Ajustes → Conexiones) | "Tokens de acceso" (`src/components/settings/access-tokens.tsx`) and "Hermes Agent" → "Conectar" | None |
| Stored | `AccessToken` row: sha256 (`tokenHash`) and a visible prefix; plaintext shown once | Nothing (stateless) |
| Revoke one | `DELETE /api/me/tokens/[id]` (`revokedAt`) | Not possible |
| Revoke all | `bumpTokenVersion` sets `revokedAt` on every active row, in the transaction that bumps `tv` | Stale `tv`; see `docs/agents/spaces-auth.md` |

- **"Conectar Hermes Agent"** calls `POST /api/me/mcp-token`, which creates an access token named «Hermes Agent» expiring in 90 days (`HERMES_TOKEN_NAME`/`HERMES_TOKEN_DAYS`, fixed; `MCP_TOKEN_TTL_DAYS` is no longer read) through `replaceNamedAccessToken`: the new token is created first and then every other active token of the caller named «Hermes Agent» is revoked, so reconnecting never leaves orphans (`replaced` in the response counts them). The name is the only link, so a token the user named «Hermes Agent» by hand is replaced too. The response keeps the historical `{ token, expiresInDays, expiresAt }` plus the token summary. It shares the creation rate limit and the 20-token cap (409 `TOKEN_LIMIT`, nothing revoked) with `POST /api/me/tokens`.
- All three token routes and `POST /api/me/mcp-token` require a regular browser session: guests and MCP sessions get 403.
- `GET /api/me/tokens` lists every token of the caller with its status (`active`, `expired`, `revoked`), never the plaintext.
- Limits: 20 active tokens per user (409 `TOKEN_LIMIT`) and 10 creations per hour. `lastUsedAt` is written at most once per hour, fire-and-forget.
- `AccessTokenError` is a domain error registered in `DOMAIN_ERROR_NAMES` (`src/lib/http/errors.ts`).

## Tools

Registrars (`ToolRegistrar` functions) live in `src/mcp/tools/` plus `src/mcp/resources-prompts.ts`, and are wired in the `registrars` array in `src/mcp/server.ts`. Inputs are validated with Zod (raw shapes, not `z.object()`), and `inputSchema` fields use `.describe()` for agent UX. Outputs are JSON content blocks. `src/mcp/server.ts` registers `ping` inline.

- `tools/finance.ts`: `list_spaces`, `get_balance`, `list_expenses`, `get_expense_receipt_breakdown`, `create_expense`, `update_expense`, `delete_expense`, `create_settlement`, `confirm_settlement`.
  - Monetary inputs are euros (floats); `customSplits` amounts are converted to cents via `toCents` before posting to the API.
  - `get_expense_receipt_breakdown` is read-only and its monetary output is in cents.
- `tools/budget-shopping.ts`: `get_budgets`, `get_categories`, `list_shopping_lists`, `create_shopping_list`, `add_shopping_item`, `check_shopping_item`, `clear_checked_items`. Space or personal routing depends on whether `groupId` is provided.
- `tools/ocr.ts`: `parse_receipt` accepts base64 image data and forwards it to `/api/ocr` as a multipart form.
- `resources-prompts.ts`: resources `kb://spaces`, `kb://budget-summary`; prompts `monthly_report`, `settle_up_guide`, `shopping_trip`.

## Adding a tool, or changing a route behind one

A route or vocabulary change must be carried to the tools by hand. Nothing fails when they drift, because the tests in `src/mcp` do not assert description text.

- When a route's semantics change, update the matching tool's inputs and description in the same change (008cebc: `create_settlement` still allowed 0 € and `confirm_settlement` needed `expectedAmount`).
- Tool descriptions and prompts use the final glossary (e6c4843); see `docs/ux/plan-acciones-criticas.md` §1.
- Test through `e2e/api/mcp.spec.ts`. Do not point a coding agent at production's `/api/mcp`: it holds real financial data and has write tools.

## Client config

Any client that takes the common `mcpServers` JSON (the token sheet shows this filled in):

```json
{
  "mcpServers": {
    "killbill": {
      "url": "https://finanzas.mougan.es/api/mcp",
      "headers": { "Authorization": "Bearer kb_<token from Ajustes → Tokens de acceso>" }
    }
  }
}
```

Hermes Agent, `~/.hermes/config.yaml` (the "Conectar" sheet shows this filled in; a legacy JWT already configured keeps working until it expires):

```yaml
mcp_servers:
  killbill:
    url: "https://finanzas.mougan.es/api/mcp"
    headers:
      Authorization: "Bearer kb_<token from Ajustes → Conexiones → Hermes Agent → Conectar>"
```
