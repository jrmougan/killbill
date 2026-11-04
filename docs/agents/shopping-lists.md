# Shopping lists (listas de la compra)

Read before touching lists, aisles or `/lists`. The hard rule is in `AGENTS.md`: a list never generates an expense.

## Model

- `ShoppingList` + `ShoppingListItem`. A list is **group** (`groupId`) or **personal** (`ownerId`), XOR discriminated.
- Items are lightweight: name required; optional `quantity`, `unit`, `note`, `aisle`. They carry **no `categoryId`**.
- `quantity` is a positive DOUBLE (≤ 100 000, ≤ 3 decimals: "1,5 kg"). `src/lib/list-quantity.ts` parses it for both the editor and the API (number or es-ES text) and never truncates or clears silently.

## A list is a planning tool only

- There is no list→expense bridge: no `checkoutList`, no `linkedExpenseId`, no `priceCents`, no `CheckoutSheet`.
- The spend is materialized by the receipt **OCR** (`/api/ocr` → `receipt-ocr-ai.ts`), the single source of truth for the money.
- The list tracks what is missing, who grabs it and in which aisle order, ticked off together in near-real-time.

## Code layout

- All validation, scope/XOR enforcement and sortOrder allocation live in `src/lib/list-crud.ts`. Reads are in `list-read.ts`, error mapping in `list-http.ts`. Routes own only authorization.
- The `checked` toggle is idempotent: condition-by-id `updateMany`, never read-modify-write.
- The client polls a cheap `…/[listId]/version` stamp and only calls `router.refresh()` when it changes.
- `requireListWriteAccess` in `list-http.ts` is an unused wrapper exercised only by its own test. Routes call `requireListWrite`.

## Aisles

- `aisle` (nullable) is an OPTIONAL per-item supermarket-aisle key, **orthogonal to the 8 expense categories**. It organizes the walk through the shop, does not classify spend and never touches the expense `CategoryPicker`.
- Its static vocabulary (slug, emoji, `sortOrder`, keywords) lives in `src/lib/aisles.ts`.
- `autoAssignAisle(name)` assigns best-effort from the item name: accent-folded keyword match, longest keyword wins, unmatched stays `null` (never forced to "otros").
- An explicit value is validated via `normalizeAisle`.

## Routes and authorization

- Space: `/api/spaces/[id]/lists/**`, authorized via `requireSpaceAccess` with `allowGuest:false`. Writes go through `requireListWrite` in `list-http.ts`.
- A list is planning, not spending, so it stays **editable while the space is SETTLING**. Only **ARCHIVED** blocks writes (409 `SPACE_NOT_WRITABLE`).
- Personal: `/api/me/lists/**`, session-scoped by `ownerId`; guest sessions get 403.
- Both have `…/[listId]/clear-checked`, which deletes the checked items to recycle the weekly list. An optional `{ ids }` body deletes only those (the ones the sheet showed); with no body, all checked items.
- `clear-checked` and item routes re-assert that the list belongs to the scope (`getListWithItems`/`loadListInScope`) after the space-access gate.

## UI

- `/lists` is the Listas tab and is proxy-protected. Server loader: `src/app/lists/load.ts`; client: `src/components/shopping/lists-hub.tsx`.
- One chip per list (Común first, then Personal, with the pending count); the selected list is the main view. `/lists` opens the first one, `/lists/[listId]` deep-links.
- Pending items are grouped by aisle; checked ones sit under "En el carro".
- Polling: about every 6 s, plus refresh on mount, focus, `pageshow` and visibility, so browser back never shows a stale cart.
- Adding a pending duplicate asks first ("Sumar 1" / "Añadir igualmente").
- ARCHIVED shows a read-only banner. In SETTLING, "Terminar" only empties the cart instead of opening the add-expense form.

## "Terminar y apuntar gasto"

A shortcut WITHOUT link; the product reason is in `docs/design/README.md`. It only:

1. Calls `…/[listId]/clear-checked`.
2. Navigates to `/expenses/new?title=<list name>&category=shopping&space=<groupId|personal>&returnTo=/lists/<listId>&scan=1`, built by `buildFinishExpenseUrl` in `src/components/shopping/finish-url.ts`. `shopping` is the seeded system category the OCR also uses for supermarket receipts.

The form is merely prefilled. The user still enters or scans the amount and saves it like any other expense. Nothing ties the list to the expense, and abandoning the form creates nothing.

## History

Expand/contract: migration `add_shopping_lists` created the tables; `remove_list_bridge_add_aisle` pruned the bridge and added `aisle`; `shopping_item_decimal_quantity` made quantity decimal.
