# Revisión crítica del plan de QA

## 1) Valoración general del plan

El planteamiento por capas es adecuado, pero lo aprobaría con cambios antes de ampliar la suite. La prioridad inmediata debe ser que el verde actual signifique algo: aislamiento verificable, aserciones de resultados económicos exactos y evidencias de CI. Después añadiría integración HTTP con base de datos real y unos pocos recorridos UI completos; no convertiría cada combinación de permisos y estados en un recorrido de navegador.

Esta revisión se basa en lectura estática del repositorio. No se ha ejecutado ninguna suite, levantado servicios ni modificado código o tests. Las consecuencias de runtime señaladas son hipótesis fundamentadas, no fallos reproducidos.

Hay que corregir el inventario inicial: existen **22 declaraciones `test(...)` en nueve archivos `.spec.ts` de `e2e/`**, no 18. Export no carece totalmente de cobertura: `e2e/expenses/personal.spec.ts` consulta `/api/export` y comprueba que no filtre el gasto personal de otro usuario. Tampoco falta por completo el flujo con dos contextos: `e2e/settlements/create-and-confirm.spec.ts` ya autentica al pagador y al receptor por separado, aunque sus comprobaciones finales son insuficientes. Los tests unitarios también abarcan rutas, autorización, categorías, recurrencias y proveedores OCR, además de matemáticas.

## 2) Puntos con los que estoy de acuerdo y por qué

- **Priorizar dinero, privacidad y estados.** Edición, borrado y confirmación atraviesan persistencia y lectura de balances. `src/app/dashboard/page.tsx` y `src/app/api/spaces/[id]/balance/route.ts` usan `getGroupBalances` de `src/lib/ledger-read.ts`: probar únicamente `finance.ts` no demuestra que las escrituras del ledger y la UI estén conectadas correctamente.
- **Mantener las combinaciones matemáticas en unitarios.** `src/lib/finance.test.ts`, `splits.test.ts` y `ledger.test.ts` son el lugar adecuado para casos de redondeo y distribuciones. Un recorrido integrado con tres miembros y un importe no divisible complementa esa cobertura al verificar transporte, persistencia y representación, sin repetir toda la matriz.
- **Preparar fixtures antes de crecer.** `src/app/api/test/seed/route.ts` ofrece seis escenarios y ya llama a `postExpenseLedger` en los escenarios con deuda. Los nuevos seeds deben conservar esa coherencia, además de crear memberships y categorías válidas; insertar solo Expense y Split produciría balances artificialmente vacíos.
- **Snapshots nativos como punto de partida.** El proyecto ya depende de `@playwright/test` y no contiene aserciones `toHaveScreenshot`. Para unas pocas pantallas, no está justificada inicialmente otra plataforma. Móvil y escritorio tienen sentido: `src/app/layout.tsx` limita el contenido mediante `sm:max-w-md`, por lo que interesa verificar también centrado, bordes, modales y navegación fuera del ancho móvil.
- **Exploración agéntica como fuente de casos reproducibles.** Misiones de usuario pueden detectar secuencias que el diseño de pruebas omitió. Su resultado útil debe ser un hallazgo con pasos, estado inicial, expectativa y evidencia, que después se convierta en regresión automatizada cuando proceda.

## 3) Puntos con los que NO estoy de acuerdo o cambiaría

### El reset necesita una revisión de relaciones, no una lista de tablas añadida a ciegas

`src/app/api/test/reset/route.ts` elimina Split, Expense, Settlement, InviteCode, User y Couple, en ese orden y sin transacción. En `prisma/schema.prisma`, `Account.user` tiene `onDelete: Restrict`; borrar los gastos elimina sus transacciones por cascada, pero no las cuentas creadas por `ensureAccount` en `src/lib/ledger.ts`. Por tanto, los escenarios con ledger pueden impedir `user.deleteMany()` antes de llegar a borrar Couple. `GroupInvite.createdBy` introduce otra dependencia que hay que considerar.

En cambio, Budget, categorías personalizadas y ShoppingList tienen relaciones Cascade hacia su propietario o espacio. Su ausencia textual en el reset **no prueba por sí sola** que siempre sobrevivan. El defecto concreto es no garantizar un estado final limpio ni atomicidad y tener un orden incompatible con determinadas relaciones.

