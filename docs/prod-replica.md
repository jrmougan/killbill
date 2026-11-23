# Réplica local de producción (anonimizada)

Cada worktree puede trabajar con una copia **anonimizada** de la base de
producción (MySQL 8.0 en el VPS Hetzner, gestionado con Coolify) cargada en su
MySQL local de `compose.dev.yaml`. Seguimiento: jrmougan/personal-infra-manager#370.

## Comandos

| Comando | Qué hace |
| --- | --- |
| `mise run db:replica` | Recrea la BD local (`DATABASE_NAME` de `.env`) desde la caché anonimizada y aplica las migraciones de la rama. Sin caché, hace un `refresh`. |
| `mise run db:replica:refresh` | Vuelca producción en streaming, la carga, anonimiza, verifica, guarda la caché y migra. |

Los dos exigen `mise run services:up` y **borran la BD local del worktree**
(drop/create); no tocan otras bases. Al final ejecutan `prisma migrate deploy`
(nunca `migrate dev`), porque la rama puede ir por delante de lo desplegado.

En un worktree nuevo de Orca, `orca.yaml` lo hace solo: `mise trust`,
`mise install`, `mise run setup`, `mise run services:up` y `mise run db:replica`.
Si la réplica falla (sin red o sin `ssh coolify-new`), avisa, aplica las
migraciones sobre la BD vacía y termina bien para no bloquear el worktree.

Sin Docker instalado, `scripts/dev-compose.mjs` usa Podman automáticamente
(`CONTAINER_ENGINE` sigue mandando si está definida).

## Login de desarrollo

- `admin@example.invalid` / `password` (PIN `1234`): el primer admin de producción.
- El resto de cuentas: `user-<id>@example.invalid` / `password`. Los invitados
  siguen sin email ni contraseña.

## Cómo funciona `refresh`

1. `ssh coolify-new` localiza el contenedor por la etiqueta
   `coolify.resourceName=mysql-database-w10cwycdwgjebrdedi1oxxgr` (debe haber
   exactamente uno) y ejecuta dentro `mysqldump --single-transaction` del
   esquema `killbill` como root, con `MYSQL_ROOT_PASSWORD` de su propio entorno
   (el usuario `killbill` no sirve, issue #340 del repo de infra). La contraseña
   no sale del VPS. **En producción solo se lee**: el volcado y `SELECT COUNT(*)`.
2. El volcado pasa por una tubería, quitando los `DEFINER`, directo a la MySQL
   local: los datos reales nunca se escriben en disco. Un volcado cortado (sin
   `-- Dump completed`) se rechaza.
3. Compara el número de filas de cada tabla entre producción y la copia local
   (solo avisa si difieren: producción puede cambiar entre el volcado y el recuento).
4. Aplica `scripts/replica/anonymize.sql` y comprueba con
   `scripts/replica/verify.sql`. Si alguna comprobación no da 0, **deja la BD
   vacía y aborta** sin guardar caché.
5. Vuelca la BD ya anonimizada a la caché y migra.

## Qué se anonimiza

Se conservan importes, fechas, repartos, ledger, liquidaciones y presupuestos,
que es para lo que sirve la réplica. Se sustituye:

- `User`: nombre (`Usuario <n>`, `Invitado <n>`, `Admin`), email, contraseña y PIN
  (hash bcrypt fijo de `password` y `1234`), avatar si es una ruta, `tokenVersion` a 0.
- `Couple`: nombre (`Espacio <n>`) y código de invitación.
- `GroupInvite` e `InviteCode` se vacían; `Membership.guestTokenHash` a NULL.
- `AiProviderConfig.encryptedApiKey` a NULL: las claves de IA de producción no
  llegan a local (el OCR usa las variables de `.env`, vacías por defecto).
- `Expense`: concepto `<categoría> <n>`, notas a un texto fijo, `receiptUrl` e
  `importFingerprint` a NULL (las subidas no existen en local).
- `ReceiptLineItem` (`Artículo <n>`), `RecurringSeries`, `Tag`, categorías
  propias, listas y productos de la compra.
- `_prisma_migrations.logs` a NULL.

La anonimización es determinista e idempotente. `verify.sql` además falla si
producción tiene alguna columna de texto que no conoce: una migración nueva con
texto obliga a revisarla y cubrirla en los dos ficheros.

## Caché

`${XDG_DATA_HOME:-$HOME/.local/share}/prod-replicas/killbill/`, compartida por
todos los worktrees de la máquina:

- `<AAAAMMDDTHHMMSSZ>.sql.gz` y `.meta.json` (fecha UTC, origen sin secretos,
  sha256, commit, última migración y filas por tabla); se conservan las 3 últimas.
- `latest.sql.gz` y `latest.meta.json` apuntan a la última. `db:replica`
  comprueba el sha256 antes de cargarla.
- Directorio `0700`, ficheros `0600`, escritura atómica. Solo contiene datos ya
  anonimizados y verificados. Borrar el directorio es seguro.

`.gitignore` impide commitear volcados (`*.sql.gz` y similares).

## Cuándo refrescar

- Cuando necesites datos recientes o reproducir algo de producción.
- Tras un despliegue con migraciones que cambien datos: la caché guarda el
  esquema de producción del momento en que se hizo (`lastMigration` en el meta).
- Si `verify.sql` falla por una columna nueva: cúbrela y vuelve a refrescar.

## Avisos

- **`mise run e2e` y `mise run ux:capture` resetean la BD de `.env`**: después,
  `mise run db:replica` para recuperar la réplica (desde la caché, sin red).
- `db:replica` borra lo que tuvieras en la BD local del worktree.
- La app no envía correo ni notificaciones; el cron de purga responde 503 sin
  `CRON_SECRET` y el OCR no llama a ningún proveedor sin clave. No pongas en
  `.env` claves ni secretos de producción.
- Los tickets y avatares subidos no se replican: la réplica es solo la BD.
