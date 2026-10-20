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
- **Settle** ("Saldar deuda"): two-step confirmation is kept. A headline says
  who owes whom ("Lucía te debe 79,30 €" / "Le debes 79,30 € a Álvaro"; in a
  group "Debes 7,50 € en total" + "Le pagas 7,50 € a Marta"), and the CTAs carry
  the person and the amount of the chosen transfer. "Ya le he pagado {importe}
  a {nombre}" creates a PENDING settlement ("Pendiente de que X confirme");
  "{nombre} ya me ha pagado {importe}" (creditor) confirms immediately, and an
  incoming pending one is confirmed with "Sí, he recibido {importe} de {nombre}". Reminders use the share sheet (no
  push infra): "Recordarle la deuda" is creditor-only, and the debtor of a
  pending payment gets "Pedirle que lo confirme" instead. "Deuda saldada" is
  shown only right after a confirmed payment that leaves the balance at 0;
  opening /settle with nothing owed says "Estáis al día" / "Ya estás al día".
- **Add expense**: the numpad quick flow (equal / only me / only them) is the
  default; "Más opciones" exposes custom splits, tags, date and recurrence.
- **Spaces**: Pareja→COUPLE, Piso→GROUP, Viaje→EPHEMERAL (only when
  `EPHEMERAL_SPACES_ENABLED`, otherwise GROUP), Solo yo→INDIVIDUAL.
- **Budgets**: tapping an unbudgeted category asks for the amount (the
  prototype's fixed 100 € is a demo shortcut).
- **MCP (Hermes Agent)**: "Conectar" issues a token (copy once); there is no
  "Desconectar" because MCP JWTs cannot be revoked yet.
- **Shopping aisles** are kept (grouping/ordering) even though the prototype
  shows a flat list.

## Chosen direction

`EQUIL Rediseño.dc.html` holds the canvas trimmed to the chosen path: **"Mezcla · base 1a +
espacios de 1b + ticket de 1c"** (2a: Inicio, Añadir gasto, Saldar deuda) and the remaining
screens in that style (3a). The discarded directions (1a/1b/1c) and the old-app reference (0a)
were removed. The Ralph UX loop in `scripts/ralph/` audits the app against it.
