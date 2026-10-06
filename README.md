# Kill Bill 💸

Aplicación para repartir gastos de parejas y grupos. Next.js 16, Prisma y MySQL,
con autenticación JWT y lectura de tickets mediante OCR.

## Desarrollo local

Requisitos: [mise](https://mise.jdx.dev/getting-started.html) y Docker o Podman.
`mise.toml` fija Node 24.21.0 (incluye npm 11.19.0) y Compose 5.5.1.

```bash
mise trust
mise install
mise run setup
mise run services:up
mise run db:migrate
mise run db:seed
mise run dev
```

`setup` instala las dependencias con `npm ci`, genera Prisma y crea `.env` si no
existe. Genera credenciales locales aleatorias, un nombre de proyecto Compose y
puertos por checkout. Muestra la URL del servidor; `PORT` queda guardado en `.env`.
Repetirlo conserva el entorno y no modifica la base de datos.

`services:up` arranca MySQL 8.0 y espera a que acepte consultas con el usuario de
la aplicación. Publica el puerto solo en `127.0.0.1`. Utiliza Docker si está
instalado; en caso contrario utiliza Podman con el Compose que instala mise.
Puedes elegir con `CONTAINER_ENGINE=podman mise run services:up`.

`db:migrate` aplica las migraciones versionadas (`prisma migrate deploy`). Para
crear una migración nueva usa `mise exec -- npx prisma migrate dev` con una base
de desarrollo y permisos para su shadow database. `db:seed` crea las categorías
del sistema y el admin; el acceso local por defecto es
`admin@killbill.app` / `password123`. Puedes configurar `SEED_ADMIN_EMAIL`,
`SEED_ADMIN_PASSWORD` y `SEED_ADMIN_PIN` antes de la primera siembra.

El OCR requiere `GEMINI_API_KEY` o `OPENROUTER_API_KEY` en `.env`. Las claves
quedan vacías inicialmente; el resto de la aplicación se puede desarrollar sin
ellas. Si ya tienes `.env`, incorpora `PORT`, `COMPOSE_PROJECT_NAME` y los campos
de `.env.example` que necesites; `setup` nunca lo sobrescribe. Mantén
`DATABASE_URL` alineada con los campos `DATABASE_*`, especialmente el puerto.

## Comandos

| Comando | Acción |
| --- | --- |
| `mise run setup` | Preparar entorno, dependencias y cliente Prisma |
| `mise run dev` | Arrancar Next.js en el puerto de `.env` |
| `mise run check` | Prisma generate, oxlint, typecheck y tests unitarios sin watch |
| `mise run typecheck` | `next typegen` + `tsc` de la app y de `e2e/` |
| `mise run test` | Tests unitarios sin watch |
| `mise run lint` | Lint con oxlint |
| `mise run build` | Generar Prisma y compilar producción |
| `mise run services:up` | Arrancar MySQL y esperar a que esté listo |
| `mise run services:status` | Consultar los servicios de este checkout |
| `mise run services:down` | Detener servicios conservando los datos |
| `mise run db:migrate` | Aplicar migraciones existentes |
| `mise run db:seed` | Sembrar categorías y admin |
| `mise run e2e` | Ejecutar Playwright |

Antes del primer e2e: `mise exec -- npx playwright install chromium --with-deps`.
Los fixtures e2e **borran los datos de la base configurada**: ejecútalos en un
checkout de pruebas con su propia `.env` y base local. Detén su servidor dev;
Playwright arranca uno con las rutas de prueba habilitadas y usa el mismo `PORT`.
CI levanta una MySQL 8.0 efímera con el mismo `compose.dev.yaml` (igual que
producción) y usa los comandos mise del repositorio.
Las variables que CI exporta tienen prioridad sobre las del archivo `.env`.

Playwright separa los contratos API (`api`, una ejecución) de los flujos de interfaz
(`chromium` y `mobile-chrome`). Los escenarios de autorización que comprueban la
navegación del invitado conservan ambas pantallas. Usa
`mise run e2e -- --project=api` para ejecutar solo los contratos.

Todos los specs importan `test` y `expect` de `e2e/fixtures/test.fixture.ts`.
Para sesiones adicionales usa el fixture `newContext`: hereda las opciones del
proyecto y conserva los errores de navegador incluso si se cierra el contexto.
Un error JavaScript no controlado hace fallar la prueba.

El servidor de pruebas usa UTC y el navegador Europe/Madrid para detectar
fechas inconsistentes durante la hidratación. Playwright arranca un proveedor
OCR HTTP local con puerto efímero y claves ficticias; el recorrido de ticket
mantiene reales la validación, subida y persistencia. El override del proveedor
solo funciona con `TEST_ROUTES_ENABLED=true`, loopback y credenciales de prueba.
Los tests de concurrencia consultan la base local para verificar dinero,
membresías y usos persistidos después de las solicitudes simultáneas.

CI falla también si una prueba solo pasa tras un reintento. El resumen de GitHub
Actions identifica prueba, proyecto, intento y error; el artefacto
`playwright-report` incluye el informe HTML y `test-results` con trazas y capturas.
El informe local nunca arranca un servidor automáticamente.

## Orca y worktrees

Ejecuta `mise trust` y `mise run setup` desde cada worktree nuevo. No copies
`.env` entre worktrees: el setup asigna a cada uno un proyecto Compose, volumen,
credenciales y puertos propios. Comprueba que los puertos estén libres si
preparas varios checkouts simultáneamente; si cambias el puerto MySQL, actualiza
tanto `DATABASE_PORT` como `DATABASE_URL`. Los puertos se conservan al repetir setup.

El comando de preparación para un hook de Orca es `mise run setup`, después de
confiar en la configuración. El arranque y las migraciones son pasos explícitos.
Antes de archivar un worktree, ejecuta `mise run services:down`; conserva su
volumen para poder recuperar los datos. Los comandos requieren `mise` en `PATH`,
sin depender de la activación de Node en un shell interactivo.

## Producción

`compose.dev.yaml` contiene exclusivamente los servicios de desarrollo.
`docker-compose.yml` describe el despliegue con una imagen publicada y redes
externas de MySQL/Traefik; **no crea una base de datos**.

GitHub Actions ejecuta unit tests, lint, typecheck, `npm audit` (bloquea con
avisos críticos en dependencias de runtime) y e2e antes de publicar la imagen en
GHCR (`latest` + SHA del commit) y solicitar el despliegue a Coolify. El Dockerfile usa la misma versión de Node
que `mise.toml`; al actualizarla, cambia ambos y ejecuta las comprobaciones.
El contenedor aplica `prisma migrate deploy` antes de arrancar el servidor; si
la migración falla, el contenedor termina con error y no llega a servir.
Los secretos y la conexión de producción se configuran en Coolify. La base de
producción es MySQL 8.0 (el driver se llama `@prisma/adapter-mariadb`, pero el
servidor es MySQL).

`GET /api/health` es público y sin caché: responde 200 `{"status":"ok"}` tras un
`SELECT 1` y 503 si la base no responde. La imagen trae un `HEALTHCHECK` que lo
usa; también sirve como healthcheck de Coolify/Traefik.

**Recomendado (operaciones):** separar las migraciones del arranque. Configura en
Coolify un paso previo al despliegue (o un job one-shot con la misma imagen) que
ejecute `cd /prisma-tools && ./node_modules/.bin/prisma migrate deploy`, y apunta
el healthcheck de Coolify a `/api/health`. Mientras no exista ese paso, el `CMD`
de la imagen sigue migrando al arrancar.
