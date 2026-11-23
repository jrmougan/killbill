# Réplica de producción (anonimizada)

Para desarrollar con datos reales hay una copia **anonimizada** de la base de
producción (MySQL 8.0 en el VPS Hetzner, gestionado con Coolify). Seguimiento:
jrmougan/personal-infra-manager#370.

El modelo es **mixto**:

- **Réplica compartida**, para desarrollar. Un único contenedor por máquina,
  `prod-replica-killbill`, con el volumen `prod-replica-killbill-data`, publicado
  solo en `127.0.0.1:23308`, con la misma imagen que la base del worktree
  (`docker.io/library/mysql:8.0`). Todos los worktrees apuntan la app a ella.
- **Base propia de cada worktree** (`db` de `compose.dev.yaml`), vacía y migrada.
  Los **tests, el e2e, `ux:capture`, `db:migrate`, `db:seed` y la CLI de Prisma
  la usan siempre**, nunca la réplica.
- **Copia local opcional** (`db:replica:local`): la caché cargada en la base
  propia, para ramas con migraciones nuevas.

## Comandos

| Comando | Qué hace |
| --- | --- |
| `mise run db:replica:up` | Crea la réplica compartida (la primera vez, con credenciales nuevas) o la arranca. Idempotente. No carga datos. |
| `mise run db:replica:refresh` | Vuelca producción a una MySQL efímera en RAM, anonimiza, verifica, guarda la caché y **recarga la réplica compartida** desde ella (recrea su base) con las migraciones de `main`. Manual. |
| `mise run db:replica:use-shared` | Apunta la app (`.env`) a la réplica compartida. Si está vacía, carga la caché una vez. |
| `mise run db:replica:local` | Carga la caché en la base **propia** del worktree, aplica las migraciones de la rama y apunta la app allí. Sin caché, hace antes un refresh. |
| `mise run db:replica:down` | Para la réplica; el volumen se conserva. `mise run db:replica:down -- --purge` borra además contenedor, volumen y `credentials.env` (la caché no). |

`mise run setup` (y por tanto `orca.yaml`) **no carga datos**: al final ejecuta
`db-replica.sh connect`, que arranca la réplica y apunta la app a ella. Si la
réplica está vacía y hay caché, la carga una vez. Si no hay ni réplica ni caché,
o la réplica no arranca, avisa, deja la app en la base propia y termina bien.
Si el `.env` está en `DATABASE_TARGET=local`, no lo cambia. Además avisa si la
rama tiene migraciones que la réplica no tiene.

En un worktree nuevo de Orca, `orca.yaml` ejecuta `mise trust`, `mise install`,
`mise run setup`, `mise run services:up` y `mise run db:migrate` (base propia,
vacía y migrada). Ningún paso bloquea el worktree.

## Dónde apunta cada cosa: `.env`

| Variables | Para qué |
| --- | --- |
| `WORKTREE_DATABASE_PORT/USER/PASSWORD/NAME` | La MySQL propia del worktree (las publica `compose.dev.yaml`). Las genera `setup`; un `.env` anterior las recibe copiadas de `DATABASE_*`. |
| `DATABASE_HOST/PORT/USER/PASSWORD/NAME/URL` | Lo que usa la app (`mise run dev`). Las reescriben `setup` y `db:replica:*`. |
| `DATABASE_TARGET` | `shared` (réplica compartida), `worktree` (base propia vacía) o `local` (base propia con `db:replica:local`). |

La réplica usa el usuario `killbill_replica` y la base `killbill`. Las
credenciales se generan una vez al crearla y se guardan en
`${XDG_DATA_HOME:-$HOME/.local/share}/prod-replicas/killbill/credentials.env`
(directorio `0700`, fichero `0600`).

## Tests y e2e nunca tocan la réplica

El e2e y `ux:capture` **resetean** su base (`/api/test/reset` borra todos los
usuarios y espacios). Por eso:

- `playwright.config.ts`, `e2e/ocr/test-server.mjs`, `scripts/worktree-db.mjs`
  (envoltorio de `mise run e2e`, `ux:capture`, `db:migrate` y `db:seed`) y
  `prisma/seed.ts` sustituyen `DATABASE_*` por `WORKTREE_DATABASE_*` cuando
  existen. En CI no existen y se usa `DATABASE_*` tal cual.
- `prisma.config.ts` hace lo mismo para toda la CLI de Prisma (`migrate deploy`,
  `migrate dev`, `migrate reset`, `db push`, `studio`): las migraciones de una rama
  nunca llegan a la réplica de todos.
- Guardas que abortan: `src/lib/test-db-guard.mjs` (`sharedReplicaReason`)
  rechaza el puerto `23308` y el usuario `killbill_replica` en `DATABASE_PORT`,
  `DATABASE_USER` o `DATABASE_URL`; `/api/test/reset` y `/api/test/seed`
  preguntan además `SELECT @@hostname` y se niegan si es `prod-replica-killbill`
  (el hostname fijo del contenedor), aunque se remapee el puerto.

Después de un e2e la réplica sigue intacta; solo se pierde una copia hecha con
`db:replica:local` (vuelve a cargarla con el mismo comando, sin red).

## Esquema: la réplica refleja producción

La caché tiene el esquema de producción del momento del volcado (`lastMigration`
en el meta). Al cargarla en la réplica compartida, el script aplica las
migraciones de `origin/main` (`git fetch origin main` y `git archive`, con un
`prisma.config` propio en un directorio temporal), es decir, lo desplegado o a
punto de desplegarse. Si alguna falla, recarga la caché sin ellas y la réplica se
queda con el esquema de producción. Las migraciones de una rama **no** se aplican
a la réplica: para probarlas con datos, `mise run db:replica:local`.

