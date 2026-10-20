# Ralph · progreso UX/UI

## Patrones del código

- Capturas: `SCREENS=<ids> mise run ux:capture` (resetea la BD de test y arranca su propio Next;
  sin `mise run dev` a la vez). Ids y escenarios en `scripts/ralph/capture.spec.ts`.
- Referencias del diseño elegido: `scripts/ralph/design/*.png` (`mise run ux:design` las regenera
  desde `docs/design/EQUIL Rediseño.dc.html`).
- Datos de las capturas: escenario `ux-showcase` en `src/app/api/test/seed/route.ts`
  (Álvaro y Lucía en "Casa", viaje "Lisboa" de 4, presupuestos y lista "Mercadona").
- Sin docker en esta máquina: `CONTAINER_ENGINE=podman mise run services:up`.

## Iteraciones
