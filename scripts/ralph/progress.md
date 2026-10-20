# Ralph · progreso UX/UI

## Patrones del código

- Capturas: `SCREENS=<ids> mise run ux:capture` (resetea la BD de test y arranca su propio Next;
  sin `mise run dev` a la vez). Ids y escenarios en `scripts/ralph/capture.spec.ts`.
- Referencias del diseño elegido: `scripts/ralph/design/*.png` (`mise run ux:design` las regenera
  desde `docs/design/EQUIL Rediseño.dc.html`).
- Datos de las capturas: escenario `ux-showcase` en `src/app/api/test/seed/route.ts`
  (Álvaro y Lucía en "Casa", viaje "Lisboa" de 4, presupuestos y lista "Mercadona").
- Sin docker en esta máquina: `CONTAINER_ENGINE=podman mise run services:up`.
- Barra inferior: `src/components/nav/bottom-nav.tsx` (fija, 74 px; las páginas de pestaña llevan `pb-28`).
  Primitivas EQUIL (`EqCard`, `EqRow`, `EqLabel`, `EqHeader`, `EqChip`…) en `src/components/ui/eq.tsx`.
- Zona táctil de 44 px sin cambiar el aspecto: botón `min-h-11 flex items-center` transparente con la
  píldora en un `<span>` hijo (`group-focus-visible:ring-2` para el foco). `EqChip` lo hace con `touch`.
- Estados con interacción en las capturas: campo `act` del `Screen` en `capture.spec.ts`
  (p. ej. `anadir-gasto-relleno`, `anadir-gasto-opciones`; espera ~600 ms a que entren las hojas).
