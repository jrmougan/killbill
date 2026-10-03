# QA: cierre de la ola de UI de Fase 3

Trabajo recuperado de las sesiones abiertas de Kimi y Antigravity entre el 2 y el 3 de octubre de 2026. Kimi agotó su cuota antes de entregar el resultado; se conservaron y validaron sus archivos. Antigravity terminó los selectores del flujo de listas y quedó en reposo durante la integración.

## Cobertura entregada

17 escenarios nuevos, ejecutados en `chromium` y `mobile-chrome` (34 ejecuciones adicionales; suite total de 118):

| Spec | Escenarios | Resultado que comprueba |
| --- | ---: | --- |
| `e2e/expenses/edit-delete.spec.ts` | 4 | Edición de importe y pagador, borrado y promoción de gasto personal; saldos de ambos usuarios. |
| `e2e/guest/guest-cycle.spec.ts` | 4 | Banner y navegación guest, restricciones del proxy, creación de gasto efímero y conversión a cuenta completa. |
| `e2e/spaces/lifecycle.spec.ts` | 4 | Cierre, reapertura desde SETTLING, archivo y permisos de MEMBER; bloqueo de nuevos gastos. |
| `e2e/spaces/settle-up.spec.ts` | 3 | Liquidaciones PENDING, confirmación a saldo cero e idempotencia de sugerencias y confirmaciones. |
| `e2e/shopping/ui.spec.ts` | 2 | Lista común: añadir, marcar y vaciar comprados; lista personal: crear. Operar listas no crea gastos ni modifica el saldo. |

Los cambios de instrumentación en gastos, invitados y espacios añaden atributos `data-testid` y `data-status`. Cada escenario resetea su base de datos; no se añadieron esperas de tiempo fijo ni casos omitidos.

## Hallazgos resueltos

- Los nombres de los artículos pueden incluir el emoji del pasillo: los selectores exactos de texto de la primera versión del test de listas no encontraban los artículos. Se ajustaron los selectores y se verificaron las cuatro ejecuciones.
- Las fechas de liquidación usaban el locale implícito del servidor y del navegador. Con navegador `es-ES`, React detectaba `10/2/2026` frente a `2/10/2026`. Se fijaron `es-ES` y `Europe/Madrid` en `/settle`, las liquidaciones del listado de movimientos y el panel de pagos pendientes.
- El flujo existente de creación de liquidación captura ahora `pageerror` en los contextos del pagador y del acreedor. La nueva aserción falló antes del arreglo y pasó después: el gate detecta esta regresión aunque los importes y las operaciones sigan funcionando.
- Con el build standalone, reabrir un espacio podía dejar la pantalla en SETTLING después de un PATCH exitoso. Se reprodujo en 3 de 10 repeticiones; las trazas mostraron ACTIVE tanto en la respuesta del PATCH como en el payload del refresco. Las acciones de gestión recargan ahora la página tras la mutación para aplicar el estado confirmado. Esto implica una recarga completa al convertir, cerrar, reabrir o archivar desde esa pantalla.
- La ejecución completa de standalone encontró la misma vista obsoleta al iniciar el settle-up y confirmar un pago. El panel de cierre y el de pagos pendientes recargan igualmente tras una respuesta exitosa; archivar desde el panel de cierre navega al dashboard mediante una carga completa. No se cambiaron las aserciones ni se introdujeron retries para ocultar estas incidencias.
- El helper de settle-up conserva el JSON de la respuesta real mediante `route.fetch()` antes de entregarla al navegador con `route.fulfill()`: Chromium puede descartar el cuerpo de una respuesta al recargar el documento. Las comprobaciones del contrato de la API y del estado de la UI permanecen completas.
- La promoción de un gasto personal mostró la misma incidencia en móvil: el POST guardaba SHARED, pero la página conservaba el detalle privado. Tras compartir se recarga también el detalle confirmado con su reparto.

## Validación

- `mise run check`: lint y 435 tests unitarios, 39 archivos, en verde.
- `mise run build`: build de producción y comprobación de tipos en verde.
- `mise run e2e -- --reporter=line`: 118 ejecuciones en verde, 3 minutos, contra el MySQL local aislado del worktree.
- Tras corregir la hidratación, los specs de liquidaciones y settle-up: 10 ejecuciones en verde, sin errores de hidratación, 39,1 segundos.
- Tras corregir el refresco de espacios, reapertura repetida cinco veces en cada viewport contra standalone: 10 ejecuciones en verde, 24,6 segundos, sin retries.
- Validación final del código entregado contra el build standalone, con todos los arreglos: `HOSTNAME=127.0.0.1 CI=true mise run e2e -- --reporter=line --retries=0`, **118/118 en verde**, 1,6 minutos, sin errores de hidratación ni reintentos. `HOSTNAME` fija el bind local del servidor standalone en esta máquina.

## Alcance pendiente del roadmap

Esta entrega cierra las tareas de esta ola de los agentes; no declara terminado todo el plan de QA. El punto 12 de las revisiones también propone un happy path UI por cada feature CRUD: categorías, presupuestos, etiquetas e importación/exportación conservan aquí su cobertura API, sin nuevos flujos UI en esta ola. Quedan asimismo el piloto visual de la Fase 4 y el experimento de exploración agéntica; ninguno se ha añadido al gate con esta entrega.

La validación usa proveedores OCR falsos y el MySQL local; no prueba OCR real ni el despliegue remoto. No hay cambios de esquema, migraciones ni escrituras en producción.
