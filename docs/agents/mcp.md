# MCP server (Model Context Protocol)

Read before touching `src/mcp/**` or `src/app/api/mcp/`. The app exposes an MCP endpoint at `POST /api/mcp` (Streamable HTTP) so external AI agents (Hermes Agent, Claude Desktop…) can use Kill Bill programmatically.

## Architecture

- Served by the existing Next.js standalone process: no second process, no Docker changes.
- **Auth**: `Authorization: Bearer <jwt>`, validated in `src/lib/mcp-auth.ts` (`validateBearerToken`). Only tokens with `kind:'mcp'` are accepted; browser-session and guest JWTs get 401, even though they share `JWT_SECRET`.
- **Stateless**: every POST builds a fresh `McpServer` (`src/mcp/server.ts`, `createServer`) and transport bound to that request's bearer, and tears them down after responding. There is no session map and `Mcp-Session-Id` is ignored. GET/DELETE → 405 (401 without a valid bearer).
- **Transport**: `WebStandardStreamableHTTPServerTransport` (Web-standard `Request`/`Response`, native to route handlers).
- **Reuse**: each server wraps the raw JWT in an `InternalApiClient` (`src/mcp/internal-client.ts`), which injects it as the `session_token` cookie on internal HTTP calls to the existing API routes. Every tool therefore reuses the full authorization stack (`requireSpaceAccess`, role gates, space policy) with no duplication.
- MCP tokens carry `tv`, so revoking sessions invalidates them; see `docs/agents/spaces-auth.md`. `auth:'admin'` routes reject MCP tokens.

## Token issuance

`POST /api/me/mcp-token` (requires normal session cookie auth) issues a 90-day JWT with `kind:'mcp'` (`signMcpToken` in `jwt.ts`). TTL: `MCP_TOKEN_TTL_DAYS`.

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

Hermes Agent, `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  killbill:
    url: "https://finanzas.mougan.es/api/mcp"
    headers:
      Authorization: "Bearer <jwt from POST /api/me/mcp-token>"
```
