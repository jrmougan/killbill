# UI patterns

Read before touching screens, components, layout or refresh behaviour. Product decisions: `docs/design/README.md`. Copy: glossary in `docs/ux/plan-acciones-criticas.md` §1.

## Components

- `src/components/` is grouped by feature: `auth`, `category`, `dashboard`, `expense`, `expenses`, `guest`, `month`, `nav`, `settle`, `shopping`, `space`, `ui`.
- EQUIL primitives (`EqCard`, `EqRow`, `EqLabel`, `EqHeader`, `EqChip`, `EqEmpty`…) are in `src/components/ui/eq.tsx`. Empty states use `EqEmpty` with `title`, `hint` and `action` + `href`/`onClick`.
- Space emoji: `SPACE_TYPE_META` (`src/lib/space-ui.ts`) is the only source.

## Critical actions and toasts

- Confirmations use `CriticalActionSheet` (`src/components/ui/critical-action-sheet.tsx`) with facts, consequences and `reversible`. Never `window.confirm`. Pattern: `docs/ux/plan-acciones-criticas.md` §2.
- `tone="danger"` is an alertdialog with focus on Cancelar. `busy` is `aria-disabled`, not `disabled`.
- Toast with action: `const [t, show, action] = useEqToast()` + `<EqToast action={action}>`.
- Notice after navigating: `setFlashToast(msg, {label, href})` before `router.push` (`src/components/ui/flash-toast.tsx`).

## Tokens and type

- Colors render inline from `hex`; never build tailwind classes at runtime.
- Red text on `--negative-tint`: use `--negative-ink` (`--negative`/`text-destructive` do not reach 4.5:1 there).
- Grey text: `--ink-2`/`muted-foreground` and `--ink-3` pass 4.5:1 on paper, white, `--track` and tints. `--placeholder` and `--ink-4` are never for text.
- Type: Schibsted everywhere, figures included. `font-mono` (DM Mono) only for codes, links, tokens and the ticket meta.

## Touch targets

44 px without changing the look: a transparent `min-h-11 flex items-center` button with the pill in a child `<span>` (`group-focus-visible:ring-2` for focus). `EqChip` does this with `touch`. Text links in headers: `-my-2.5 min-h-11 flex items-center`.

## Mobile layout

- The root `<main>` is `overflow-hidden` (`src/app/layout.tsx`), so overflow is **clipped silently**. Do not nest another `<main>`; use `<div>`.
- A `max-w-md mx-auto` container without `w-full` takes its content's width in the flex layout column.
- Use `min-h`, not fixed heights, on cards. Long words need to wrap or truncate; fixed big amounts should use `clamp()`.
- `src/app/globals.css` has an unlayered 16 px floor for form controls on phones (iOS zoom), which beats `text-sm`. A larger control must use a `text-[NNpx]` form from 17 px up, `text-lg` upwards, or an inline style.
- `e2e/mobile/overflow.spec.ts` routes run at 320 and 393 px. Playwright has no webkit project and iOS zoom does not reproduce on Linux, so state that it is unverified on a real iPhone.

## Adding a screen

1. A new top-level page is public until its prefix is added to `PROTECTED_PATHS` (`src/proxy.ts`). Guests need an explicit entry in `src/lib/authz-guest.ts`.
2. Tab pages render the bottom nav from their own `layout.tsx` with `pb-28`. The root layout must not read the session, or every route turns dynamic.
3. Add the screen to `e2e/mobile/overflow.spec.ts`.

## Refresh races

`router.refresh()` races with polling and server-rendered lists.

- An earlier refresh can arrive after an optimistic update and undo it. Keep in-flight toggles over server renders until confirmed, failed or timed out (4818a7d, `lists-hub.tsx`).
- A component the server stops painting after a refresh loses its toast. Mount toasts in a stable slot (`PendingSettlements` stays mounted for this reason).
- A sheet must keep the object it is reviewing in state, not read it from props that a refresh can empty.
- Guard against stale responses when a newer request is in flight.

## Hook

`useApiMutation` in `src/hooks/` handles fetch, error and `router.refresh` over `apiRequest`.
