# Plan final: acciones críticas más claras y paso de "Quedar en paz" a "Saldar deuda"

Esta versión recoge todas las observaciones altas y medias de la revisión. Cambios respecto al borrador:
- Término propio para el deudor ("Pedirle que lo confirme"), separado de "Recordarle la deuda".
- "Deuda saldada" solo justo después de un pago que deja el saldo a cero.
- `role=alertdialog` en las hojas destructivas.
- Gestión ya no navega sola a /close. Se cuidan los e2e de `committed-mutations` y de `lifecycle`.
- /close se reparte en dos historias que no reescriben los mismos tests.
- Se conserva "Terminar y apuntar gasto".
- "Deshacer" solo donde es real.
- Los mensajes de API se limitan a :107, :230 y :291.
- docs/design/README.md se actualiza en la misma historia que cambia cada texto.

## 1. Glosario (fuente única)

| Concepto | Término final | Se retira |
|---|---|---|
| Pagar o cobrar una deuda | **Saldar deuda**. En plural, **Saldar deudas** (vistas de espacio y de cierre) | Quedar en paz, Quedad en paz, liquidar, Ir a liquidar, Liquidación, Seguir saldando |
| Dirección en el CTA de Inicio | Subtexto **Pagas 7,50 €** / **Cobras 79,30 €** bajo "Saldar deuda" | CTA sin dirección |
| Saldo cero (estado) | **Al día** en filas y chips. **Estáis al día** en compartido. **Ya estás al día** en personal | En paz, Estáis en paz, Tú estás en paz |
| Resultado de un pago que deja el saldo a cero | **Deuda saldada**. Solo justo después de registrar o confirmar un pago CONFIRMED cuyo saldo final es 0. Si queda resto: **Pago registrado · aún te debe X** / **Pago registrado · aún debes X** | "Deuda saldada" al abrir /settle sin deuda |
| Número con signo | **Saldo**, solo como valor. En /settle se usa **Pendiente de antes** | "no cuenta en el saldo", que pasa a "la deuda sigue pendiente" |
| Settlement PENDING | **Pago pendiente**. La lista es **Pagos por confirmar**. El acreedor ve **X dice que te ha pagado** y el deudor **Pago a X · por confirmar** / **Falta que X lo confirme** | Confirmar Pagos; "X te ha pagado", "te pagó" o "Pagaste a" mientras siga pendiente |
| Registrar el pago (deudor) | **Ya le he pagado {importe} a {nombre}** | Ya he pagado, a secas |
| Registrar el cobro (acreedor) | **{nombre} ya me ha pagado {importe}** | Ya me ha pagado, a secas |
| Confirmar un pago recibido | Botón **Lo he recibido**. En /settle, el CTA es **Sí, he recibido {importe} de {nombre}**. El CTA de la hoja es **Sí, he recibido {importe}** | Confirmar, Confirmar pago de X, Confirmar que he recibido…, "Confirmar, lo he recibido" |
| Rechazar (quien recibe) | Botón **No lo he recibido**. CTA destructivo **Rechazar el pago**. Consecuencia: "la deuda sigue pendiente". El chip dice **No recibido** al deudor y **Rechazado** al acreedor | X solo con icono, window.confirm |
| Cancelar un pago propio pendiente (quien paga) | **Anular el pago**. Necesita backend, queda fuera de alcance | Rechazar, Borrar |
| Recordatorio del ACREEDOR al deudor | **Recordarle la deuda a {nombre}** / **Recordar la deuda al grupo**. Texto compartido: "¡Hola, {nombre}! En {espacio} me debes {importe}. Puedes saldarlo desde EQUIL." | Recordárselo |
| Aviso del DEUDOR al acreedor por un pago pendiente | **Pedirle que lo confirme**. Texto compartido: "¡Hola, {nombre}! Te he pagado {importe} por {método} en {espacio}. ¿Lo confirmas en EQUIL?" | Usar "Recordarle la deuda" en el lado del deudor |
| Fila de un pago en Gastos o Recientes | Título **Pago a X · por confirmar** / **X dice que te ha pagado** (PENDING) o **Pagaste a X** / **X te pagó** (CONFIRMED). Subtítulo **Pago de deuda · {estado} · {método}** | Liquidación |
| Pantalla de historial | **Historial de pagos** | Pagos, como título suelto |
| SpaceStatus SETTLING | **Cerrando cuentas** en chip, banner y cabecera. Para entrar: **Empezar a cerrar cuentas**. Para salir: **Reabrir espacio**. Aviso tras entrar: **Estáis cerrando cuentas. Ahora saldad las deudas.** | Liquidando, en liquidación, liquidándose, Iniciar liquidación, Saldando, "Cuentas cerradas" |
| ARCHIVED | **Archivado**. CTA de la hoja: **Archivar para siempre** | Archivar, a secas, en el CTA |
| Verbos de borrado | **Eliminar** para gasto, lista, etiqueta, presupuesto, producto y categoría. **Borrar los tachados** solo en listas. **Desactivar enlace** en invitaciones de espacio. **Anular invitación** en el admin | Mezclar Borrar y Eliminar, Revocar, Vaciar el carro |
| Atajo de listas | **Terminar y apuntar gasto** (se mantiene, es decisión de producto) + línea de efecto "Quita de la lista los {n} productos tachados" | Terminar compra y apuntar gasto |

