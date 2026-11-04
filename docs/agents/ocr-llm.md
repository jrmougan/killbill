# OCR, uploads and LLM settings

Read before touching receipts, `/api/ocr`, `/api/upload`, `/admin/ai` or LLM keys.

## Environment

LLM keys and models can also be set at `/admin/ai`; the DB value wins, and clearing it falls back to these variables.

- `GEMINI_API_KEY`: primary provider for OCR receipt parsing.
- `OPENROUTER_API_KEY`: optional fallback when Gemini fails or returns invalid output.
- `OPENROUTER_OCR_MODEL`: optional fallback model override (default `xiaomi/mimo-v2.6-flash`).
- `AI_SETTINGS_ENCRYPTION_KEY`: optional secret for the API keys stored in the DB; falls back to `JWT_SECRET`.
- `UPLOAD_DIR`: upload storage dir (default `<cwd>/uploads`; `/app/uploads` in Docker). Never under `public/`.
- `OCR_TEST_PROVIDER_URL`: test seam; see `docs/agents/testing.md`.

OCR needs at least one provider key, from the env or `/admin/ai`. Configure both providers to enable failover.

## Flows

**Scan.** The image goes as multipart field `image` to `/api/ocr`, and nothing is stored.

1. The route validates type, size and magic bytes, base64-encodes the bytes and calls `analyzeReceiptImage`.
2. Gemini Vision returns structured JSON (items + amounts). Provider calls and response validation live in `receipt-ocr-ai.ts`.
3. An API, empty-response or invalid-JSON failure falls back to OpenRouter when an OpenRouter key is configured.
4. The user confirms the structured JSON before saving.

**Save.** When the expense is saved, the file is stored via `/api/upload` and its URL is saved as `Expense.receiptUrl`.

- `/api/upload` requires a session, has a per-user rate limit and checks PNG/JPEG/WEBP magic bytes.
- Files go to `UPLOAD_DIR` (paths in `src/lib/uploads.ts`), outside `public/`, which Next would serve statically without auth.
- They are read back only through the session-gated `src/app/uploads/[filename]/route.ts`. Legacy `public/uploads` is still read until migrated.
- In production, uploads live on a persistent volume mounted at `/app/uploads`.

`src/lib/ocr_parser.ts` is an unused legacy text parser, exercised only by its own test. Do not wire it in.

## LLM settings

Instance admins set keys and models at `/admin/ai` (`GET`/`PATCH /api/admin/ai-settings`, `auth: 'admin'`). `AiProviderConfig` holds one row per `AiProvider` with the instance-wide encrypted key and model.

`getAiRuntimeConfig` (`ai-settings.ts`) resolves them on every OCR call, uncached, per provider:

| Setting | Order |
| --- | --- |
| Key | DB > env > none |
| Model | DB > env (`OPENROUTER_OCR_MODEL`; Gemini has none) > `DEFAULT_MODELS` |

- Keys are stored with `secret-box.ts` (AES-256-GCM), bound to the provider through the AAD.
- The plaintext never leaves the server: responses and pages expose only source + last-4 hint (`AiSettingsView`).

## Failure modes

- A stored key that cannot be decrypted (secret rotated) or a failed DB read logs a warning and falls back to env instead of crashing. OCR keeps working only if the env has a key; otherwise `/api/ocr` fails as with no provider configured.
- The undecryptable case also sets `keyUndecryptable` in the view.
- While `OCR_TEST_PROVIDER_URL` is active the DB is not read, so a stored key can never reach the loopback server.

## Secret rotation

Rotating whichever secret is in use (`AI_SETTINGS_ENCRYPTION_KEY`, or `JWT_SECRET` when that is unset) means re-entering the stored keys. Runbook for operators: `README.md`, "Claves y modelos de IA (OCR)".