## Login de desarrollo

- `admin@example.invalid` / `password` (PIN `1234`): el primer admin de producción.
- El resto de cuentas: `user-<id>@example.invalid` / `password`. Los invitados
  siguen sin email ni contraseña.

## Cómo funciona `refresh`

1. Arranca (o crea) la réplica compartida, para no volcar si no va a poder cargar.
2. `ssh coolify-new` localiza el contenedor por la etiqueta
   `coolify.resourceName=mysql-database-w10cwycdwgjebrdedi1oxxgr` (debe haber
   exactamente uno) y ejecuta dentro `mysqldump --single-transaction` del
   esquema `killbill` como root, con `MYSQL_ROOT_PASSWORD` de su propio entorno
   (el usuario `killbill` no sirve, issue #340 del repo de infra). La contraseña
   no sale del VPS. **En producción solo se lee**: el volcado y `SELECT COUNT(*)`.
3. El volcado pasa por una tubería, quitando los `DEFINER`, a una MySQL
   **efímera** (`replica-scratch` en `compose.dev.yaml`, perfil `replica`) con el
   datadir y `/tmp` en tmpfs (RAM) y sin binlog. Un volcado cortado (sin
   `-- Dump completed`) se rechaza.
4. Compara el número de filas de cada tabla entre producción y la copia efímera
   (solo avisa si difieren: producción puede cambiar entre el volcado y el recuento).
5. Aplica `scripts/replica/anonymize.sql` en la copia efímera y comprueba con
   `scripts/replica/verify.sql`. Si alguna comprobación no da 0, **aborta sin
   guardar caché y sin tocar la réplica compartida**.
6. Vuelca la copia ya anonimizada a la caché y borra el contenedor efímero (con
   él desaparecen los datos crudos).
7. Recrea la base `killbill` de la réplica compartida, carga la caché, verifica
   otra vez, aplica las migraciones de `main` y muestra los recuentos producción
   frente a réplica (`InviteCode` y `GroupInvite` se vacían a propósito).

Por qué el contenedor efímero: si se anonimizara con `UPDATE` en una MySQL con
volumen, los valores reales seguirían en él (versiones viejas de los registros en
las páginas `.ibd`, undo, redo y binlog) aunque la tabla ya no los muestre. Ni el
volumen de la réplica ni el del worktree reciben otra cosa que la caché ya
anonimizada. Si interrumpes un refresh, `mise run services:down` también borra un
`replica-scratch` que haya quedado vivo.

Un fallo a mitad de una carga deja vacía la base destino (réplica o worktree),
nunca a medias. Un cerrojo (`flock` sobre `.lock` en el directorio de la caché)
evita que dos worktrees creen o carguen la réplica a la vez.

Variables para pruebas: `REPLICA_SSH_HOST` (por defecto `coolify-new`) y
`REPLICA_CACHE_DIR`. No cambies `XDG_DATA_HOME` para probar: Podman guarda ahí
sus contenedores y dejaría de ver la réplica y la MySQL del worktree.

## El contenedor de la réplica

- Podman (rootless) por defecto; Docker si no hay Podman; `CONTAINER_ENGINE` manda.
- `--restart=unless-stopped`: vuelve sola cuando Podman reinicia contenedores
  (con Podman rootless, tras un reinicio del equipo hace falta
  `systemctl --user enable podman-restart.service`; si no, la arranca el siguiente
  `mise run setup` o `db:replica:up`). `db:replica:down` la deja parada.
- `--oom-score-adj=200`, como `compose.dev.yaml`: con Podman rootless, sin él,
  `exec` y el healthcheck fallan con `write to /proc/self/oom_score_adj`.
- Etiqueta `prod-replica.app=killbill` y hostname `prod-replica-killbill`. El
  script no toca un contenedor con ese nombre que no lleve la etiqueta, ni ningún
  otro contenedor o volumen (los `*_mysql_data` de cada worktree son suyos).
- Consulta de solo lectura:

  ```bash
  podman exec prod-replica-killbill sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" mysql -u"$MYSQL_USER" "$MYSQL_DATABASE" -e "SELECT COUNT(*) FROM Expense"'
  ```

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
- `latest.sql.gz` y `latest.meta.json` apuntan a la última. Toda carga comprueba
  el sha256 antes.
- Directorio `0700`, ficheros `0600`, escritura atómica. Solo contiene datos ya
  anonimizados y verificados. Borrar los volcados es seguro; `credentials.env`
  no (son las credenciales del volumen de la réplica; para empezar de cero,
  `db:replica:down -- --purge`).

`.gitignore` impide commitear volcados (`*.sql.gz` y similares).

## Cuándo refrescar

- Cuando necesites datos recientes o reproducir algo de producción.
- Tras un despliegue con migraciones que cambien datos.
- Si `verify.sql` falla por una columna nueva: cúbrela y vuelve a refrescar.

Un refresh recrea la base de la réplica: los cambios que hayas hecho en ella
desde la app se pierden, en todos los worktrees.

## Avisos

- La réplica es compartida: lo que escribas desde la app de un worktree lo ven
  los demás hasta el siguiente refresh.
- La app no envía correo ni notificaciones; el cron de purga responde 503 sin
  `CRON_SECRET` y el OCR no llama a ningún proveedor sin clave. No pongas en
  `.env` claves ni secretos de producción.
- Los tickets y avatares subidos no se replican: la réplica es solo la BD.
- El refresh necesita RAM para la copia efímera (tmpfs de hasta 2 GB; hoy la
  base ocupa unos pocos MB). Si el host tiene swap en disco, el kernel podría
  paginar parte de ella.
