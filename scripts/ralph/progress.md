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