SETTLING no se llama "Saldando" porque "Saldar deuda" también se puede hacer en ACTIVE. "Cerrando cuentas" ya lo usan el banner, la página del espacio y Gestión.

## 2. Patrón de acción crítica

**Componente nuevo `src/components/ui/critical-action-sheet.tsx` (`CriticalActionSheet`)**, construido sobre `src/components/ui/sheet.tsx`. Recoge lo que hoy hace `src/components/space/confirm-sheet.tsx`, que queda como envoltorio fino con la misma API y los mismos testids, así que sus usos no cambian.

Props:
- `title`: pregunta que nombra el objeto y el importe.
- `facts`: filas QUIÉN y CUÁNTO, `{label, value, emphasis?}`, con tabular-nums.
- `consequences`: entre 1 y 4 frases con la consecuencia concreta.
- `reversible`: si es false, añade la línea "No se puede deshacer.".
- `tone`: `primary` o `danger`. Con `danger`, el CTA usa bg-destructive y la hoja lleva `role="alertdialog"` y `aria-modal`. Con `primary`, `role="dialog"`.
- `confirmLabel`: siempre verbo y objeto, nunca "Aceptar" ni "Confirmar" a secas.
- `confirmDisabled` y `disabledReason`: motivo visible junto al CTA desactivado.
- `secondary`: `{label, href|onClick, tone}`.
- `children`: campos extra (importe editable, selector, casilla).
- `busy`: spinner y aria-busy. Mientras está activo, no se cierra.
- `error`, `errorHref` y `errorHrefLabel` (por defecto "Saldar deudas"). El error del servidor (409) se sigue pintando aunque la UI haya anticipado el bloqueo.

Foco y teclado:
- Foco atrapado.
- Con `danger`, el foco inicial va a **Cancelar**.
- Escape y el fondo cierran salvo con `busy`.
- Testids: `confirm-sheet-confirm`, `confirm-sheet-cancel`, `confirm-sheet-error`.

Prohibido `window.confirm`/`confirm()` en `src/`. La última historia lo comprueba con un grep global.

**Éxito**:
- `EqToast`/`useEqToast` (`src/components/ui/eq.tsx`) admite `action?: {label,onAction}|{label,href}`. Sigue siendo `<output>`. Con acción dura unos 5 s.
- Para los avisos tras navegar se añade `src/lib/flash-toast.ts` (sessionStorage con try/catch) y `<FlashToast/>`.
- **Deshacer** solo donde el resultado es idéntico: un producto de lista eliminado y una línea de desglose (estado local).
- Nunca en dinero, en "Borrar los tachados" ni en membresía. Ahí la mitigación es la hoja de revisión.

Matriz de riesgo:
- Dinero definitivo (cobro, confirmar): hoja `primary` con facts y "No se puede deshacer".
- Pierde datos o expulsa: hoja `danger`.
- Reversible con impacto en el grupo: hoja `primary` con "Puedes reabrirlo".
- Ligero: toast con Deshacer.

## 3. Cambios por flujo (solo UI)

**Saldar deuda (/settle)**
- h1 visible "Saldar deuda".
- Frase que se entiende sola: quién debe a quién y cuánto.
- CTA con persona e importe de la transferencia elegida.
- El CTA abre una hoja de revisión:
  - Deudor: "EQUIL no envía dinero…".
  - Acreedor: "¿Has recibido…?".
  - Importe parcial editable con tope.
