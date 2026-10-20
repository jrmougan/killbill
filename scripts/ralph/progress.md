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