Además, `resetDb` en `e2e/fixtures/db.fixture.ts` ignora el estado HTTP: un 500 no falla el helper. Cambiaría primero ese contrato, después definiría una limpieza transaccional y ordenada del grafo, preservando o reponiendo las categorías de sistema. Como aceptación futura: sembrar cada escenario, resetear, comprobar ausencia de residuos, y repetir reset sin error. No borraría Category indiscriminadamente: la CI ejecuta `db:seed` una vez, y las rutas resuelven categorías desde la base de datos.

### Repararía las aserciones actuales antes de añadir otro settle-up

`e2e/settlements/create-and-confirm.spec.ts` usa `beforeAll` compartido para dos tests que crean liquidaciones. El segundo espera un segundo fijo, recarga y solo exige texto no vacío si el balance resulta visible; incluso puede terminar sin comprobar ningún saldo. El primer caso titula PENDING pero únicamente busca “Liquidación”. Serializar workers no convierte estos casos en independientes ni solventa reintentos.

Usaría escenario propio por test y comprobaría importe y estado concretos: saldos iniciales, PENDING sin efecto contable, confirmación por el receptor autorizado y saldos finales exactos de ambos usuarios. Una reconfirmación no debe volver a contabilizar dinero. El endpoint `/api/spaces/[id]/settle-up`, además, es un flujo distinto al formulario `/settle`: cambia el estado del espacio y genera propuestas solo para el pagador que lo invoca. Debe tener un caso explícito con OWNER/ADMIN deudor y repetición sin duplicados.

### Separaría integración HTTP de recorridos UI

Ya existe el precedente en `e2e/shopping/smoke.spec.ts`: tras login, casi todo el flujo usa `context.request`. Ampliaría esa vía para permisos cruzados, transiciones prohibidas, idempotencia y concurrencia contra la DB real. Mantendría en UI los recorridos que validan formularios, navegación y actualización visible.

Los mocks de `src/app/api/expenses/import/route.test.ts` prueban decisiones del handler, pero no la restricción única ni `createMany({ skipDuplicates: true })` reales. El recorrido CSV debería cargar un fichero, mapear columnas, importar dos veces y comprobar gasto PERSONAL y contadores; las variantes de duplicados, límite de filas y carreras pueden ir por HTTP. También hay que decidir la semántica del fingerprint: `src/app/api/expenses/import/route.ts` considera iguales dos movimientos del mismo usuario con fecha, importe y descripción normalizada iguales, aunque puedan ser cargos bancarios legítimamente distintos.

### Un proyecto Playwright adicional no basta para cambiar el flag del servidor

`playwright.config.ts` arranca un único `webServer` y `src/lib/flags.ts` lee `process.env.EPHEMERAL_SPACES_ENABLED` en el proceso de la aplicación. Separar solo los tests por proyecto no crea automáticamente dos servidores con flags distintos. Recomiendo dos ejecuciones/jobs explícitos, flag apagado y encendido, cada uno con su proceso y DB aislada; o dos servidores con puertos y bases distintas si se justifica la complejidad.

La matriz debe cubrir también flag apagado: creación/entrada guest denegada y conservación del acceso de cuentas ya convertidas. No basta probar todo con el flag encendido. `src/app/api/guest/upgrade/route.test.ts` y `src/app/api/invites/claim/route.test.ts` ya ofrecen un inventario unitario aprovechable.

### Borraría el global setup redundante y no impondría testids indiscriminados

`e2e/global-setup.ts` solo espera una respuesta HTTP; `playwright.config.ts` ya declara `webServer.url`, timeout y `reuseExistingServer: false`. No lo conectaría por mera existencia: eliminarlo reduce duplicación. La preparación de datos corresponde a fixtures con errores visibles, no a otro sondeo del servidor.

La escasez de `data-testid` no es una métrica de mala cobertura. Mantendría `getByRole` y etiquetas accesibles cuando identifican la intención. Añadiría testids únicamente para identidad estable en filas repetidas, balances o controles ambiguos. Sí sustituiría selectores posicionales como `input[type="number"].last()` del test de liquidaciones y esperas temporales por condiciones observables.

### OCR no debe quedar completamente fuera del flujo de usuario

`src/app/expenses/new/page.tsx` envía multipart directamente a `/api/ocr`; la subida persistente por `/api/upload` es otra operación. `src/app/api/ocr/route.ts` valida bytes, formato, tamaño y sesión antes de llamar al proveedor. La descripción “upload → ruta de imagen → OCR” no refleja este recorrido actual.