- Pendiente del deudor sin redundancia, con "Pedirle que lo confirme".
- Éxito con "Ver el pago" y "Saldar el resto".
- En SETTLING con todo a cero: "Terminar y archivar" solo para OWNER/ADMIN no invitados.

**Pagos por confirmar**
- Tarjeta "Pagos por confirmar · n".
- La fila enlaza al detalle.
- Botones con texto que abren las hojas.
- Toast según el resto.
- Ante un 409, refresh y error en la fila.

**Detalle e historial**
- Presente mientras está pendiente.
- Rechazado explicado al deudor con "Saldar deuda".
- Editar un pendiente avisa: "{X} tendrá que confirmar el nuevo importe".

**Ciclo de vida**
- Hojas para empezar a cerrar cuentas, reabrir y archivar.
- Gestión no navega sola: el toast lleva "Ver qué falta" a /close.
- Archivar se oculta en ACTIVE.
- En SETTLING, la hoja muestra el motivo con el CTA desactivado si `canArchive` es false, y el 409 se sigue pintando.
- /close como checklist con todas las deudas del espacio.
- /close pasa a PATCH en lugar de settle-up.
- Banner con progreso. Sin "Ver qué falta" para invitados.

**Membresía**
- Quitar con hoja.
- Si tiene saldo, se muestra antes de intentarlo. Las acciones dependen de la dirección:
  - Si el miembro es deudor: "Recordarle la deuda".
  - Si quien gestiona es su deudor: "Saldar deuda".
- Hacer propietaria con confirmación en línea.
- Salir:
  - El saldo se calcula en el servidor y se muestra en la primera hoja.
  - Se explica la consecuencia para los demás.
  - CTA "Saldar deuda" y "Salir sin saldar" con casilla.
- LAST_OWNER con salida directa.

**Invitaciones**
- "Generar nuevo" con hoja y comprobación de res.ok.
- Desactivar enlace con hoja.
- Convertir en grupo con `reversible=false`.
- Nota para invitados solo con `flags.ephemeral && type===EPHEMERAL`.

**Borrados**
- Eliminar gasto: alertdialog con nombre, importe, efecto y recurrencia.
- Editar o promover un gasto compartido: línea de efecto en el saldo.
- Listas: "Borrar los tachados" con hoja y sin deshacer. "Terminar y apuntar gasto" con la línea de efecto. Eliminar lista con alcance. Producto con Deshacer.
- Etiquetas y categorías con hoja y BUDGET_CONFLICT resoluble.
- Desglose con deshacer local.
- Presupuesto: ya cumple el patrón (confirmación en línea, consecuencia y toast). Solo se revisa el texto.

**Cuenta**
- Aviso del token corregido.
- Cerrar todas las sesiones en rojo dentro de "Cuenta" (se mantienen las regiones Organizar, Conexiones y Cuenta).
- Aviso en el login.
- `<a download>` intacto, con el nombre del espacio en el subtexto.
- Admin: Anular invitación y grupo Caducadas.

## 4. Renombrado (lista de ficheros)

UI:
- src/components/dashboard/space-carousel.tsx
- src/app/settle/client.tsx
- src/app/settle/page.tsx
- src/components/dashboard/pending-settlements.tsx
- src/components/settle/settlement-actions.tsx
- src/app/settle/[id]/page.tsx
- src/app/settle/history/page.tsx
- src/lib/home-format.ts
- src/components/ui/member-balance-list.tsx
- src/components/space/member-list.tsx
- src/components/month/analysis-view.tsx
- src/app/page.tsx
- src/components/space/leave-space.tsx
- src/components/space/create-space-flow.tsx
- src/app/spaces/[id]/actions-client.tsx
- src/app/spaces/[id]/close/client.tsx
- src/components/space/confirm-sheet.tsx
- src/components/space/space-status-banner.tsx
- src/lib/space-ui.ts
- src/app/expense/[id]/page.tsx
- src/app/expenses/list/client.tsx
- src/app/expenses/list/page.tsx
- src/components/expenses/list-format.ts
- src/app/dashboard/page.tsx
- src/components/expense/add/expense-form-sections.tsx
- src/components/month/month-client.tsx
- src/components/month/budget-view.tsx
- src/app/categories/client.tsx
- src/components/shopping/lists-hub.tsx
- src/components/settle/settle-model.ts
- src/components/settle/method-picker.tsx

