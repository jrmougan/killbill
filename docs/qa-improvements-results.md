# Mejoras de QA — equipo de agentes

Fecha: 2026-10-03. Trabajo coordinado con tres agentes Orca sobre el mismo
checkout, con propiedad separada de archivos y un único ejecutor de build/E2E.

## Actualización de las vistas

Next.js pasa de 16.2.9 a 16.3.8 estable, fijado en package.json y package-lock.
Las cuatro superficies afectadas vuelven a usar navegación/refresh del router;
los controles permanecen bloqueados durante la transición para evitar acciones
sobre props antiguas. Las regresiones comprueban estado, importes y conservación
del documento; una recarga completa no puede hacerlas pasar.

El experimento de control con refresh directo y Next 16.2.9 produjo 6 fallos en
20 ejecuciones. Una segunda tanda con reset por caso produjo 3 fallos en 12.
Las trazas mostraron respuestas API y RSC con ACTIVE mientras la cabecera seguía
en SETTLING. Con 16.3.8, el primer experimento equivalente pasó 20/20, incluidos
100 cambios consecutivos de ciclo de vida. Esta comparación local sustenta la
actualización; no implica que una incidencia externa confirme oficialmente la
causa. Las trazas experimentales se conservaron en /tmp/killbill-refresh-baseline-evidence.

## Organización y detección de fallos

- Los contratos CRUD, invitaciones, MCP y listas se ejecutan una vez en `api`.
  El login mediante Server Action sigue usando el navegador como preparación.
- Los flujos UI, incluida autorización con navegación real del invitado, se
  ejecutan en escritorio y móvil.
- El fixture común registra errores no controlados a nivel de BrowserContext:
  pestañas, popups y sesiones manuales cerradas conservan sus errores hasta el
  teardown. `newContext` hereda las opciones del proyecto.
- CI falla ante resultados flaky. El resumen conserva cada intento fallido y
  los artefactos incluyen las primeras trazas/capturas y el HTML sin servidor
  automático. Siete pruebas independientes verifican guard, reporter y config.

## Cobertura y corrección de presupuestos

Las nuevas invariantes financieras cubren grupos de 2 a 20 miembros, restos de
céntimos, asignación exclusiva de artículos, cambios de repartos, conservación
de suma cero y pagos parciales. Un doble persistente del ledger verifica que
republicar gastos, editar y repetir pagos reemplaza apuntes sin duplicarlos.

Tres recorridos UI cubren presupuestos, categorías compartidas/personales y
la importación CSV con exclusiones y repetición idempotente. Comprueban importes
exactos y aislamiento de los datos personales.

La prueba de presupuestos descubrió un error de unidades: las props del servidor
estaban en euros y GET /api/budget devolvía céntimos. Tras crear, editar o cambiar
ámbito, el cliente mostraba importes multiplicados por 100. La carga de la API
normaliza amount y spent a euros. Los controles de icono ahora tienen nombres
accesibles.

## Validación integrada

- `mise run check`: Prisma generate y lint correctos; 41 archivos, 442 tests pasan.
- `mise exec -- npx vitest run --config e2e/fixtures/vitest.config.ts`:
  3 archivos, 7 tests pasan.
- `TEST_ROUTES_ENABLED=true EPHEMERAL_SPACES_ENABLED=true mise run build`:
  build de producción correcto con Next 16.3.8.
- `HOSTNAME=127.0.0.1 CI=true mise run e2e -- --reporter=line --retries=0`:
  **117/117 pasan en 2,0 minutos**, sin reintentos: 17 contratos API y 50 casos
  de interfaz por pantalla. Log local: /tmp/killbill-team-e2e.log.
- La corrección final de refresh pasa además 50 repeticiones de sus cinco
  regresiones en escritorio/móvil y 24 casos existentes relacionados.
- `git diff --check` correcto. Los tres agentes terminaron correctamente y sus
  terminales fueron liberados; no quedan trabajadores pendientes de recoger.

La matriz authz mezcla contratos y navegación real del invitado, por lo que se
conserva completa en ambas pantallas. No se ha ejecutado GitHub Actions remoto
ni desplegado. El doble persistente comprueba reintentos secuenciales; no prueba
contención simultánea contra una base real. La comparación de Next demuestra
la corrección del fallo observado, sin identificar un commit interno de React.

