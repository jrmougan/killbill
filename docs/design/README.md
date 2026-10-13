# EQUIL Prototipo (claude.ai/design)

`EQUIL Prototipo.dc.html` is the source prototype for the EQUIL redesign
(project `a458c65f-b975-4c3e-bfb0-981943f748db`). It is a reference only — it
needs the design runtime (`support.js`) to render and is not shipped.

## Product decisions taken when implementing it

The prototype contradicts some existing product rules. These are the resolutions:

- **Lists → expense**: "Terminar y apuntar gasto" is a *shortcut without link*:
  it clears the checked items (`clear-checked`) and opens the add-expense flow
  prefilled with the list name as concept. No `linkedExpenseId`, no prices —
  the money still comes from OCR / manual entry.
- **Invites**: no short codes. The "Invitar" card creates and shares a secure
  `/i/[token]` link (Web Share API / copy); "Unirme" accepts a pasted link.
- **Settle**: two-step confirmation is kept. "Ya he pagado" creates a PENDING
  settlement ("Pendiente de que X confirme"); "Ya me ha pagado" (creditor)
  confirms immediately. "Recordárselo" uses the share sheet (no push infra).
- **Add expense**: the numpad quick flow (equal / only me / only them) is the
  default; "Más opciones" exposes custom splits, tags, date and recurrence.
- **Spaces**: Pareja→COUPLE, Piso→GROUP, Viaje→EPHEMERAL (only when
  `EPHEMERAL_SPACES_ENABLED`, otherwise GROUP), Solo yo→INDIVIDUAL.
- **Budgets**: tapping an unbudgeted category asks for the amount (the
  prototype's fixed 100 € is a demo shortcut).
- **MCP ("Agentes IA (MCP)")**: the prototype's single Hermes "Conectar" became a
  generic "Tokens de acceso" list: named opaque tokens for any MCP client, with
  30/90/365-day or no expiry, shown once, each revocable individually (and all
  at once by "Cerrar sesión en todos los dispositivos").
- **Shopping aisles** are kept (grouping/ordering) even though the prototype
  shows a flat list.
