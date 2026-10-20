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