Propondría una respuesta controlada en la frontera navegador→`/api/ocr` para probar revisión de líneas, asignación, corrección manual y guardado del gasto; esa prueba debe declararse **UI con OCR simulado**, sin afirmar cobertura del handler o del proveedor. `src/lib/receipt-ocr-ai.test.ts` ya comprueba fallbacks y JSON inválido. Para integrar además el handler con un proveedor simulado habría que introducir una frontera de red configurable en servidor: interceptar solicitudes del navegador no intercepta los `fetch` del proceso Next.js. Mantendría cualquier evaluación con proveedores reales fuera del gate de PR.

### Reduciría y estabilizaría primero el piloto visual

Comenzaría por tres o cuatro estados representativos, no diez pantallas multiplicadas inmediatamente por dos viewports. `seed/route.ts` usa `Date.now()`, `Math.random()` y fechas del mes actual; fijar solo el reloj del navegador no estabiliza los datos calculados en servidor.

Hacen falta fechas y datos visibles fijos, zona horaria y locale acordados, versión de navegador/entorno de captura consistente, fuentes e imágenes cargadas y animaciones estabilizadas. Preferiría avatares y fechas deterministas a enmascararlos: las máscaras pueden ocultar errores de tamaño o solapamientos. Separaría baselines por proyecto/viewport y exigiría revisar las diferencias; actualizar snapshots automáticamente después de un fallo invalidaría su función.

## 4) Riesgos o huecos que el plan no contempla

| Riesgo | Evidencia y comprobación propuesta |
| --- | --- |
| Contrato de ciclo de vida contradictorio | Las instrucciones describen espacios reabribles, pero `src/lib/space-policy.ts` define ARCHIVED como terminal; `src/app/api/spaces/[id]/route.ts` aplica esa política. Acordar la expectativa antes del test. Cubrir SETTLING→ACTIVE, ACTIVE→ARCHIVED y rechazos, además del camino lineal. |
| Autorización por recurso y revocación | `src/lib/authz.ts` exige membership de la DB contra el espacio del recurso. Probar usuario en dos espacios, `active_group` diferente, recurso ajeno, miembro expulsado y cambio de rol con sesión existente. Una UI que oculta botones no demuestra protección HTTP. |
| Invitaciones y límites bajo concurrencia | `src/app/api/invites/claim/route.test.ts` simula agotamiento y carreras. Hace falta al menos una comprobación real de último uso/última plaza con solicitudes concurrentes, sin asumir que un worker serial impide concurrencia HTTP. Verificar consentimiento explícito en `/i/[token]`, caducidad y revocación. |
| Categorías que afectan al dinero | `src/lib/category-crud.ts` comparte lógica de reasignación y conflictos de Budget. Priorizar aislamiento personal/espacio, borrado con reasignación y rollback ante colisión antes de tratar todo categorías/budgets como CRUD secundario. |
| Tiempo y recurrencias | `src/lib/recurring.ts`, `recurring.materialize.test.ts` y Budget en `prisma/schema.prisma` hacen relevantes los límites de periodo, la no duplicación y el borrado de plantilla frente a instancia. Añadir integración representativa, sin duplicar todos los casos unitarios. |
| Expiración y recuperación guest | Además de entrada/upgrade, verificar recuperación, expulsión, archivo y expiración con tiempos controlados. `getSessionCtx` en `src/lib/authz.ts` revoca al archivar; no asumir que un guest conserva las mismas lecturas que un miembro registrado. |
| Observabilidad de CI incompleta | `playwright.config.ts` selecciona únicamente reporter `github` en CI, pero `.github/workflows/e2e.yml` sube `playwright-report/`. Configurar generación HTML explícita y conservar también `test-results/` con trazas/capturas; actualmente no está garantizado que ese artifact contenga las evidencias esperadas. |
| Reintentos que ocultan inestabilidad | Hay dos retries en CI y trazas solo al primero. Registrar flakiness y fallos del primer intento; aceptar una suite que pasa únicamente por retry posterga el problema de aislamiento. |
| Divergencia de entorno | CI usa MariaDB 10.11 y el despliegue descrito usa MySQL 8. Añadir una verificación periódica del motor de destino para migraciones, restricciones y concurrencia; no hace falta duplicar toda la UI en ambos motores. |
| Test routes y autenticación real | Las rutas destructivas están protegidas por flag (`src/app/api/test/gating.test.ts`). Un smoke separado con flag apagado debe confirmar que no se exponen. El entorno de tests tampoco demuestra por sí solo los límites de login de producción. |
| Superficies omitidas | El MCP (`src/mcp/server.ts`, `src/mcp/internal-client.ts`, `src/app/api/mcp/route.ts`) merece un smoke de token y autorización por su entrada distinta; admin y export merecen límites de permisos. En export ya hay privacidad parcial, pero faltan descarga/formato/datos completos. |
| Accesibilidad y uso móvil | Dos tamaños de screenshot no comprueban teclado, foco de modales, nombres accesibles ni interacción táctil. Añadir comprobaciones funcionales pequeñas en los recorridos críticos; no crear una matriz dark mode sin soporte del producto. |