- El layout raíz ya renderiza `<main>`: las páginas no deben anidar otro (usa `<div>`).
- Estados vacíos: `EqEmpty` (`eq.tsx`) con `title`, `hint` y `action` + `href`/`onClick`.
- Enlaces de texto en cabeceras: `-my-2.5 min-h-11 flex items-center` da 44 px sin cambiar la altura de la fila.
- Texto rojo sobre `--negative-tint`: usa `--negative-ink` (#A04830); `--negative`/`text-destructive` ahí no llega a 4,5:1.
- Grises de texto: `--ink-2`/`muted-foreground` y `--ink-3` ya pasan 4,5:1 sobre papel, blanco, `--track` y tintes; `--placeholder` y `--ink-4` nunca para texto.
- Tipografía: Schibsted en todo (cifras incluidas); `font-mono` (DM Mono) solo en códigos/enlaces/tokens y la meta del ticket.
- Confirmaciones: `CriticalActionSheet` (`src/components/ui/critical-action-sheet.tsx`) con facts/consequences/`reversible`; `tone="danger"`
  = alertdialog con foco en Cancelar; `confirmTestId` conserva el testid del CTA al migrar una confirmación antigua. Toast con acción: `const [t, show, action] = useEqToast()` + `<EqToast action={action}>`.
  Aviso tras navegar: `setFlashToast(msg, {label, href})` antes de `router.push` (se pinta en Inicio, Gastos, Espacios, Listas y login).
- Emoji de espacio: `SPACE_TYPE_META` (`src/lib/space-ui.ts`) es la única fuente; categoría en filas = `meta.emoji` en el `icon` de `EqRow`.

## Iteraciones

## 2026-10-20 · UX-01 Inicio
- Corregido: zona táctil de las pestañas de la barra inferior (el `<a>` ocupa la celda de 56 px);
  tarjetas del carrusel como 2a ("con Lucía" a la derecha en la activa, "4 personas" abajo en las
  demás); hueco carrusel→resumen; escenario `ux-showcase` sin avatar emoji (muestra la inicial).
- Pendiente / fuera de alcance: barra del mes en colores de categoría (no la rampa verde del
  mockup, ver UX-06); Lisboa es GROUP (🏢) sin `EPHEMERAL_SPACES_ENABLED`; "Recientes" sin cabecera por día.
- Ficheros: `src/components/nav/bottom-nav.tsx`, `src/components/dashboard/space-carousel.tsx`,
  `src/app/dashboard/page.tsx`, `src/app/api/test/seed/route.ts`.
- Aprendizajes: `*.full.png` pinta la barra fija a media página y tapa contenido: compruébalo con
  el `pb-28` del layout, no es un bug. `smallTargets` mide el elemento `<a>`/`<button>`, no su `<li>`.
  e2e de Inicio: `e2e/dashboard/balance.spec.ts`, `e2e/couple/create-couple.spec.ts`, `e2e/spaces/manage.spec.ts`.

## 2026-10-20 · UX-02 Añadir gasto
- Corregido: Cerrar, chips de espacio y categoría, "Más opciones", "Añadir producto" y "Nueva etiqueta"
  con 44 px de alto; "€" alineado con el importe; "A medias" también en la hoja; contraste de "Entre N personas".
- Pendiente / fuera de alcance: categoría deducida del concepto (lógica nueva); cifras en DM Mono (UX-13);
  "Volver" de `EqHeader` e interruptor "Recurrente" (UX-14); espacios "comidos" en los PNG = hinting headless.
- Ficheros: `src/components/ui/eq.tsx`, `src/components/expense/add/{expense-form-sections,add-expense-client,expense-more-options,receipt-items-editor}.tsx`,
  `src/components/expense/split-editor.tsx`, `scripts/ralph/capture.spec.ts`.
- Aprendizajes: el input del importe mide más que su texto, así que `items-baseline` desalinea el "€"; centrar la fila
  lo arregla. Las capturas de un `<dialog>` modal no salen en `*.full.png` (scroll interno): desplaza el diálogo en `act`.
  e2e de Añadir gasto: `e2e/expenses/{create,qa-fixes,personal,edit-delete}.spec.ts`.

## 2026-10-20 · UX-03 Quedar en paz · ticket
- Corregido: 44 px en "Historial", "Recordárselo", "Ver el pago", "Seguir saldando", "Editar" y el Volver/Cerrar
  de `EqHeader` (para toda la app); `<main>` anidado en `/settle/**`; saldo del ticket a 32 px como 2a;
  historial con "Pago de X" en los rechazados y fecha sin año (se cortaba).
- Pendiente / fuera de alcance: estado "pago pendiente" redundante (sugerido + fila + aviso); fecha mono en el detalle (UX-13).
- Ficheros: `src/app/settle/{client.tsx,history/page.tsx,[id]/page.tsx,[id]/edit/client.tsx}`, `src/components/ui/eq.tsx`,
  `src/app/api/test/seed/route.ts`, `scripts/ralph/capture.spec.ts`.
- Aprendizajes: el layout raíz ya pinta `<main>`: las páginas usan `<div>`. `ux-showcase` tiene ahora pagos (Casa:
  confirmado + rechazado del mes pasado; Lisboa: Bizum pendiente Álvaro→Marta, `settlementId`); para fechar
  movimientos en el pasado hay que fijar `createdAt` del gasto y `updatedAt` del pago (el ticket ordena por ellos).
  `Screen.asUserB` captura como el segundo usuario. e2e de pagos: `e2e/settlements/*`.

## 2026-10-20 · UX-04 Gastos
- Corregido: pago rechazado como "Pago de X" (✕ neutro, importe tachado) en vez de "X te pagó" en verde; estado antes
  del método en el subtítulo; "Filtros" como botón redondo con icono (3a) y contador en insignia; chips de quién pagó y
  `EqSegmented` a 44 px; buscador "Buscar gasto o importe" a toda la altura; detalle con Editar/Eliminar/Compartir
  de 44 px, "Pagaste tú"/"Pagó X", "Tú", "Tu parte"/"Su parte" y avatares con la inicial (sin 👤).
- Pendiente / fuera de alcance: fila "Quedasteis en paz" de 3a (habría que saber si el pago salda); emojis de categoría (UX-13).
- Ficheros: `src/app/expenses/list/client.tsx`, `src/components/expenses/{filters,list-format,list-format.test}.ts(x)`,
  `src/components/ui/eq.tsx`, `src/app/expense/[id]/page.tsx`, `src/components/expense/{delete-button,promote-button}.tsx`,
  `e2e/expenses/edit-delete.spec.ts`.
- Aprendizajes: los e2e de pagos buscan "Liquidación", "Pendiente" y "Confirmado" en las filas de `/expenses/list`
  (no quites esas palabras). `EqSegmented` lo usa también Mes. Botones de icono en cabeceras: `h-11 w-11 -my-1`.
  `qa-fixes.spec.ts:25` (returnTo) falla a veces en la tanda completa y pasa solo: es inestable, no regresión.

## 2026-10-20 · UX-05 Mes · Presupuestos
- Corregido: selector "💑 Casa ⇆" ya no se corta y tiene 44 px (va en `children` de `EqHeader`, no en `meta`); chips
  "+ Categoría" con `EqChip touch`; barras de categoría en verde (ámbar ≥80 %, rojo pasado) como 3a; Cerrar de la hoja
  a 44 px, "€" centrado con el importe y sin "€" huérfano en la pista; `ux-showcase` con Comida cerca del límite y Ocio pasado.
- Pendiente / fuera de alcance: flechas ‹ › de mes (el loader solo sirve el mes actual); fila de % (se queda: lleva el
  aviso en texto); emoji 💑 vs 🏠 (UX-13).
- Ficheros: `src/components/month/{month-client,budget-view,budget-sheet}.tsx`, `src/app/api/test/seed/route.ts`,
  `scripts/ralph/capture.spec.ts` (nueva captura `mes-presupuestos-anadir`).
- Aprendizajes: el slot `meta` de `EqHeader` es un `<span truncate>`: recorta (y deja sin zona táctil) cualquier enlace
  con padding/márgenes negativos; los enlaces de cabecera van en `children` con `-my-2.5 min-h-11 max-w-[55%] flex-none`.
  e2e de Mes: `e2e/features/{month,budget-errors,financial-features}.spec.ts`.

## 2026-10-20 · UX-06 Mes · Análisis
- Corregido: importe redondeado ("271 €") sobre las barras del mes actual y del anterior; meses antiguos al 50 % en
  modo compartido para que se lea la comparación; etiquetas de "Evolución de tu saldo" centradas bajo cada punto;
  barras y etiquetas `aria-hidden` (el `figcaption` sr-only ya lo cuenta todo).
- Pendiente / fuera de alcance: `ux-showcase` sin gasto en may–ago (añadirlo mueve los saldos de otras capturas);
  paleta de categorías sembrada en BD (en Análisis se distinguen por emoji + nombre; en Inicio hay hueco entre tramos);
  flechas de mes (UX-05).
- Ficheros: `src/components/month/analysis-view.tsx`.
- Aprendizajes: en el SVG de saldo las x van en unidades de `viewBox`; para alinear HTML debajo usa `left: x/W·100%`
  con `-translate-x-1/2`. `month.spec.ts` busca "100%" exacto en el panel: no pongas porcentajes en las etiquetas de barra.
  e2e de Análisis: `e2e/features/month.spec.ts`, `e2e/mobile/overflow.spec.ts` ("month analysis").

## 2026-10-20 · UX-07 Listas de la compra
- Corregido: casilla de cada artículo con zona táctil de 44×44 (label con `-ml-2.5 pl-2.5`, carro con `min-h-11`); chips de
  lista y "+ Nueva" con `EqChip touch`; ⋯ de opciones, botón + y campo "Añadir producto" a 44 px; aviso de duplicado
  (✕, "Sumar 1", "Añadir igualmente") a 44 px; cantidad de los artículos del carro en `--ink-3` (era ilegible);
  `ux-showcase` con lista personal "Farmacia" para ver "Común primero, luego Personal".
- Pendiente / fuera de alcance: "×2" a la derecha y avatar del autor del mockup (la cantidad lleva unidad/nota; no se guarda
  el autor por artículo); pasillos y ⋯ se mantienen por decisión de producto.
- Ficheros: `src/components/shopping/{lists-hub,add-item-input,shopping-item-row}.tsx`, `src/components/ui/eq.tsx`,
  `src/app/api/test/seed/route.ts`.
- Aprendizajes: `EqChip touch` metía `block` después del `className` y `twMerge` anulaba un `flex` del llamante (truncado de
  nombres largos); ahora el `block` va primero. e2e de Listas: `e2e/shopping/{ui,lifecycle}.spec.ts`.

## 2026-10-20 · UX-08 Espacios
- Corregido: saldo de la fila activa junto al nombre (no bajaba a otra línea por el borde de 2 px); saldos de miembros en
  una columna alineada (hueco del ⋯ en las filas sin opciones); un MEMBER ve en "Invitaciones" quién puede invitar; texto
  vacío de "Invitar a…" en sans y sin cortes; capturas `espacios-invitar`, `espacios-unirme`, `espacio-detalle-grupo`.
- Pendiente / fuera de alcance: "Personal · 0,00 €" (seed sin gastos personales); Lisboa 🏢 sin `EPHEMERAL_SPACES_ENABLED`;
  "Unirme con código" del mockup (producto: solo enlaces); 💑 vs 🏠 y `px-1` de los textos de ayuda (UX-13).
- Ficheros: `src/components/space/{spaces-list,member-list,space-invite-card}.tsx`, `src/app/spaces/[id]/page.tsx`,
  `src/app/api/test/seed/route.ts`, `scripts/ralph/capture.spec.ts`.
- Aprendizajes: `Screen.activeGroup` fija la cookie `active_group` de la captura (por defecto `coupleId`); la tarjeta
  "Invitar a…" de `/spaces` solo sale para OWNER/ADMIN de un espacio con plazas (Casa está completa): en `ux-showcase`
  Álvaro es ADMIN de Lisboa. e2e de Espacios: `e2e/spaces/{manage,lifecycle,settle-up}.spec.ts`.

## 2026-10-20 · UX-09 Ajustes
- Corregido: Ajustes ya no repite "Espacios" (lista con "Salir", "Nuevo espacio", "Unirme con un enlace"): solo perfil,
  Organizar, Conexiones y Cuenta; "Editar" del perfil a 44 px; "Exportar mis gastos (CSV)" ya no se corta.
- Pendiente / fuera de alcance: fila "Contraseña" del mockup (no hay API de cambio de contraseña); "Acceso MCP · sin conectar"
  (no se guardan los tokens emitidos); "Cerrar sesión en todos los dispositivos" en dos líneas.
- Ficheros: `src/app/settings/{settings-client,page}.tsx`, `e2e/features/settings.spec.ts`.
- Aprendizajes: salir de un espacio lo cubre `LeaveSpace` en `/spaces/[id]` (e2e `spaces/manage.spec.ts` "leaving") y unirse
  con enlace está en `/spaces`; el e2e de Ajustes ahora comprueba que no hay región "Espacios". e2e de Ajustes: `e2e/features/settings.spec.ts`.

## 2026-10-20 · UX-10 Bienvenida
- Corregido: "Ahora no" (44 px, arriba a la derecha, solo en el primer onboarding) para saltar a Inicio sin crear nada;
  línea de ayuda bajo la rejilla que explica el modo elegido (Pareja/Piso/Viaje o Con amigos/Solo yo), con `aria-live`
  y `aria-describedby` en la tarjeta pulsada.
- Pendiente / fuera de alcance: campo "Nombre del espacio" (no está en el mockup, pero lo usa la API); "tengo un enlace"
  en vez de "código" (producto); a 360×760 "Me han invitado" queda bajo el pliegue.
- Ficheros: `src/components/space/create-space-flow.tsx`, `e2e/auth/register.spec.ts`, `e2e/spaces/manage.spec.ts`.
- Aprendizajes: `/welcome` y `/spaces/new` comparten `CreateSpaceFlow` (`mode` `onboard`/`create`); lo propio del primer
  arranque va condicionado a `mode === "onboard"`. La captura `bienvenida` tiene `EPHEMERAL_SPACES_ENABLED` activo ("Un viaje").
  e2e de Bienvenida: `e2e/auth/{register,login}.spec.ts`, `e2e/couple/create-couple.spec.ts`, `e2e/spaces/manage.spec.ts`.

## 2026-10-20 · UX-11 Estados vacíos y de ciclo de vida
- Corregido: nueva primitiva `EqEmpty` (título, explicación y acción de 44 px como enlace o botón); Inicio y Gastos vacíos
  explican qué hacer y ofrecen "Añadir el primer gasto" (al espacio activo o `?space=personal`), sin acción si el espacio
  está liquidando/archivado; "Quitar filtros" cuando nada coincide; avisos "Cerrando cuentas"/"Espacio archivado" con copy
  que dice qué se puede y qué no.
- Pendiente / fuera de alcance: el "+" de la barra sigue en espacios SETTLING/ARCHIVED (no falla: el formulario lo explica y
  ofrece Personal); "Confirmar Pagos" con mayúscula (contrato e2e).
- Ficheros: `src/components/ui/eq.tsx`, `src/app/dashboard/page.tsx`, `src/app/expenses/list/client.tsx`,
  `src/components/space/space-status-banner.tsx`, `e2e/spaces/lifecycle.spec.ts`.
- Aprendizajes: los e2e buscan "Todavía no hay gastos." (lista) y el texto de los avisos de ciclo de vida (`lifecycle.spec.ts`):
  si cambias el copy, actualízalos. Detalle de gasto y `/settle` ya ocultan editar/borrar en SETTLING/ARCHIVED.
  e2e de ciclo de vida: `e2e/spaces/lifecycle.spec.ts`, `e2e/shopping/lifecycle.spec.ts`.

## 2026-10-20 · UX-12 Login
- Corregido: el email ya no se borra tras un intento fallido (la acción devuelve `email`, usado como `defaultValue`); errores
  en español natural ("El email o la contraseña no son correctos."); campos con `aria-invalid` + `aria-describedby` al aviso
  y borde rojo; texto de `AuthError` con contraste ≥4,5 (token `--negative-ink`); "Regístrate" a 44 px; captura `login-error`.
- Pendiente / fuera de alcance: botón "Mostrar contraseña" (colisiona con `getByLabel('Contraseña')` de los e2e; UX-14);
  "¿Has olvidado la contraseña?" (no hay API); otros avisos `text-destructive` sobre `--negative-tint` (~4:1, UX-14).
- Ficheros: `src/app/login/{page,actions}.tsx`, `src/lib/auth-types.ts`, `src/components/auth/auth-shell.tsx`,
  `src/app/globals.css`, `scripts/ralph/capture.spec.ts`.
- Aprendizajes: `Screen.anonymous` captura sin sesión (pantallas de entrada). Tras `useActionState` React resetea el formulario
  no controlado: para conservar valores, devuélvelos en el estado y úsalos como `defaultValue`. Las capturas justo después de
  cambiar un color con `transition-colors` salen a medias: espera ~300 ms en `act`. e2e de Login: `e2e/auth/*`.

## 2026-10-20 · UX-13 Transversal · coherencia visual
- Corregido: "Recientes" de Inicio con el emoji de la categoría (antes icono lucide, distinto de Gastos); barra del mes en
  rampa verde (top-3, resto en la pista) y leyenda sin puntos como 2a; DM Mono fuera de importes del reparto, líneas del
  ticket y fecha del pago; `Button` primario sin sombra ni `scale`; `px-1` de los textos de Invitaciones; `spaceEmoji`
  lee `SPACE_TYPE_META`; borrado `ExpenseCard` (sin uso). Sin restos de crema/terracota/Instrument/Spline en `src/`.
- Pendiente / fuera de alcance: 🏠 por espacio (no hay emoji guardado); emojis/hex de categoría sembrados (dato);
  mosaico de espacio en `--surface-raised` frente a paper.
- Ficheros: `src/app/dashboard/page.tsx`, `src/components/dashboard/month-summary.tsx`, `src/components/expense/split-editor.tsx`,
  `src/components/expense/add/receipt-items-editor.tsx`, `src/app/settle/[id]/page.tsx`, `src/components/ui/button.tsx`,
  `src/components/space/invite-manager.tsx`, `src/app/spaces/[id]/page.tsx`, `src/components/expenses/space-meta.ts`.
- Aprendizajes: el `hex` de las categorías del sistema es la paleta Tailwind-400 sembrada en BD (no las `--cat-*` de
  `globals.css`); para gráficos con la estética 2a usa la rampa `--accent-hex/--accent-soft/--accent-softer` por rango.
  DM Mono solo para códigos/enlaces/tokens y la meta del ticket. El `while pgrep -f capture` se encuentra a sí mismo:
  lanza `ux:capture` en primer plano.

## 2026-10-20 · UX-14 Transversal · accesibilidad y tacto
- Corregido: grises `--ink-2`/`--muted-foreground` (#666862) y `--ink-3` (#686A65) con ≥4,5:1 en papel, blanco, pista y
  tintes; texto rojo sobre `--negative-tint` con `--negative-ink` (alertas, chip "Rechazado", "Expulsar", setup); 44 px en el
  interruptor "Recurrente", los modos de reparto, el campo Fecha, "Volver a rápido" y el buscador de Gastos.
- Pendiente / fuera de alcance: "Mostrar contraseña" (función nueva, choca con `getByLabel('Contraseña')`); input del importe
  (lo cubre su `<label>`); placeholders a 3,4:1 (decorativos).
- Ficheros: `src/app/globals.css`, `src/components/expense/{split-editor,add/expense-more-options,add/add-expense-client}.tsx`,
  `src/app/expenses/list/client.tsx`, `src/components/settle/status-chip.tsx`, `src/components/space/member-list.tsx`,
  `src/components/category/{category-editor,delete-category-modal}.tsx`, `src/app/setup/setup-form.tsx`.
- Aprendizajes: comprueba el contraste también sobre `--track` (#E9EAE5) y los tintes, no solo sobre papel: es donde fallan los
  grises. Interruptores: botón `h-11 w-11` transparente con la pista en un `<span>` (`group-focus-visible:ring-2`). Un input
  dentro de una etiqueta con borde de `h-11` mide 42: dale `h-11 -my-px`.

## 2026-10-20 · CF-01 Renombrar la acción a "Saldar deuda"
- Corregido: h1 visible "Saldar deuda" en /settle (`EqHeader title`); CTA del carrusel "Saldar deuda" con `HandCoins`,
  href `settleUrlFor(spaceId)` y "Pagas/Cobras X" debajo (fuera del enlace, `aria-describedby`); "Estáis al día"/"Ya estás al
  día" al abrir sin deuda, "Deuda saldada" solo tras un pago que deja 0, "Pago registrado · aún te debe X" si queda resto;
  "Saldar el resto", "Recordarle la deuda a X"/"Recordar la deuda al grupo" (texto y título compartidos nuevos), "Pendiente de
  antes", "¿Qué deuda quieres saldar?"; README de diseño; e2e nuevo de saldo cero; captura `saldar-al-dia`.
- Pendiente / fuera de alcance: CTA con persona e importe y "Ya le he pagado X a Y" (CF-09); nota de pago pendiente del deudor (CF-11).
- Ficheros: `src/app/settle/{client,page}.tsx`, `src/components/dashboard/space-carousel.tsx`, `src/app/dashboard/page.tsx`,
  `docs/design/README.md`, `e2e/dashboard/balance.spec.ts`, `e2e/settlements/{create-and-confirm,partial-and-scope}.spec.ts`,
  `scripts/ralph/capture.spec.ts`.
- Aprendizajes: para un subtexto que no entre en el nombre accesible, ponlo fuera del `<a>` y enlázalo con `aria-describedby`
  (`toHaveAccessibleDescription` en e2e). Blanco con opacidad sobre `--primary` baja de 4,5:1: subtextos de la tarjeta activa en
  blanco pleno. `getByRole(..., { name })` busca por subcadena: usa `exact: true` si el texto es corto.

## 2026-10-20 · CF-02 Saldo cero "Al día" y barrido de "en paz"
- Corregido: `rowBalance(0)` → "Al día" y `balanceWords(0)` → "Estáis al día" (+ test); "Al día" en `member-list` y
  `member-balance-list`; gráfico de saldo de Mes ("Al día" en la cifra, "al día" en títulos y lectura accesible); landing
  "…y saldad las deudas con un toque."; salir "Lo mejor es saldar la deuda antes de salir."; crear espacio "…cuando hayáis
  saldado las deudas.".
- Pendiente / fuera de alcance: "Solo cuando estéis en paz." / "solo liquidar." en Gestión (`actions-client.tsx`, historia de
  ciclo de vida); "Quedad en paz" en `/close` y en `space-policy.ts` (CF-05/CF-16); comentarios de código sin tocar.
- Ficheros: `src/lib/home-format{,.test}.ts`, `src/components/{ui/member-balance-list,space/member-list,space/spaces-list,month/analysis-view,space/leave-space,space/create-space-flow}.tsx`, `src/app/page.tsx`.
- Aprendizajes: el ux-showcase no tiene ningún miembro con saldo cero, así que "Al día" no se ve en las capturas de espacio;
  sí sale en `mes-analisis.aria.yml` (meses pasados). Ningún e2e afirmaba "En paz" (solo "Estáis al día" en `settle-peace`).

## 2026-10-20 · CF-03 SETTLING = "Cerrando cuentas"
- Corregido: `SPACE_STATUS_META` SETTLING → "Cerrando cuentas" (cabecera "Pareja · Cerrando cuentas", chips); "Saldar deudas →" en
  el banner y en el error de /close; `ConfirmSheet` con "Saldar deudas" por defecto; Gestión ("solo saldar deudas", "Saldar deudas"
  con `HandCoins`, "Solo cuando no queden deudas."); /close ("Saldad las deudas y archivad…", "Pagos del cierre", "Empezar a cerrar
  cuentas", aviso y error nuevos); captura nueva `espacio-cerrando`; e2e de lifecycle/manage/settle-up actualizados y en verde.
- Pendiente / fuera de alcance: "se está liquidando" en `space-policy.ts:107`, añadir gasto, Gastos y Listas (CF-05 y siguientes);
  "Espacio en liquidación" del banner de Mes (`e2e/features/month.spec.ts:52`); "Confirmar Pagos" con mayúscula.
- Ficheros: `src/lib/{space-ui,settlement-space}.ts`, `src/components/space/{space-status-banner,confirm-sheet}.tsx`,
  `src/app/spaces/[id]/{actions-client,close/client}.tsx`, `e2e/spaces/{lifecycle,manage,settle-up}.spec.ts`, `scripts/ralph/capture.spec.ts`.
- Aprendizajes: el escenario `space-settling` (User A/B, saldo ±50 € y un pago en efectivo pendiente) sirve para ver el banner,
  la Gestión de SETTLING y /close; su `coupleId` es el espacio. Los e2e afirman la cabecera con `toHaveText` exacto.

## 2026-10-20 · CF-04 Avisos de solo lectura de SETTLING sin "liquidando"
- Corregido: detalle de gasto ("Estáis cerrando cuentas: este gasto ya no se puede cambiar." / "Este espacio está archivado: solo
  lectura."), Gastos ("Estáis cerrando cuentas: no se admiten gastos nuevos."), nota de añadir gasto ("está cerrando cuentas"),
  banner de Mes "Cerrando cuentas", presupuestos y categorías "archivado o cerrando cuentas", toast de Listas; capturas nuevas
  `gasto-cerrando`, `gastos-cerrando`, `mes-cerrando` (escenario `space-settling`).
- Pendiente / fuera de alcance: subtítulo "Liquidación · Pendiente" en filas de pago (CF-06); 409 de `space-policy.ts:107` (CF-05).
- Ficheros: `src/app/expense/[id]/page.tsx`, `src/app/expenses/list/client.tsx`, `src/components/expense/add/expense-form-sections.tsx`,
  `src/components/month/{month-client,budget-view}.tsx`, `src/app/categories/client.tsx`, `src/components/shopping/lists-hub.tsx`,
  `e2e/spaces/lifecycle.spec.ts`, `e2e/features/month.spec.ts`, `e2e/shopping/lifecycle.spec.ts`, `scripts/ralph/capture.spec.ts`.
- Aprendizajes: el ARCHIVED del detalle de gasto también lo afirma `e2e/spaces/lifecycle.spec.ts:236` (texto exacto). `space-settling`
  devuelve `expenseId`, así que sirve para capturar el detalle de un gasto bloqueado. `inicio-liquidando` y `listas` no muestran estos avisos.

## 2026-10-20 · CF-05 Texto de tres mensajes de API de space-policy
- CAMBIO DE TEXTO DE MENSAJES DE API pedido por el usuario (renombrado); `code`, `status` y forma sin cambios.
- Corregido: `space-policy.ts:107` → "Estáis cerrando cuentas en este espacio: no se pueden crear gastos nuevos"; `:230` →
  "Aún hay deudas sin saldar en este espacio. Saldadlas antes de archivarlo."; `:291` → "Esta persona aún tiene saldo pendiente
  en el espacio. Saldad sus deudas antes de quitarla."; comentario `:192` "al día".
- Pendiente / fuera de alcance: mensajes de `:135`, `:141`, `:222` y `:270` (necesitan visto bueno del usuario).
- Ficheros: `src/lib/space-policy{,.closing.test}.ts`, `src/app/api/expenses/route.test.ts`, `e2e/spaces/lifecycle.spec.ts`.
- Aprendizajes: estos mensajes solo los afirman `route.test.ts:302` (expenses), `space-policy.closing.test.ts:78` y
  `lifecycle.spec.ts:118`; los tests de miembros/espacio buscan subcadenas (`/saldo pendiente/`, `/deudas/`): consérvalas.
  Ninguna pantalla de captura muestra estos 409 sin interacción.

## 2026-10-20 · CF-06 Filas de pago: "Pago de deuda" y títulos en presente
- Corregido: `settlementText` → PENDING "Pago a X · por confirmar" / "X dice que te ha pagado" (y "Pago de X a Y · por confirmar"),
  CONFIRMED "Pagaste a X" / "X te pagó", REJECTED "Pago a X · no recibido" / "Pago de X · rechazado"; subtítulo "Pago de deuda ·
  {estado} · {método}" (+ test); Gastos con reloj e importe gris en PENDING; búsqueda "pago deuda saldar liquidación"; Recientes
  "Pago de deuda" con "Pendiente · De → Para · día" primero, verde solo CONFIRMED, y mis REJECTED de 7 días ("X no lo recibió",
  tachado, ordenados por `updatedAt`); captura nueva `inicio-deudor` (Lucía) y rechazo de 15 € de ayer en `ux-showcase`.
- Pendiente / fuera de alcance: tarjeta "Confirmar Pagos" / "te ha pagado" / botón X de Inicio (CF de confirmación).
- Ficheros: `src/components/expenses/list-format{,.test}.ts`, `src/app/expenses/list/{page,client}.tsx`, `src/app/dashboard/page.tsx`,
  `src/app/api/test/seed/route.ts`, `scripts/ralph/capture.spec.ts`, `e2e/settlements/create-and-confirm.spec.ts`, `e2e/spaces/settle-up.spec.ts`.
- Aprendizajes: los e2e localizan las filas de pago con `a[href^="/settle/"]` + `hasText: 'Pago de deuda'` y afirman "Pendiente",
  "Confirmado" y "User B → User A" (Inicio): conserva esas cadenas. `ux-showcase` tiene ahora en Casa un REJECTED Lucía→Álvaro de ayer
  (sale en el ticket de /settle y en Gastos de Álvaro como "Pago de Lucía · rechazado").

## 2026-10-20 · CF-07 Patrón compartido: CriticalActionSheet, toast con acción y flash toast
- Corregido: `src/components/ui/critical-action-sheet.tsx` (title, facts, consequences, `reversible=false` → "No se puede deshacer.",
  tone danger → `alertdialog` + `aria-modal` + foco inicial en Cancelar, `confirmDisabled`/`disabledReason` con `aria-describedby`,
  `secondary`, `busy` con `aria-busy` y sin cierre por X/Escape/fondo/Cancelar, error con enlace aunque el CTA esté desactivado; testids
  `confirm-sheet-{confirm,cancel,error,reason}`); `ConfirmSheet` delega con la misma API; `Sheet` admite `role`, X a 44 px y desmonta
  sin `dialog.close`; `useEqToast` devuelve `[msg, show, action]` y `EqToast action` (callback que además cierra, o enlace; ≥5 s);
  `src/lib/flash-toast.ts` + `<FlashToast/>` (en layouts de dashboard, expenses/list y lists; páginas spaces y login); captura `hoja-archivar`.
- Pendiente / fuera de alcance: CTA "Archivar para siempre" y facts de la hoja de archivar (historia de ciclo de vida); nadie usa aún
  `setFlashToast` ni acciones de toast (lo harán las historias siguientes).
- Ficheros: `src/components/ui/{critical-action-sheet,critical-action-sheet.test,eq-toast.test,flash-toast,sheet,eq}.tsx`,
  `src/lib/flash-toast{,.test}.ts`, `src/components/space/confirm-sheet.tsx`, `src/app/{dashboard,expenses/list,lists}/layout.tsx`,
  `src/app/{spaces,login}/page.tsx`, `scripts/ralph/capture.spec.ts`.
- Aprendizajes: en jsdom `<dialog>` no tiene `showModal`/`close` (Sheet cae a `open`); `getByRole` no lo ve si no está abierto: búscalo
  con `document.querySelector('dialog')`, y Escape se simula con `fireEvent(dialog, new Event('cancel', { cancelable: true }))`.
  El efecto del padre corre después del de `Sheet` (showModal), así que el padre puede mover el foco inicial. `FlashToast` re-lee en
  cada cambio de `pathname` porque los layouts de pestaña no se remontan al navegar dentro del segmento.

## 2026-10-20 · CF-08 Pagos por confirmar en Inicio
- Corregido: tarjeta "Pagos por confirmar · n" + "No cuentan en el saldo hasta que confirmes que los has recibido." (+ "Confirma los pagos
  para cerrar las cuentas" en SETTLING); fila "X dice que te ha pagado" (avatar y texto → /settle/{id}, importe sin verde); botones
  "Lo he recibido" / "No lo he recibido" que abren `CriticalActionSheet` (primary con facts De/Para/Importe/Método, "X dejará de deberte…" /
  "X aún te deberá…", no reversible, CTA "Sí, he recibido {importe}"; danger "Rechazar el pago"); toasts "Deuda saldada: X ya no te debe nada" /
  "Pago confirmado · X aún te debe…" / "Pago rechazado: la deuda con X sigue pendiente"; 409 → `router.refresh()` + error en la fila (o suelto
  si la fila desaparece); `aria-busy` por fila; capturas nuevas `hoja-confirmar-pago` y `hoja-rechazar-pago`; e2e nuevo de rechazo.
- Pendiente / fuera de alcance: "X te ha pagado" en las filas pendientes de /settle (`src/app/settle/client.tsx:477`).
- Ficheros: `src/components/dashboard/pending-settlements.tsx`, `src/app/dashboard/page.tsx`, `scripts/ralph/capture.spec.ts`,
  `e2e/{dashboard/balance,settlements/create-and-confirm,settlements/partial-and-scope,spaces/settle-up,refresh/committed-mutations}.spec.ts`.
- Aprendizajes: el resto de la deuda de X conmigo sale de `resolveMyDebts(balances de active.members, X)[yo]` (mismo emparejamiento que
  /settle). `PendingSettlements` se monta siempre (con `key` = espacio) y solo pinta la tarjeta si hay pagos: así el toast sobrevive al
  refresh que la vacía. A 360 px dos botones de texto no caben con la sangría del avatar: fila de botones a todo el ancho.

## 2026-10-20 · CF-09 /settle: frase de quién debe a quién, CTA con persona e importe y textos del método
- Corregido: titular `settle-summary` bajo el h1 ("Lucía te debe 79,30 €" / "Le debes 79,30 € a Álvaro"; grupo "Debes/Te deben X en total"
  + `settle-summary-transfer` "Le pagas Y a Marta" / "Marta te paga Y" según la transferencia elegida); CTAs "Ya le he pagado {t.amount} a X",
  "X ya me ha pagado {t.amount}" y "Sí, he recibido {incoming.amount} de X" (pueden partir en dos líneas: `CTA_WRAP`); leyenda del método
  "¿Cómo le has pagado?" / "¿Cómo te ha pagado?"; "Transfer." → "Transferencia" (tiles a 13 px); filas de "Pagos por confirmar" de /settle
  "X dice que te ha pagado" / "Pago a X" + "Falta que X lo confirme"; README de diseño (Settle) y e2e con regex.
- Pendiente / fuera de alcance: aviso redundante del pendiente del deudor y "Pedirle que lo confirme" (CF-11); hoja de revisión (CF-10).
- Ficheros: `src/app/settle/client.tsx`, `src/components/settle/{method-picker.tsx,settle-model.ts}`, `docs/design/README.md`,
  `e2e/settlements/{create-and-confirm,partial-and-scope}.spec.ts`, `e2e/spaces/settle-up.spec.ts`.
- Aprendizajes: `MethodPicker` también lo usa `/settle/[id]/edit` (label "Método"). A 360 px una tile de método mide ~101 px: "Transferencia"
  solo cabe a 13 px. Los e2e de /settle localizan los CTA por regex (`/^Ya le he pagado/`, `/ya me ha pagado/`, `/^Sí, he recibido .* de User B/`).

## 2026-10-20 · CF-10 /settle: hoja de revisión antes de registrar o confirmar, con importe parcial
- Corregido: ningún CTA de /settle escribe con un toque; abren `RecordSettlementSheet` (deudor "Antes de marcarlo como pagado", facts
  De → Para / Importe editable / Método, "EQUIL no envía dinero: haz primero el {Bizum|la transferencia} desde tu banco." / "dale primero
  el dinero en efectivo", "Avisaremos a X.", "Contará cuando X confirme…", CTA "Sí, ya le he pagado {importe}", Cancelar "Todavía no";
  acreedor "¿Has recibido {importe} de X?", no reversible, CTA "Sí, lo he recibido") o `PendingPaymentSheet` (la de CF-08, ahora compartida
  con Inicio) para el entrante; importe parcial con "máx. X", resto en las consecuencias y error en línea por encima del tope;
  validación `validateSettleAmount` compartida con `/settle/[id]/edit`; capturas `hoja-saldar-deudor` y `hoja-saldar-acreedor`; e2e nuevo de parcial.
- Pendiente / fuera de alcance: un 409 "stale" que deje el espacio al día pierde el mensaje de la hoja (pasa a la pantalla "al día").
- Ficheros: `src/components/settle/{settle-review-sheet.tsx,settle-amount.ts,settle-amount.test.ts}`, `src/app/settle/client.tsx`,
  `src/app/settle/[id]/edit/client.tsx`, `src/components/dashboard/pending-settlements.tsx`, `scripts/ralph/capture.spec.ts`, `docs/design/README.md`,
  `e2e/settlements/{create-and-confirm,partial-and-scope}.spec.ts`, `e2e/spaces/settle-up.spec.ts`.
- Aprendizajes: el `title` de `CriticalActionSheet` lo pinta `Sheet` fuera del div con `testId`: en e2e búscalo con
  `getByRole('dialog', { name })`. `facts[].value` admite un nodo (aquí el `<input>` del importe con su "máx."). En /settle la hoja guarda
  la transferencia en el estado `review` para no depender de `t` tras un `router.refresh()`.

## 2026-10-20 · CF-11 /settle: pendiente del deudor sin redundancia, 'Pedirle que lo confirme' y éxitos con siguiente paso
- Corregido: las transferencias con un pago mío PENDING salen del selector/CTA (`open` en `client.tsx`) y se pintan como un bloque
  `settle-outgoing-pending` ("Falta que X confirme {importe}" + "Ver el pago pendiente" + "Pedirle que lo confirme"); la lista "Pagos por
  confirmar" del ticket solo muestra los entrantes; fila del ticket `settle-ticket-in-flight` "Pago en camino −X · pendiente"; éxito del
  deudor "Avisado a X" con "Pedirle que lo confirme"; éxito del acreedor/confirmación "Has registrado {importe} de X {método}." con enlace
  "Ver el pago" y "Saldar el resto"; SETTLING a cero: `settle-archive` "Terminar y archivar" (OWNER/ADMIN no invitados, `canArchive` desde
  `auth.role` en `page.tsx`) o `settle-archive-hint`; captura nueva `saldar-exito`.
- Pendiente / fuera de alcance: a 360 px los dos enlaces del bloque pendiente van en dos líneas.
- Ficheros: `src/app/settle/{client,page}.tsx`, `scripts/ralph/capture.spec.ts`, `e2e/settlements/create-and-confirm.spec.ts`, `e2e/spaces/settle-up.spec.ts`.
- Aprendizajes: `resolveSettleSpace` ya devuelve `auth.role`/`auth.isGuest` (DB, no JWT). `Done` lleva ahora `id/name/amount/method` en ambos
  tipos; compartir va por `share(title, text, path)` (navigator.share → portapapeles + toast). Los e2e del éxito del deudor buscan "Avisado a User A".

## 2026-10-20 · CF-12 Detalle del pago, acciones sin window.confirm, rechazado explicado, edición e historial
- Corregido: titular de `/settle/[id]` en presente mientras está PENDING ("Pago a X · por confirmar" / "X dice que te ha pagado"), pasado
  solo en CONFIRMED ("Confirmaste que lo recibiste. Ya cuenta en el saldo." / "X confirmó que lo recibió."); chip por lado
  (`getSettlementChipLabel`: "Pendiente de confirmar", "No recibido" al pagador, "Rechazado" al receptor); `SettlementActions` con
  "Sí, he recibido {importe}" / "No lo he recibido" → `PendingPaymentSheet` (sin `window.confirm`); deudor con `AskToConfirmButton`
  ("Pedirle que lo confirme") y nota provisional; REJECTED al deudor con su deuda actual y CTA "Saldar deuda" (`settlement-settle`);
  edición con "máx. {deuda}" (cap en `validateSettleAmount`) y `settle-edit-notice`; "Historial de pagos", "Confírmalo cuando lo recibas"
  (también en /settle), "Esperando a X"; capturas nuevas `pago-detalle-acreedor`, `pago-rechazado`, `pago-editar`, `historial-pagos-pendiente`.
- Pendiente / fuera de alcance: un 409 de un pago ya resuelto desmonta las acciones y su mensaje; "€" lejos de la cifra en Editar pago;
  "Anular el pago" necesita backend.
- Ficheros: `src/app/settle/[id]/{page.tsx,edit/page.tsx,edit/client.tsx}`, `src/app/settle/{history/page.tsx,client.tsx}`,
  `src/components/settle/{settlement-actions,status-chip}.tsx`, `src/lib/settlement-labels.ts`, `src/app/api/test/seed/route.ts`,
  `scripts/ralph/capture.spec.ts`, `docs/design/README.md`, `e2e/settlements/{create-and-confirm,partial-and-scope}.spec.ts`.
- Aprendizajes: lo que el pagador debe al receptor ahora = `resolveMyDebts(await getGroupBalances(groupId), fromId)[toId]` (un PENDING o
  REJECTED no está en el ledger). `capture.spec.ts` admite `as: (d) => d.userC` para entrar como otro usuario; `ux-showcase` expone
  `userC` (Marta, receptora de `settlementId`) y `rejectedSettlementId` (Lucía → Álvaro, 15 €). Con el tope en Editar pago, el e2e S-09
  ya no llega al 409 SETTLEMENT_EXCEEDS_DEBT: comprueba el error en línea.

## 2026-10-20 · CF-13 Entradas a Saldar deuda: Análisis, aviso de rechazo y pendientes en archivados
- Corregido: tarjeta activa del carrusel con `rejectedNote` ("Álvaro no recibió tu pago de 15,00 €" → `/settle/{id}`, testid `rejected-note`):
  `findFirst` REJECTED con `fromUserId` = yo y `updatedAt >= rejectedSince` (7 días, el mismo corte que Recientes); Mes > Análisis con
  "Saldar deuda" (`analysis-settle`) bajo el saldo si no es cero, solo en compartido y no ARCHIVED (`settleHref` de `month/page.tsx`);
  Inicio ARCHIVED con `archived-pending` "Hay {n} pagos sin confirmar. El espacio está archivado y ya no se pueden resolver.".
- Pendiente / fuera de alcance: el saldo de Análisis sigue bajo el pliegue (orden del mockup); es saldo "a fin de mes".
- Ficheros: `src/app/dashboard/page.tsx`, `src/components/dashboard/space-carousel.tsx`, `src/components/month/{analysis-view,month-client}.tsx`,
  `src/app/month/page.tsx`, `src/app/api/test/seed/route.ts`, `scripts/ralph/capture.spec.ts`.
- Aprendizajes: `space-archived` lleva ahora un PENDING de 10 € (A → B, fuera del ledger, saldo 0) para ver pagos atascados en un archivado.
  `scrollIntoViewIfNeeded` deja el elemento bajo la barra inferior fija: en `act` usa `el.scrollIntoView({ block: 'center' })`.
  La captura `mes-analisis` ya no es el primer pantallazo de la página: se desplaza hasta "Evolución de tu saldo".

## 2026-10-20 · CF-14 Gestión del espacio: hojas de ciclo de vida y zona de peligro
- Corregido: "Empezar a cerrar cuentas" abre `settle-sheet` ("¿Cerrar las cuentas de {espacio}?" con lo que se bloquea y "Puedes reabrir…") y,
  al confirmar, refresca en sitio y muestra el toast "Estáis cerrando cuentas. Ahora saldad las deudas." + "Ver qué falta" (/close); "Reabrir
  espacio" con subtítulo, `reopen-sheet` y toast; Convertir en grupo con `CriticalActionSheet` reversible=false y toast "{espacio} ya es un grupo";
  Archivar solo en SETTLING (`ArchiveSpaceAction`, sección "Zona de peligro" con Salir): `page.tsx` calcula el motivo ("Falta confirmar N pagos" /
  "Falta saldar N deudas") → CTA "Archivar para siempre" desactivado + "Ver qué falta"; `EqToast` ya no se sale de la pantalla (hace wrap).
- Pendiente / fuera de alcance: orden de miembros inestable con `joinedAt` iguales (servidor).
- Ficheros: `src/app/spaces/[id]/{actions-client,page}.tsx`, `src/components/ui/eq.tsx`, `scripts/ralph/capture.spec.ts`,
  `e2e/spaces/lifecycle.spec.ts`, `e2e/refresh/committed-mutations.spec.ts`.
- Aprendizajes: no exportes helpers de un módulo `"use client"` para usarlos en un server component (se vuelven referencias de cliente):
  déjalos en `page.tsx`. Capturas nuevas `hoja-cerrar-cuentas` y `cerrar-cuentas-toast` (confirma la hoja y espera a `space-action-reopen`).
  testids de hojas de Gestión: `settle-sheet`, `reopen-sheet`, `convert-sheet`, `archive-sheet`.

## 2026-10-20 · CF-15 /close: archivar con la hoja danger en lugar de confirm()
- Corregido: `close-archive` abre `archive-sheet` (`CriticalActionSheet` danger, mismo copy que Gestión, "Archivar para siempre"); CTA desactivado
  con el motivo cuando no se puede archivar; el 409 se pinta en la hoja; al archivar, flash toast "{espacio} archivado. Lo encontrarás en
  Espacios." + `router.push('/dashboard')`; capturas nuevas `cierre-activo` y `cierre-cerrando` (esta con la hoja abierta).
- Pendiente / fuera de alcance: /close sigue ofreciendo archivar en ACTIVE y la pista genérica bajo el botón (CF-16).
- Ficheros: `src/app/spaces/[id]/close/{client,page}.tsx`, `src/app/spaces/[id]/page.tsx`, `src/lib/space-ui.ts`, `scripts/ralph/capture.spec.ts`,
  `e2e/refresh/committed-mutations.spec.ts`.
- Aprendizajes: `archiveBlockReason(pendingPayments, openDebts)` vive ahora en `src/lib/space-ui.ts` (lo usan Gestión y /close); `close/page.tsx`
  le pasa `archiveBlockReason` al cliente en vez de `canArchive`.

## 2026-10-20 · CF-16 /close como checklist de 3 pasos y "Empezar a cerrar cuentas" sin pagos falsos
- Corregido: `/close` = `<ol>` de 3 pasos (`close-step-{n}` con `data-done`, `aria-current="step"`): 1 "Cerrar cuentas" (PATCH SETTLING desde
  `settle-sheet`, toast en sitio; "Reabrir" con `reopen-sheet`), 2 "Saldar deudas" con TODAS las deudas (PENDING + plan `resolveMyDebts` por
  deudor menos lo cubierto por PENDING) y la acción de quien mira, contador `close-progress` "Faltan N"/"Al día", 3 "Archivar para siempre"
  solo en SETTLING con el motivo (`close-archive-reason`). Sin historial CONFIRMED. `close/page.tsx` con `getSessionCtx`.
- Pendiente / fuera de alcance: el endpoint settle-up sigue existiendo y creando PENDING (solo se deja de usar desde la UI).
- Ficheros: `src/app/spaces/[id]/close/{client,page}.tsx`, `src/app/spaces/[id]/actions-client.tsx`, `src/lib/space-ui.ts`,
  `src/app/api/test/seed/route.ts`, `scripts/ralph/capture.spec.ts`, `e2e/spaces/{settle-up,lifecycle}.spec.ts`, `e2e/refresh/committed-mutations.spec.ts`.
- Aprendizajes: testids de /close: `close-debt-row` (mis deudas, "Debes a X"), `close-plan-row` (deudas ajenas o hacia mí), `close-settlement-row`
  (PENDING, `data-status`), `close-amount` en todas. Las consecuencias de cerrar/reabrir viven en `SETTLING_CONSEQUENCES`/`REOPEN_CONSEQUENCES`
  (`space-ui.ts`). Escenario nuevo `group-settling` (Lisboa de 4 en SETTLING, Álvaro OWNER al día, `userC` = Marta acreedora); capturas
  `cierre-cerrando` (sin hoja), `cierre-cerrando-acreedora`, `cierre-al-dia` y `cierre-archivar` (la hoja de archivar). /close tiene ahora
  varios encabezados con "Cerrar": en e2e usa `getByRole('heading', { level: 1, name: /Cerrar/ })`.

## 2026-10-20 · CF-17 Banner de "Cerrando cuentas" con progreso y un único CTA
- Corregido: `SpaceStatusBanner` en SETTLING pinta "Cerrando cuentas · falta 1 deuda / faltan N deudas / estáis al día" (`space-status-progress`)
  y "No se pueden añadir ni editar gastos; sí saldar deudas."; un único CTA: "Saldar deudas →" (`space-status-settle-link`) si quien mira tiene
  saldo abierto; si no, "Ver qué falta →" (`space-status-close-link`, solo registrados) o, con todo saldado y OWNER/ADMIN, "Todo saldado · Archivar →".
  Invitados: solo texto (o Saldar deudas si deben). Inicio y la página del espacio pasan `openDebts`, `myBalanceOpen` e `isGuest`.
- Pendiente / fuera de alcance: el recuento son deudores con saldo abierto (misma regla que el motivo de archivar), no las filas de /close
  ("Faltan N" allí incluye pagos PENDING por separado).
- Ficheros: `src/components/space/space-status-banner{,.test}.tsx`, `src/app/dashboard/page.tsx`, `src/app/spaces/[id]/page.tsx`,
  `e2e/spaces/lifecycle.spec.ts`, `scripts/ralph/capture.spec.ts`.
- Aprendizajes: captura nueva `inicio-cerrando-al-dia` (group-settling en Inicio: OWNER al día → "Ver qué falta"). Los tests jsdom de
  componentes de servidor sin hooks (como el banner) se renderizan tal cual con `@testing-library/react`.

## 2026-10-20 · CF-18 Quitar miembro y cambiar rol con confirmación
- Corregido: "Quitar a X del espacio" (solo con saldo ≤ 1 céntimo) abre `remove-sheet` (`CriticalActionSheet` danger, "¿Quitar a X?", CTA
  "Quitar a X") y el 409 HAS_BALANCE se pinta con `settleUrl`; con saldo, `member-balance-block` "X debe N en este espacio" / "A X le deben N"
  con "Recordarle la deuda a X" (`member-remind`, share/portapapeles) y "Saldar deuda" (`member-settle`) si quien gestiona es su acreedor/deudor;
  rol OWNER con confirmación en línea (`owner-confirm`, "Hacer propietaria a X"); separador Rol/acción; toasts "X ahora es {rol}" / "X ya no está en {espacio}".
- Pendiente / fuera de alcance: deshacer al quitar (necesita endpoint restore).
- Ficheros: `src/components/space/member-list.tsx`, `src/app/spaces/[id]/page.tsx`, `src/app/api/test/seed/route.ts`,
  `scripts/ralph/capture.spec.ts`, `e2e/spaces/manage.spec.ts`.
- Aprendizajes: `SpaceMember.pairCents` = lo que quien mira salda con ese miembro en el plan simplificado (`resolveMyDebts` en los dos
  sentidos; + me debe, − le debo), calculado en `spaces/[id]/page.tsx`. `ux-showcase` tiene ahora a Sergio en Lisboa (saldo 0, 5 personas).
  `espacio-detalle-grupo` se captura con la hoja de Lucía abierta; `hoja-quitar-miembro` abre la de Sergio y pulsa `member-remove`.

## 2026-10-20 · CF-19 Salir del espacio con la deuda visible antes
- Corregido: `spaces/[id]/page.tsx` precarga mi saldo, acreedores (`resolveMyDebts`), mi último PENDING saliente, `lastOwner` y `lastPerson`;
  `LeaveSpace` con `CriticalActionSheet`: con saldo "Antes de salir, salda tu deuda" + "Saldar deuda" (primario → settleUrl) y "Salir sin saldar"
  (texto rojo) → segundo paso danger con casilla `leave-ack` antes de `?force=1`; PENDING propio con "Pedirle que lo confirme" (`leave-pending`);
  LAST_OWNER → "Elegir persona propietaria" (cierra, scroll a `#members-title` y pulsa el primer `[data-owner-candidate]` de `MemberList`);
  última persona avisada; flash toast "Has salido de {espacio}. Tu historial se conserva."; los 409 se siguen manejando (cambian la hoja).
- Pendiente / fuera de alcance: campo `pendingCents` en el 409 (API); orden de miembros con `joinedAt` iguales.
- Ficheros: `src/components/space/{leave-space,leave-space.test,member-list}.tsx`, `src/app/spaces/[id]/page.tsx`,
  `scripts/ralph/capture.spec.ts`, `e2e/spaces/manage.spec.ts`, `scripts/ralph/findings/CF-19.md`.
- Aprendizajes: el `title` de `CriticalActionSheet` va en el `Sheet`, fuera del `data-testid`: en e2e búscalo con
  `getByRole('dialog' | 'alertdialog', { name })`. En jsdom el `<dialog>` cerrado oculta roles: usa `{ hidden: true }` o testids.
  Capturas nuevas `hoja-salir-con-deuda` y `hoja-salir-sin-saldar` (ux-showcase, asUserB, Casa).

## 2026-10-20 · CF-20 Invitaciones: generar nuevo, desactivar, atajo a convertir, nota de invitados y bienvenida
- Corregido: "Generar nuevo" abre `regenerate-sheet` ("¿Crear un enlace nuevo?", CTA "Crear enlace nuevo"); comprueba `res.ok` del DELETE
  (404 = ya desactivado, cuenta como hecho) y si falla no crea otro ("No se pudo desactivar el enlace anterior…"); toast "Enlace nuevo listo. El
  anterior ya no funciona." + "Enviar"; `InviteManager` sin `confirm()`: `revoke-sheet` danger "¿Desactivar este enlace?" + "Desactivar enlace" +
  toast "Enlace desactivado"; filas "Creado hoy/ayer/el {día} · …" sin truncar; "Desactivado"/"Desactiva los que ya no uses"; pareja completa con
  `invite-convert` (hoja de CF-14) y, para MEMBER, "Solo {X} puede convertirla en grupo…"; `/i/[token]` con "Tu acceso termina cuando acabe el
  viaje." solo en enlaces de invitado de un EPHEMERAL con el flag; `ClaimButton` deja el flash toast "Ya estás en {espacio}"; capturas nuevas
  `hoja-generar-enlace`, `espacio-invitaciones`, `hoja-desactivar-enlace`; e2e nuevo de pareja completa + unirse.
- Pendiente / fuera de alcance: "Convertir en grupo" sale en Invitaciones y en Gestión (lo pide la spec).
- Ficheros: `src/components/space/{space-invite-card,invite-manager}.tsx`, `src/app/spaces/[id]/{page,actions-client}.tsx`,
  `src/app/i/[token]/{page,claim-button}.tsx`, `scripts/ralph/capture.spec.ts`, `e2e/spaces/manage.spec.ts`.
- Aprendizajes: una acción que el servidor deja de pintar tras `router.refresh()` pierde su toast; móntala en un hueco estable con `visible`
  (aquí `reasonAction` de `InviteManager`, que se pasa mientras el espacio está ACTIVE). El POST de invitaciones exige `expiresAt` en los e2e.
  Las capturas no resetean la BD entre pantallas del mismo escenario: Lisboa acumula enlaces (usa `.first()`). `DELETE …/invites` da 404 si ya
  estaba desactivado. e2e de invitaciones: `e2e/spaces/manage.spec.ts`, `e2e/api/invites.spec.ts`, `e2e/guest/guest-security.spec.ts`.

## 2026-10-20 · CF-21 Eliminar gasto con alertdialog, importe, efecto y recurrencia
- Corregido: `DeleteExpenseButton` usa `CriticalActionSheet` danger (`expense-delete-sheet`): "¿Eliminar «X» de N €?", efecto en el saldo
  en negrita ("Lucía dejará de deberte…", "Dejarás de deber … a X", personal, "Tu saldo no cambia…", >3 deudores resumidos), aviso de deuda ya
  saldada en compartidos, aviso + CTA "Eliminar y detener recurrencia" si es plantilla activa, "No se puede deshacer."; flash toast en Gastos
  "Gasto «X» eliminado · saldo actualizado" + "Saldar deuda" (/settle?space=) en compartidos. Captura nueva `hoja-eliminar-gasto`.
- Pendiente / fuera de alcance: Deshacer (borrado lógico en la API).
- Ficheros: `src/components/expense/{delete-button,delete-effect,delete-effect.test}.ts(x)`, `src/app/expense/[id]/page.tsx`,
  `scripts/ralph/capture.spec.ts`, `e2e/expenses/edit-delete.spec.ts`.
- Aprendizajes: ya no existe `Expense.isRecurring`: una plantilla recurrente se detecta con `templateForSeries: { select: { isActive } }`.
  El testid `expense-delete-confirm` desaparece: en e2e pulsa `getByRole('button', { name: 'Eliminar gasto' })` dentro del alertdialog.
  Ojo con `getByText('X')` tras un flash toast que contiene X: usa `{ exact: true }`.

## 2026-10-20 · CF-22 Editar y promover un gasto compartido: consecuencia visible en el saldo
- Corregido: `PromoteButton` usa `CriticalActionSheet` (`expense-promote-sheet`): "¿Compartir «X» con {espacio}?", importe, "Lucía pasará a deberte
  6,20 €" (o "Pasarás a deber…"; >3 resumidos), reparto igual/por productos y "Dejará de ser privado"; `expense/[id]/page.tsx` calcula el reparto con
  `calculateSplitAmountsFromLines` sobre los miembros del grupo activo (lo mismo que `/share`). Editar compartido: `expense-edit-effect` bajo "Guardar
  cambios" con "Al guardar, el saldo con {X|el grupo} cambia en N a tu favor/en tu contra. Si ya saldasteis, puede volver a quedar deuda.".
- Pendiente / fuera de alcance: en grupos no se avisa si solo cambia el saldo entre otras personas.
- Ficheros: `src/components/expense/{promote-button,share-effect,share-effect.test}.ts(x)`, `src/components/expense/add/add-expense-client.tsx`,
  `src/components/ui/critical-action-sheet.tsx`, `src/app/expense/[id]/page.tsx`, `src/app/api/test/seed/route.ts`, `scripts/ralph/capture.spec.ts`.
- Aprendizajes: `CriticalActionSheet` acepta `confirmTestId` (por defecto `confirm-sheet-confirm`). `ux-showcase` tiene ahora un gasto personal de
  Álvaro ("Farmacia", 12,40 €, `personalExpenseId`). Capturas nuevas `hoja-compartir-gasto` y `editar-gasto-efecto` (numpad por testid `numpad-del`/`numpad-8`).
  El delta de mi saldo en el formulario = `balanceDelta(payerId, userId, split.shares, totalCents)` (`quick-split.ts`).

## 2026-10-20 · CF-23 Listas: borrar los tachados con hoja, efecto de "Terminar y apuntar gasto", eliminar lista y producto
- Corregido: menú "Borrar los tachados (N)" → `ClearCheckedSheet` (`CriticalActionSheet` danger, "¿Borrar N productos tachados?", "Se quitarán de la lista
  para todo el espacio. Los pendientes no cambian.", CTA "Borrar N productos", toast "N productos borrados" sin Deshacer); línea `finish-effect` encima del CTA
  ("Quita de la lista los N productos tachados" / "Tacha lo que cojas para terminar"); `DeleteListSheet` danger con conteo y alcance, CTA "Eliminar lista" y flash
  toast "Lista «X» eliminada"; eliminar producto sin modal con toast "«X» eliminado" + Deshacer (POST con nombre, cantidad, unidad, nota y pasillo; PATCH checked si
  estaba tachado). Toast de Listas pasa a `EqToast` (acepta `className` para subirlo sobre el CTA). Captura nueva `hoja-borrar-tachados`.
- Pendiente / fuera de alcance: Deshacer de los tachados (restauración en la API). El toast en SETTLING sigue diciendo "Carro vaciado…" (lo afirma lifecycle.spec.ts:36).
- Ficheros: `src/components/shopping/lists-hub.tsx`, `src/components/ui/eq.tsx`, `scripts/ralph/capture.spec.ts`, `e2e/shopping/ui.spec.ts`, `scripts/ralph/findings/CF-23.md`.
- Aprendizajes: `clearChecked` devuelve ahora `string | null` (error) para pintarlo en la hoja; `finish` lo muestra como toast. `EqToast` admite `className` (twMerge
  sobreescribe `bottom-*`). El POST de items acepta `aisle: null` explícito (no autoasigna) pero no `checked`. `lists-prefilled`: Mercadona con Plátanos y Pollo tachados.

## 2026-10-20 · CF-24 Etiquetas y categorías: hojas propias y choque de presupuesto resoluble
- Corregido: `/tags` sin `confirm()`: papelera de 44 px → `CriticalActionSheet` danger (`tag-delete-sheet`) "¿Eliminar la etiqueta «X»?" con texto común/personal,
  CTA "Eliminar etiqueta" y toast "Etiqueta «X» eliminada"; muestras de color a 44 px. `DeleteCategoryModal` es ahora la hoja danger (`category-delete-sheet`):
  "¿Eliminar la categoría «X»?", "Los gastos, gastos recurrentes y presupuestos…", select "Mover a", CTA "Eliminar y mover a «destino»"; 409 `BUDGET_CONFLICT`
  (por `json.code`) → `category-budget-conflict` con "Elegir otro destino" (foco en el select) e "Ir a Presupuestos" (`/month?view=budget[&scope=personal]`).
  Filas de `/categories`: el nombre es el botón "Editar X", ⋯ "Más opciones de X" (Editar/Subir/Bajar/Duplicar/Eliminar), papelera "Eliminar X" y "Duplicar X" de 44 px.
- Pendiente / fuera de alcance: conteos de uso y `periodStart` en el 409 (API); radios de `ScopeRadio` de 40 px.
- Ficheros: `src/app/tags/client.tsx`, `src/app/categories/client.tsx`, `src/components/category/delete-category-modal{,.test}.tsx`,
  `src/app/api/test/seed/route.ts`, `scripts/ralph/capture.spec.ts`, `e2e/features/organize.spec.ts`, `scripts/ralph/findings/CF-24.md`.
- Aprendizajes: `ux-showcase` tiene ahora la categoría propia "Mascotas" en Casa con presupuesto del mes (moverla a "Compras" da BUDGET_CONFLICT) y
  etiquetas Vacaciones/Cumpleaños/Coche (comunes) y Gimnasio (personal de Álvaro). La opción de Compras en el select es "🛍️ Compras".
  Capturas nuevas `categorias`, `hoja-eliminar-categoria`, `etiquetas`, `hoja-eliminar-etiqueta`. e2e de Organizar: `e2e/features/organize.spec.ts`
  y `financial-features.spec.ts` (busca el botón "Editar {categoría}"). No metas `<p>`/`<div>` dentro de un `<button>`: usa `<span className="block">`.

## 2026-10-20 · CF-25 Desglose de ticket y foto: deshacer local y toques de 44 px
- Corregido: borrar una línea deja `receipt-line-removed` ("«X» eliminada · el total baja a N €" / "Sin desglose: el importe se queda en N €") con
  Deshacer que la reinserta en su posición (estado local del editor); papelera 44×44 separada del selector ½/Yo/{inicial}, que también pasa a 44×44;
  "Quitar" → "Quitar foto" (`min-h-11`, `--negative-ink`) y, si la foto estaba guardada, `receipt-photo-removed` "La foto se borrará del gasto al guardar"
  + Deshacer (acción `receiptRestored`, campo `discardedReceiptUrl`; elegir otra foto lo limpia). Test jsdom nuevo `receipt-items-editor.test.tsx`.
- Pendiente / fuera de alcance: campos de cantidad/precio de 16 px; chips de etiqueta de 26 px.
- Ficheros: `src/components/expense/add/{receipt-items-editor,receipt-items-editor.test,expense-more-options,expense-form-state,expense-form-state.test}.ts(x)`,
  `src/app/api/test/seed/route.ts`, `scripts/ralph/capture.spec.ts`.
- Aprendizajes: oxlint exige `<output>` en vez de `role="status"`. "Farmacia" (`personalExpenseId`) tiene ahora foto (`/icon-192x192.png`, de `public/`) y dos
  líneas (Ibuprofeno 3,90 + Crema solar 8,50): captura nueva `editar-gasto-ticket`; `anadir-gasto-opciones` añade una línea vacía para medir la papelera.

## 2026-10-20 · CF-26 Ajustes: aviso del token, cerrar todas las sesiones en rojo, aviso en el login y exportar
- Corregido: hoja del token "Trátalo como una contraseña: … durante 90 días. Generar otro no desactiva este…" + botón "Cerrar sesión en todos los dispositivos"
  que abre la revocación; cerrar sin copiar pide confirmación en línea (`mcp-close-unsaved`, "Volver" / "Cerrar sin copiar"; `mcpCopied` ya no se resetea).
  En "Cuenta": "Cerrar sesión" neutro y "Cerrar sesión en todos los dispositivos" en `--negative-ink`, sin chevron, con "También desconecta Hermes y otros clientes MCP".
  `RevokeSessionsSheet` → `CriticalActionSheet` danger (`revoke-sessions-sheet`, CTA "Cerrar todas las sesiones") → `/login?signedOut=all`; `LogoutButton` comprueba
  `res.ok`, "Cerrando sesión…" + `aria-busy`, error en línea → `/login?signedOut=1`; el login pinta el aviso en `<output>` (`login-signed-out`). Exportar: "{espacio} ·
  gastos compartidos y tu parte". `docs/design/README.md` (MCP revocable por tokenVersion). Capturas nuevas `ajustes-revocar` y `login-sesiones-cerradas`.
- Pendiente / fuera de alcance: lista de tokens MCP activos y revocación uno a uno (API).
- Ficheros: `src/app/settings/settings-client.tsx`, `src/app/login/page.tsx`, `src/components/auth/logout-button.tsx`, `docs/design/README.md`,
  `e2e/features/settings.spec.ts`, `scripts/ralph/capture.spec.ts`, `scripts/ralph/findings/CF-26.md`.
- Aprendizajes: `getByRole('button', { name: 'Cerrar' })` sin `exact` casa con cualquier "Cerrar sesión…": usa `exact: true`. `POST /api/mcp` con un token revocado
  da 401 (sirve para comprobar la revocación en e2e). `LogoutButton` solo se usa en Ajustes y ahora va envuelto en un `<div>` (su error no rompe los separadores de `Section`).

## 2026-10-20 · CF-27 Admin: anular invitación con consecuencia y separar las caducadas
- Corregido: "Eliminar" en línea → papelera "Anular invitación {code}" que abre `CriticalActionSheet` danger (`invite-void-sheet`) "¿Anular la invitación {code}?"
  ("El enlace de registro que hayas enviado dejará de funcionar…"; para una caducada "Ya ha caducado…"), CTA "Anular invitación", error dentro de la hoja y toast
  "Invitación anulada". Caducadas (`expiresAt < ahora`) en su grupo "Caducadas" ("Caducó el X"), sin copiar y fuera de Disponibles (contador incluido).
  Cabecera "Enlaces para crear una cuenta en EQUIL. Cada enlace sirve una vez y caduca a los 7 días."; botón con texto "Copiar enlace"/"Copiado"; fechas sin año.
- Pendiente / fuera de alcance: nada (la Server Action `deleteInviteAction` y sus mensajes no se tocan).
- Ficheros: `src/app/admin/admin-invites{,.test}.tsx`, `e2e/features/admin.spec.ts` (nuevo), `src/app/api/test/seed/route.ts`, `scripts/ralph/capture.spec.ts`,
  `scripts/ralph/findings/CF-27.md`.
- Aprendizajes: `ux-showcase` devuelve ahora `admin` (Sergio, `isAdmin`) con 2 invitaciones libres, 1 caducada y 1 usada por Pablo (códigos aleatorios: busca por
  `/^Anular invitación /`). Capturas `admin` y `hoja-anular-invitacion` (`as: (d) => d.admin`). No había e2e de la pantalla `/admin`: `e2e/features/admin.spec.ts`
  usa el escenario `admin-with-invite` (invitación sin caducidad). En los tests jsdom de una página con Server Actions, `vi.mock('./actions')` + `await import()` evita cargar Prisma.

## 2026-10-20 · CF-28 MCP, comentarios y barrido final de vocabulario
- Corregido: descripciones MCP de `create_settlement` ("Saldar deuda", pago PENDING, confirmar importe y receptor con el usuario)
  y `confirm_settlement` ("Lo he recibido"/"No lo he recibido", rechazar deja la deuda pendiente, confirmar antes);
  prompt `settle_up_guide` (solo confirma quien recibe, `toUserId`, confirmación antes de cada llamada); comentarios
  "Quedar en paz" → "Saldar deuda"; AGENTS.md: ARCHIVED es terminal, solo SETTLING se reabre y se muestra "Cerrando cuentas".
- Pendiente / fuera de alcance: el grep de vocabulario aún encuentra el glosario de `docs/ux/plan-acciones-criticas.md`
  (enumera lo retirado) y los mockups `docs/design/EQUIL *.dc.html` (fuente congelada del diseño).
- Ficheros: `src/mcp/tools/finance.ts`, `src/mcp/resources-prompts.ts`, `AGENTS.md`, `src/app/api/settle/route.ts`,
  `src/components/settle/settle-model.ts`, `src/lib/settlement-{rules,service}.ts`, `e2e/settlements/rules.api.spec.ts`.
- Aprendizajes: el ciclo de vida real está en `ALLOWED_TRANSITIONS` de `src/lib/space-policy.ts` (ARCHIVED → []);
  los tests de `src/mcp` no afirman el texto de las descripciones, así que cambiarlas no rompe nada.

## 2026-10-20 · RV-01 /settle: hoja tras 409, importe de la deuda al rechazar, sin prometer avisos
- Corregido: un 409 de regla (`StaleError`) cierra la hoja de `/settle` y pinta el error fuera (`settle-error`, también en la pantalla "al día");
  rechazo "La deuda de {owedCents} seguirá pendiente…" (sin cifra si es 0); sin avisos falsos: hoja "X lo verá en Pagos por confirmar la próxima vez que entre."
  y éxito "Pago a X · por confirmar" con "Pedirle que lo confirme" como CTA principal; "Deuda saldada"/"ya no te deberá nada" solo si el saldo neto del receptor
  llega a 0 (`incomingOutcome` en `settle-model.ts`; `PendingPaymentSheet` y `PendingSettlements` reciben `balanceCents`).
- Pendiente / fuera de alcance: nada.
- Ficheros: `src/app/settle/client.tsx`, `src/app/settle/[id]/page.tsx`, `src/app/dashboard/page.tsx`, `src/components/settle/{settle-review-sheet,settlement-actions,settle-model,settle-model.test}.ts(x)`,
  `src/components/dashboard/pending-settlements.tsx`, `e2e/settlements/{partial-and-scope,create-and-confirm}.spec.ts`, `e2e/spaces/settle-up.spec.ts`,
  `e2e/refresh/committed-mutations.spec.ts`, `scripts/ralph/findings/RV-01.md`.
- Aprendizajes: el deudor puede editar su PENDING con `PATCH /api/settle/{id}` `{ amount }` (euros), útil para provocar 409 SETTLEMENT_CHANGED en e2e.
  `owedCents` (resolveMyDebts) es la deuda por pareja del plan voraz, no el saldo: para "saldada" usa el saldo neto del receptor.

## 2026-10-20 · RV-02 Coherencia de saldos: tope de edición, rechazo, /close y bloqueo de archivado
- Corregido: `/settle/[id]/edit` limita con `settlementCap` (la regla de `pairCap`); `owedCents` pasa a ser la deuda real del pagador
  (`debtOf` en `settle-model.ts`, −saldo neto) en Inicio, `/settle` (prop `debts`) y `/settle/[id]` (rechazado: «Tu deuda de X sigue pendiente» + «Saldar deuda»);
  `/close` aplica los PENDING a los saldos antes del plan (`closePlan`); bloqueo de archivar con `openDebtCount` (cualquier saldo abierto, como
  `assertCanArchive`) y banner «Cerrando cuentas · faltan N» con `closeItemCount` (= «Faltan N» de `/close`; Inicio y Gestión cargan los PENDING).
- Pendiente / fuera de alcance: nada. `RecordSettlementSheet` de `/settle` sigue topando con la sugerencia del plan (es la propuesta, no un PENDING existente).
- Ficheros: `src/lib/close-plan{,.test}.ts` (nuevo), `src/components/settle/settle-model{,.test}.ts`, `src/app/settle/{page,client}.tsx`,
  `src/app/settle/[id]/{page,edit/page}.tsx`, `src/app/spaces/[id]/{page,close/page}.tsx`, `src/app/dashboard/page.tsx`,
  `src/components/{dashboard/pending-settlements,settle/settlement-actions,settle/settle-review-sheet}.tsx`, `scripts/ralph/findings/RV-02.md`.
- Aprendizajes: `resolveMyDebts` es el plan voraz (propuesta), no la deuda: para topes usa `settlementCap` (`settlement-rules.ts`, puro) y para «sigue
  debiendo» `debtOf`. Todo recuento de «qué falta» al cerrar sale de `src/lib/close-plan.ts`. e2e de cierre: `e2e/spaces/{lifecycle,settle-up}.spec.ts`.
