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
- Enlaces de texto en cabeceras: `-my-2.5 min-h-11 flex items-center` da 44 px sin cambiar la altura de la fila.

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