La QA agéntica necesita además un entorno desechable, cuentas sintéticas, alcance explícito y presupuesto de tiempo. No debería explorar producción ni tocar datos reales. Cada hallazgo debe adjuntar fixture, rol, flag, URL, pasos, resultado esperado/observado y evidencia sin tokens; una captura aislada no demuestra un defecto. La reproducción determinista y la revisión humana deciden su incorporación al gate.

## 5) Alternativas de tooling o enfoque que considero mejores

Mantendría **Playwright + Vitest**, ya declarados en `package.json`. No veo una ventaja suficiente en migrar a otro runner o contratar una plataforma visual para este alcance.

| Enfoque | Ventaja | Coste o límite |
| --- | --- | --- |
| Playwright HTTP + DB real para matrices; UI para recorridos | Reutiliza fixtures e infraestructura existentes y ejercita restricciones reales con menos pasos frágiles. | No valida renderizado; requiere separar claramente qué comprueba cada test. |
| Ejecuciones separadas por flag antes que proyectos compartiendo servidor | Configuración del proceso y limpieza inequívocas; reproduce flag on/off. | Más arranques/builds y coste de CI; se puede limitar inicialmente a smokes. |
| Snapshots locales versionados, capturados en entorno único | Pocas dependencias y revisión junto al cambio. | Crece el repositorio y exige disciplina de revisión; valorar plataforma externa solo si el volumen de diferencias lo justifica. |
| Misiones agénticas junto a implementación de funcionalidades | Feedback temprano sobre flujos reales, sin esperar a completar toda la cobertura visual. | No son deterministas ni sustituyen aceptación automática; requieren convertir hallazgos en casos reproducibles. |

No paralelizaría por fichero mientras se comparta un reset global. Si la duración lo exige, aislaría primero una DB por job/worker o introduciría fixtures con propiedad y limpieza inequívocas. Tampoco usaría snapshots como sustituto de expectativas: una pantalla puede verse idéntica y mostrar un saldo incorrecto.

## 6) Priorización recomendada

1. **P0: contrato, aislamiento y señales fiables.** Aclarar ARCHIVED, actualizar inventario, hacer fallar reset ante errores, reparar orden/atomicidad y conservar categorías de sistema; datos propios por test, aserciones de saldo exacto y artifacts de CI coherentes. Eliminar global setup redundante. Criterio de salida: los casos críticos son independientes y un error de preparación nunca termina en verde.
2. **P1: dinero y límites de acceso sobre DB real.** Crear→editar pagador/importe/reparto→borrar con ledger coherente; tres miembros y céntimos; PENDING→CONFIRMED una sola vez; settle-up y estados; recursos de otro espacio y sesiones revocadas. Reutilizar unitarios para la combinatoria y mantener unos pocos caminos UI completos.
3. **P1 adicional: invitaciones y escenarios difíciles de revertir.** Consentimiento de invitación, uso agotado/concurrente, CSV idempotente y privado, categorías con reasignación/colisión. Smoke on/off de guests con servidor aislado antes de habilitar esa feature; si seguirá apagada, ampliar después del núcleo estable sin omitir el comportamiento off.
4. **P2: completar experiencia y piloto visual.** Listas UI, budgets/tags, export/admin y OCR simulado. Introducir tres o cuatro estados visuales estables en móvil/escritorio y expandir solo con una señal útil y bajo ruido. En listas comprobar también que marcar o vaciar no genera gastos.
5. **Exploración agéntica desde P1, no como última fase cerrada.** Una vez seguro el entorno, usar misiones acotadas para guiar los siguientes tests. No la pondría como gate bloqueante de despliegue; sí exigiría evidencia y reproducción para dar un hallazgo por confirmado.

Antes de ampliar la matriz, mediría duración, tasa de reintentos, fallos de fixtures y diferencias visuales descartadas. La aceptación debe describir resultados por riesgo y rol, no un número objetivo de pantallas o tests.