**Mensajes de API: solo cambia el texto.** Es el cambio de nombre que pidió el usuario y se señala explícitamente. Códigos, status y forma no cambian.
- `space-policy.ts:107` → "Estáis cerrando cuentas en este espacio: no se pueden crear gastos nuevos"
- `space-policy.ts:230` (OPEN_BALANCES) → "Aún hay deudas sin saldar en este espacio. Saldadlas antes de archivarlo."
- `space-policy.ts:291` (HAS_BALANCE al quitar) → "Esta persona aún tiene saldo pendiente en el espacio. Saldad sus deudas antes de quitarla." Conserva "saldo pendiente", así que `members/[userId]/route.test.ts:136` sigue pasando y se verifica.
- `:135`, `:141`, `:222` y `:270` NO se tocan sin visto bueno del usuario.

Tests unitarios:
- src/lib/space-policy.closing.test.ts:78
- src/app/api/expenses/route.test.ts:302
- src/app/api/spaces/[id]/members/[userId]/route.test.ts:136 (verificar)
- src/lib/home-format.test.ts:29,37
- src/components/expenses/list-format.test.ts:50-59

E2E:
- e2e/dashboard/balance.spec.ts:64,79
- e2e/settlements/create-and-confirm.spec.ts (51, 61, 71, 82, 89, 90, 114, 136, 154, 161, 192, 216, 222, 228, 238, 259, 271)
- e2e/settlements/partial-and-scope.spec.ts (39, 46, 48, 94, 140, 143)
- e2e/spaces/settle-up.spec.ts (53, 54, 60, 110-114, 126, 165, 170, 219-237, 252)
- e2e/refresh/committed-mutations.spec.ts (31-45, 48-70, 72-80, 100-110)
- e2e/spaces/lifecycle.spec.ts (86, 92, 96, 108-110, 118, 122, 140, 143, 169-215, 181, 195, 196, 264, 289)
- e2e/spaces/manage.spec.ts (93, 110-113, 124, 136-176)
- e2e/features/month.spec.ts:52
- e2e/shopping/lifecycle.spec.ts:36
- e2e/expenses/edit-delete.spec.ts:82-86
- e2e/features/settings.spec.ts:21,46-48,75
- e2e/settlements/rules.api.spec.ts:8 (comentario)

MCP:
- src/mcp/tools/finance.ts:205,235 (descripción + paso de revisión con el usuario)
- src/mcp/resources-prompts.ts:107-108 (prompt falso)

Documentación:
- docs/design/README.md: Settle y Chosen direction en CF-01/CF-09; bullet MCP en CF-24.
- AGENTS.md: ARCHIVED no se reabre.

Comentarios:
- src/app/api/settle/route.ts:12
- src/lib/settlement-rules.ts:2
- src/lib/settlement-service.ts:12
- src/lib/settlement-space.ts:7
- src/lib/space-policy.ts:192
- pending-settlements.tsx:22,39
- close/client.tsx:16
- confirm-sheet.tsx:11

Los nombres internos de los tests ("Ya he pagado" → paid) se quedan como están.

## 5. Fuera de alcance / backend

Ver `outOfScope`. Cada punto tiene en su historia la mitigación de UI correspondiente.

## 6. Capturas nuevas (scripts/ralph/capture.spec.ts)

| Id | Escenario | Ruta y acción |
|---|---|---|
| espacio-cerrando | space-settling | /spaces/{coupleId} |
| hoja-archivar | space-settling | /spaces/{coupleId} + Archivar |
| hoja-cerrar-cuentas | ux-showcase | /spaces/{coupleId} + Empezar a cerrar cuentas |
| hoja-confirmar-pago | space-settling | /dashboard + "Lo he recibido" |
| hoja-rechazar-pago | space-settling | /dashboard + "No lo he recibido" |
| hoja-saldar-deudor | ux-showcase, asUserB | /settle?space={coupleId} + CTA |
| hoja-saldar-acreedor | ux-showcase | /settle?space={coupleId} + CTA |
| saldar-exito | ux-showcase, asUserB | registrar un pago |
| pago-detalle-acreedor | ux-showcase | receptor de settlementId |
| pago-rechazado | ux-showcase | exponer rejectedSettlementId en src/app/api/test/seed/route.ts |
| cierre-activo | ux-showcase | /spaces/{coupleId}/close |
| cierre-cerrando | space-settling | /spaces/{coupleId}/close |
| hoja-quitar-miembro | ux-showcase | /spaces/{groupId} |
| hoja-salir-con-deuda | ux-showcase, asUserB | /spaces/{coupleId} |
| hoja-eliminar-gasto | ux-showcase | /expense/{expenseId} |
| hoja-borrar-tachados | ux-showcase | /lists/{listId} |
| categorias | ux-showcase | /categories |
| etiquetas | ux-showcase | /tags |
| ajustes-revocar | ux-showcase | /settings |
| admin | ux-showcase, admin | /admin |

