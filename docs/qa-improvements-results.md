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
conserva completa en ambas pantallas. Al cerrar ese incremento aún no se había ejecutado GitHub Actions remoto
ni desplegado. El doble persistente comprueba reintentos secuenciales; no prueba
contención simultánea contra una base real. La comparación de Next demuestra
la corrección del fallo observado, sin identificar un commit interno de React.

## Ampliación: errores, concurrencia y OCR

Segundo equipo de tres agentes, sobre el PR #34.

- Presupuestos: los fallos de POST, red o recarga muestran un error y conservan
  el formulario y el importe. Solo el guardado y lectura correctos cierran el
  formulario; la carga de un ámbito fallida ya no aparece como una lista vacía.
  Los importes deben ser finitos y representar al menos un céntimo.
- Concurrencia: el control contra MySQL reprodujo una pareja con tres miembros
  al aceptar dos enlaces distintos en su última plaza. Las rutas de claim
  (miembros e invitados) y join antiguo toman el mismo bloqueo de fila del
  espacio antes de leer membresías/capacidad. Confirmar un pago simultáneamente
  provocaba un conflicto P2002 del ledger y una respuesta 500; una actualización
  condicionada con updateMany limita el cambio PENDING al ganador y devuelve
  400 al perdedor antes de publicar apuntes.
- OCR: un proveedor HTTP en loopback responde de forma determinista, manteniendo
  reales la autenticación, validación de imagen, parsing, subida, corrección de
  productos/asignaciones y persistencia. El proveedor de prueba exige rutas de
  test, puerto loopback explícito y claves ficticias; no admite redirects.
- Tickets: producción no reindexa public tras subir un archivo nuevo. La ruta
  dinámica /uploads/[filename] permite leerlo inmediatamente, conservando las
  URLs UUID públicas existentes, con whitelist de extensiones, sin traversal y
  con Content-Type/nosniff. La subida crea el directorio de almacenamiento.
- CI detectó hidratación incoherente de fechas con servidor UTC y navegador
  Madrid. ExpenseCard, historial de liquidaciones y caducidad MCP usan ahora
  Europe/Madrid explícita. Una regresión comprueba el cambio de día/mes, y el
  servidor E2E se fija en UTC para reproducir las condiciones de GitHub.

Validación local de la ampliación:

- `mise run check`: lint correcto, **480 tests en 45 archivos** pasan.
- Fixture/reporter/config: **7/7** pasan.
- Build de producción con TZ=UTC y rutas de prueba habilitadas: correcto.
- Suite integrada sin reintentos: **126 casos pasan** y seis casos nuevos de
  presupuestos fallan por un selector ambiguo que incluía el route-announcer de
  Next. Tras limitarlo al landmark main, los **6/6 casos de presupuestos pasan**
  sin reintentos. Quedan validados los 132 casos: 24 API y 54 UI por pantalla.
- Concurrencia aislada: **18/18 ejecuciones**, 90 carreras contra MySQL, pasan
  sin reintentos; no sobrepasar cupos/usos, no usuarios huérfanos ni dinero doble.
- OCR: la imagen se recupera por HTTP byte a byte después de subirla al servidor
  standalone ya arrancado; gasto 847 céntimos, repartos 461/386 y saldos ±386.
- Los tres agentes terminaron correctamente y sus terminales fueron liberados.

Los checks remotos del nuevo commit se consultarán tras actualizar el PR. Las
pruebas de carreras cubren las solicitudes simultáneas descritas; no simulan
fallos de red entre commits ni carreras de cambio de estado del espacio.