## 7. Decisiones del usuario (2026-10-20)

- CF-16 aprobado: /close deja de usar settle-up y solo pasa a SETTLING (PATCH); sin pagos PENDING falsos.
- CF-05 aprobado: cambia el texto de space-policy.ts:107, 230 y 291 (códigos, status y forma intactos). El resto de mensajes de API no se toca.

## 8. Fuera de alcance (detalle)

- Anular un pago PENDING propio (quien lo registró): hace falta DELETE /api/settle/[id] o un status CANCELLED, solo para el pagador y solo en PENDING, bajo withSpaceLock, con 409 SETTLEMENT_NOT_PENDING. Mientras tanto, CF-12 muestra la nota provisional 'Si te has equivocado, edítalo o pide a X que lo rechace'
- Deshacer un pago CONFIRMED (cobro o confirmación): hace falta un asiento compensatorio en el ledger, limitado en el tiempo y bajo el space lock. Mientras tanto, la mitigación es la hoja de revisión de CF-08 y CF-10. Se descarta retrasar el envío en cliente porque se pierde al navegar
- resolvedBy y un motivo opcional en el rechazo (Settlement) para mostrar 'Rechazado por Marta' y un aviso persistente con seenAt. resolvedAt NO hace falta: CF-06 y CF-13 usan Settlement.updatedAt con una ventana de 7 días
- POST /api/spaces/[id]/settle-up: dejar de crear pagos PENDING en efectivo (o devolver solo sugerencias). CF-16 solo deja de usarlo desde la UI
- Campo settlingAt en Couple para filtrar 'Pagos del cierre' por fecha. CF-16 usa los PENDING más el plan calculado
- Restaurar una Membership quitada (deshacer al quitar a un miembro): endpoint restore bajo withSpaceLock con comprobación del límite
- Permitir que un invitado salga por su cuenta de un viaje
- Campo aditivo pendingCents en el 409 HAS_BALANCE al salir. CF-19 lo calcula en el servidor de la página
- Borrado lógico y restauración de gastos para tener un Deshacer real tras eliminar
- Restauración real de 'Borrar los tachados' (conservando id, checked, sortOrder y aisle). Volver a crearlos por POST engañaría, así que CF-23 deja solo la hoja de confirmación
- Conteos de uso (expenses/recurring/budgets) para categorías y etiquetas antes de confirmar, y periodStart en el 409 BUDGET_CONFLICT
- Registro de tokens MCP emitidos (id, fecha, caducidad) para mostrar 'N tokens activos' y desconectarlos uno a uno
- Paso de revisión impuesto por el servidor en las herramientas MCP create_settlement/confirm_settlement (p. ej. dry-run + confirm token). CF-28 solo lo pide en la descripción de la herramienta
- Requiere visto bueno del usuario (texto de mensajes de API que no forma parte del renombrado): space-policy.ts:135 y :141 (INVALID_TRANSITION muestra el enum), :222 (PENDING_SETTLEMENTS dice 'Confírmalo o recházalo' incluso al deudor; la UI de CF-14/CF-16 ya indica quién debe confirmar) y :270 ('saldo pendiente' al salir, que también afirma members/[userId]/route.test.ts:136)
- Señalado al usuario: CF-05 cambia el TEXTO de tres mensajes de API (space-policy.ts:107, 230 y 291) por el renombrado pedido, sin tocar códigos, status ni forma. CF-16 cambia el comportamiento de /close (PATCH en vez de settle-up, sin crear pagos PENDING) y rehace settle-up.spec.ts:219-237 y committed-mutations.spec.ts:48-70
- Eliminar presupuesto (budget-sheet.tsx) ya cumple el patrón (confirmación en línea con consecuencia 'tus gastos no cambian' y toast). Se deja como está para no romper e2e/features/budget-errors.spec.ts:142-151 ('Sí, eliminar')
