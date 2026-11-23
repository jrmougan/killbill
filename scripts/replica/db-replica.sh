#!/usr/bin/env bash
# Réplica anonimizada de la base de producción (docs/prod-replica.md).
#
# Réplica COMPARTIDA: un único contenedor por máquina, prod-replica-killbill
# (volumen prod-replica-killbill-data, 127.0.0.1:23308), que usan todos los
# worktrees para desarrollar. Refleja el esquema de producción (más las
# migraciones de main que aún no estén desplegadas), no el de cada rama.
#
#   up               Crea la réplica (la primera vez, con credenciales nuevas) o la
#                    arranca. No carga datos.
#   down [--purge]   Para la réplica. Solo con --purge borra contenedor, volumen y
#                    credenciales (la caché se conserva).
#   refresh          Vuelca producción en streaming a una MySQL efímera en RAM,
#                    anonimiza, verifica, guarda la caché y la carga en la réplica
#                    compartida (recreando su base) con las migraciones de main.
#   connect          Paso de `mise run setup`: arranca la réplica y apunta la app
#                    (.env) a ella; si la réplica está vacía, carga la caché una vez.
#                    Sin réplica ni caché, avisa y deja la base propia. Nunca falla.
#   use-shared       Como connect, pero explícito: falla si no puede.
#   local            Carga la caché en la MySQL PROPIA del worktree, aplica las
#                    migraciones de la rama y apunta la app allí (ramas con
#                    migraciones nuevas). Vuelta atrás: use-shared.
#
# En producción solo se lee: mysqldump y SELECT COUNT(*) dentro del contenedor,
# con la contraseña de root de su propio entorno, que nunca sale del VPS.
#
# Los datos sin anonimizar no se escriben en disco: van de ssh, por una tubería,
# al servicio `replica-scratch` de compose.dev.yaml, que tiene el datadir y el
# tmpdir en tmpfs y sin binlog. Anonimizar en una MySQL con volumen no vale:
# InnoDB conserva versiones viejas de los registros en las páginas .ibd, el undo,
# el redo y el binlog. Ni el volumen de la réplica compartida ni el del worktree
# reciben otra cosa que la caché ya anonimizada y verificada.
set -Eeuo pipefail
umask 077
cd "$(dirname "$0")/../.."
ROOT=$PWD

APP=killbill
PROD_SSH_HOST=${REPLICA_SSH_HOST:-coolify-new}
PROD_LABEL=mysql-database-w10cwycdwgjebrdedi1oxxgr
PROD_SCHEMA=killbill
DATA_DIR=${XDG_DATA_HOME:-$HOME/.local/share}/prod-replicas/$APP
# REPLICA_CACHE_DIR solo para pruebas: XDG_DATA_HOME también mueve el almacén de Podman.
CACHE_DIR=${REPLICA_CACHE_DIR:-$DATA_DIR}
CRED_FILE=$DATA_DIR/credentials.env
KEEP=3
ANONYMIZE_SQL=scripts/replica/anonymize.sql
VERIFY_SQL=scripts/replica/verify.sql
SCRATCH=replica-scratch
# Tablas que anonymize.sql vacía a propósito (no se comparan con producción).
EMPTIED_TABLES='GroupInvite InviteCode'

# Réplica compartida. Mismos valores en src/lib/test-db-guard.mjs (SHARED_REPLICA),
# que impide a tests, e2e, seed y la CLI de Prisma usarla; un test lo comprueba.
REPLICA_NAME=prod-replica-$APP
REPLICA_VOLUME=$REPLICA_NAME-data
REPLICA_PORT=23308
REPLICA_USER=killbill_replica
REPLICA_DB=$PROD_SCHEMA
# Misma imagen que el servicio db de compose.dev.yaml (un test lo comprueba).
REPLICA_IMAGE=docker.io/library/mysql:8.0
REPLICA_LABEL=prod-replica.app

log() { printf '[db:replica] %s\n' "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

# Podman (rootless) por defecto; Docker si no hay Podman. CONTAINER_ENGINE manda.
if [ -n "${CONTAINER_ENGINE:-}" ]; then ENGINE=$CONTAINER_ENGINE
elif command -v podman >/dev/null; then ENGINE=podman
else ENGINE=docker
fi
[[ $ENGINE = podman || $ENGINE = docker ]] || die 'CONTAINER_ENGINE debe ser podman o docker.'

env_get() { # <clave> -> valor en .env (sin tocar el entorno del proceso)
  node -e 'const v = require("util").parseEnv(require("fs").readFileSync(".env", "utf8"))[process.argv[1]]; process.stdout.write(v ?? "")' "$1"
}
need_env() { [ -f .env ] || die 'Falta .env: ejecuta antes mise run setup.'; }
point_env() { node scripts/replica/point-env.mjs "$@"; }

compose() { node --env-file=.env scripts/dev-compose.mjs --profile replica "$@"; }

TMP_FILES=()
TMP_DIRS=()
SCRATCH_UP=0
stop_scratch() {
  [ "$SCRATCH_UP" = 1 ] || return 0
  SCRATCH_UP=0
  # tmpfs: al borrar el contenedor desaparecen los datos crudos.
  compose rm --stop --force "$SCRATCH" >/dev/null 2>&1 || log "AVISO: no se pudo borrar el contenedor $SCRATCH."
}
cleanup() {
  [ ${#TMP_FILES[@]} -eq 0 ] || rm -f -- "${TMP_FILES[@]}"
  [ ${#TMP_DIRS[@]} -eq 0 ] || rm -rf -- "${TMP_DIRS[@]}"
  stop_scratch
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# Un solo proceso a la vez sobre la réplica compartida (dos worktrees en setup).
take_lock() {
  mkdir -p "$DATA_DIR"; chmod 700 "$DATA_DIR"
  exec 9>"$DATA_DIR/.lock"
  flock -w 900 9 || die "Otro proceso tiene la réplica ocupada ($DATA_DIR/.lock)."
}

# mysql/mysqldump como root DENTRO de un contenedor local (el host no tiene cliente).
svc_mysql() {
  local svc=$1; shift
  compose exec -T "$svc" sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot --default-character-set=utf8mb4 "$@"' sh "$@"
}
svc_dump() {
  compose exec -T "$1" sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction --routines --triggers --events --no-tablespaces --set-gtid-purged=OFF "$1"' sh "$2"
}
local_mysql() { svc_mysql db "$@"; }
scratch_mysql() { svc_mysql "$SCRATCH" "$@"; }
replica_mysql() {
  "$ENGINE" exec -i "$REPLICA_NAME" sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot --default-character-set=utf8mb4 "$@"' sh "$@"
}

# Comando remoto: localiza el contenedor por etiqueta (exactamente uno) y ejecuta
# dentro el cliente indicado. Solo lectura; no crea ficheros en el VPS.
remote_cmd() {
  local inner=$1
  printf '%s' "set -eu; c=\$(docker ps -q --filter label=coolify.resourceName=$PROD_LABEL); \
n=\$(printf '%s\n' \"\$c\" | grep -c .) || true; \
[ \"\$n\" = 1 ] || { echo \"Se esperaba un contenedor con la etiqueta $PROD_LABEL y hay \$n\" >&2; exit 3; }; \
exec docker exec -i \"\$c\" sh -c '$inner'"
}
prod() {
  ssh -T -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 "$PROD_SSH_HOST" "$(remote_cmd "$1")"
}
PROD_DUMP='MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction --routines --triggers --events --no-tablespaces --set-gtid-purged=OFF '"$PROD_SCHEMA"
PROD_QUERY='MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -N --default-character-set=utf8mb4 '"$PROD_SCHEMA"

# Quita los DEFINER (vistas, rutinas, triggers) y exige el final del volcado: un
# volcado cortado (ssh caído, disco lleno en origen) no debe darse por bueno.
filter_dump() {
  awk '{ gsub(/DEFINER=`[^`]*`@`[^`]*`/, ""); print }
       /^-- Dump completed/ { done = 1 }
       END { if (!done) { print "[db:replica] ERROR: volcado incompleto (falta \"-- Dump completed\")." > "/dev/stderr"; exit 4 } }'
}

check_services() {
  local_mysql -N -e 'SELECT 1' >/dev/null 2>&1 \
    || die 'La MySQL del worktree no responde: ejecuta mise run services:up.'
}

recreate_db() { # <mysql_fn> <db>
  local fn=$1 db=$2
  log "Recreando la base '$db' ($fn) desde cero."
  "$fn" -e "DROP DATABASE IF EXISTS \`$db\`; CREATE DATABASE \`$db\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
}

# Ante un fallo a mitad de una carga, la base destino queda vacía (sin datos a medias).
ON_ERROR_FN=''
ON_ERROR_DB=''
on_error() {
  if [ -n "$ON_ERROR_FN" ] && [ "$BASH_SUBSHELL" = 0 ]; then
    local fn=$ON_ERROR_FN db=$ON_ERROR_DB
    ON_ERROR_FN=''
    log "Fallo: se deja vacía la base '$db' ($fn)."
    recreate_db "$fn" "$db" || true
  fi
}
trap on_error ERR

counts_query() { # <mysql_fn> <db> -> SQL con COUNT(*) por tabla base
  local fn=$1 db=$2 tables q=''
  tables=$("$fn" -N -e "SELECT table_name FROM information_schema.tables WHERE table_schema='$db' AND table_type='BASE TABLE' ORDER BY 1")
  for t in $tables; do q+="${q:+ UNION ALL }SELECT '$t', COUNT(*) FROM \`$t\`"; done
  printf '%s' "$q"
}
table_counts() { # <mysql_fn> <db> -> tabla<TAB>filas
  local q
  q=$(counts_query "$1" "$2")
  [ -n "$q" ] || return 0
  printf '%s;\n' "$q" | "$1" -N "$2"
}

compare_counts() { # <título izq> <recuentos izq> <título der> <recuentos der> [tablas vaciadas]
  local emptied=${5:-}
  LC_ALL=C join -t $'\t' -a1 -a2 -e '?' -o 0,1.2,2.2 \
    <(printf '%s\n' "$2" | grep . | LC_ALL=C sort) <(printf '%s\n' "$4" | grep . | LC_ALL=C sort) \
    | EMPTIED=" $emptied " awk -F'\t' -v l="$1" -v r="$3" '
        BEGIN { printf "  %-22s %8s %8s\n", "tabla", l, r }
        { note = ""
          if ($2 != $3) {
            if (index(ENVIRON["EMPTIED"], " " $1 " ") && $3 == 0) note = "  (vaciada a propósito)"
            else { note = "  <- DISTINTO"; bad = 1 } }
          printf "  %-22s %8s %8s%s\n", $1, $2, $3, note }
        END { if (bad) print "[db:replica] AVISO: hay recuentos distintos (producción puede haber cambiado durante el volcado, o main añade tablas)." > "/dev/stderr" }' >&2
}

verify() { # <mysql_fn> <db>
  local out failed
  out=$("$1" -N "$2" < "$VERIFY_SQL")
  failed=$(printf '%s\n' "$out" | awk -F'\t' '$2 != 0 { print "  - " $1 ": " $2 }')
  if [ -n "$failed" ]; then
    log 'La verificación de anonimización ha fallado (comprobación: filas):'
    printf '%s\n' "$failed" >&2
    return 1
  fi
  log "Verificación de anonimización: $(printf '%s\n' "$out" | grep -c .) comprobaciones a 0."
}

# ---------------------------------------------------------------- réplica compartida

replica_exists() { "$ENGINE" container inspect "$REPLICA_NAME" >/dev/null 2>&1; }
volume_exists() { "$ENGINE" volume inspect "$REPLICA_VOLUME" >/dev/null 2>&1; }
replica_is_ours() {
  [ "$("$ENGINE" container inspect -f "{{index .Config.Labels \"$REPLICA_LABEL\"}}" "$REPLICA_NAME" 2>/dev/null)" = "$APP" ]
}
cred_get() { # <clave> de credentials.env
  node -e 'const v = require("util").parseEnv(require("fs").readFileSync(process.argv[1], "utf8"))[process.argv[2]]; process.stdout.write(v ?? "")' "$CRED_FILE" "$1"
}

ensure_credentials() {
  [ -f "$CRED_FILE" ] && return 0
  if replica_exists || volume_exists; then
    die "Existe $REPLICA_NAME o su volumen pero falta $CRED_FILE. Para empezar de cero: mise run db:replica:down -- --purge."
  fi
  mkdir -p "$DATA_DIR"; chmod 700 "$DATA_DIR"
  local tmp
  tmp=$(mktemp "$DATA_DIR/.credentials.XXXXXX"); TMP_FILES+=("$tmp")
  chmod 600 "$tmp"
  node -e '
    const { randomBytes } = require("crypto");
    const [db, user] = process.argv.slice(1);
    process.stdout.write([
      "# Réplica compartida prod-replica-killbill (scripts/replica/db-replica.sh). No commitear.",
      `MYSQL_DATABASE=${db}`, `MYSQL_USER=${user}`,
      `MYSQL_PASSWORD=${randomBytes(24).toString("hex")}`,
      `MYSQL_ROOT_PASSWORD=${randomBytes(24).toString("hex")}`, ""].join("\n"));' "$REPLICA_DB" "$REPLICA_USER" > "$tmp"
  mv -f "$tmp" "$CRED_FILE"
  log "Credenciales nuevas de la réplica en $CRED_FILE (0600)."
}

wait_replica() {
  local i
  for i in $(seq 1 90); do
    if "$ENGINE" exec "$REPLICA_NAME" sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" mysql --protocol=TCP -h 127.0.0.1 -u"$MYSQL_USER" "$MYSQL_DATABASE" -e "SELECT 1"' >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  die "La réplica $REPLICA_NAME no responde tras 180 s ($ENGINE logs $REPLICA_NAME)."
}

replica_up() {
  ensure_credentials
  if replica_exists; then
    replica_is_ours || die "Ya existe un contenedor $REPLICA_NAME que no es de este script (sin la etiqueta $REPLICA_LABEL=$APP): no se toca."
    if [ "$("$ENGINE" container inspect -f '{{.State.Running}}' "$REPLICA_NAME")" != true ]; then
      log "Arrancando la réplica compartida $REPLICA_NAME."
      "$ENGINE" start "$REPLICA_NAME" >/dev/null 9>&-
    fi
  else
    log "Creando la réplica compartida $REPLICA_NAME (127.0.0.1:$REPLICA_PORT, volumen $REPLICA_VOLUME)."
    # --oom-score-adj=200: Podman rootless lo fija así si no se indica, y entonces
    # exec y el healthcheck fallan (ver compose.dev.yaml). unless-stopped: vuelve
    # sola tras reiniciar Podman; db:replica:down la deja parada. 9>&-: que conmon
    # no herede el descriptor del cerrojo.
    "$ENGINE" run --detach --name "$REPLICA_NAME" --hostname "$REPLICA_NAME" \
      --label "$REPLICA_LABEL=$APP" --restart=unless-stopped --oom-score-adj=200 \
      --publish "127.0.0.1:$REPLICA_PORT:3306" --volume "$REPLICA_VOLUME:/var/lib/mysql" \
      --env-file "$CRED_FILE" \
      --health-cmd 'MYSQL_PWD="$MYSQL_PASSWORD" mysql --protocol=TCP -h 127.0.0.1 -u"$MYSQL_USER" "$MYSQL_DATABASE" -e "SELECT 1"' \
      --health-interval 30s --health-timeout 5s --health-retries 5 --health-start-period 60s \
      "$REPLICA_IMAGE" --default-authentication-plugin=mysql_native_password >/dev/null 9>&-
  fi
  wait_replica
}

replica_has_data() {
  [ "$(replica_mysql -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$REPLICA_DB' AND table_name='_prisma_migrations'")" = 1 ]
}

check_cache() { # comprueba el sha256 de latest.sql.gz y dice de cuándo es
  local latest=$CACHE_DIR/latest.sql.gz meta=$CACHE_DIR/latest.meta.json
  [ -f "$latest" ] || die "No hay caché en $latest: ejecuta mise run db:replica:refresh."
  [ -f "$meta" ] || die "Falta $meta: ejecuta mise run db:replica:refresh."
  local want got
  want=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).sha256 || "")' "$meta")
  got=$(sha256sum "$latest" | cut -d' ' -f1)
  [ "$want" = "$got" ] || die "El sha256 de $latest no coincide con latest.meta.json; ejecuta mise run db:replica:refresh."
  log "Caché anonimizada del $(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).createdAt)' "$meta")."
}

# Migraciones de origin/main (lo desplegado o a punto de desplegarse), nunca las de
# la rama: la réplica es de todos los worktrees. Si fallan, se recarga la caché sin
# ellas y la réplica queda con el esquema de producción.
migrate_shared_main() {
  local ref=origin/main tmp url
  timeout 60 git fetch --quiet origin main 2>/dev/null \
    || log 'AVISO: no se ha podido actualizar origin/main; se usa la copia local.'
  if ! git rev-parse -q --verify "$ref^{commit}" >/dev/null; then
    log "AVISO: no hay $ref: la réplica queda con el esquema de producción."
    return 0
  fi
  tmp=$(mktemp -d); TMP_DIRS+=("$tmp")
  git archive "$ref" prisma/schema.prisma prisma/migrations | tar -x -C "$tmp"
  # Config propia (sin el prisma.config.ts del repo, que siempre apunta al worktree).
  cat > "$tmp/prisma.config.mjs" <<'EOF'
export default {
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.REPLICA_DATABASE_URL },
};
EOF
  url="mysql://$(cred_get MYSQL_USER):$(cred_get MYSQL_PASSWORD)@127.0.0.1:$REPLICA_PORT/$REPLICA_DB"
  log "Aplicando a la réplica las migraciones de $ref ($(git rev-parse --short "$ref"))."
  if (cd "$tmp" && REPLICA_DATABASE_URL=$url "$ROOT/node_modules/.bin/prisma" migrate deploy --config prisma.config.mjs >&2); then
    return 0
  fi
  log "AVISO: las migraciones de $ref fallan sobre la réplica; se recarga la caché sin ellas (esquema de producción)."
  load_shared nomigrate
}

load_shared() { # [nomigrate] — carga la caché en la réplica compartida
  check_cache
  ON_ERROR_FN=replica_mysql ON_ERROR_DB=$REPLICA_DB
  recreate_db replica_mysql "$REPLICA_DB"
  gzip -dc "$CACHE_DIR/latest.sql.gz" | filter_dump | replica_mysql "$REPLICA_DB"
  verify replica_mysql "$REPLICA_DB"
  ON_ERROR_FN=''
  [ "${1:-}" = nomigrate ] || migrate_shared_main
  log "Réplica compartida cargada ($REPLICA_NAME, 127.0.0.1:$REPLICA_PORT)."
}

# Migraciones de esta rama que la réplica no tiene: la app de la rama puede fallar.
warn_branch_migrations() {
  local applied missing
  applied=$(replica_mysql -N "$REPLICA_DB" -e 'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')
  missing=$(find prisma/migrations -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | LC_ALL=C sort \
    | LC_ALL=C comm -23 - <(printf '%s\n' "$applied" | LC_ALL=C sort))
  if [ -n "$missing" ]; then
    log "AVISO: esta rama tiene $(printf '%s\n' "$missing" | grep -c .) migraciones que la réplica compartida no tiene:"
    printf '  %s\n' $missing >&2
    log 'AVISO: para probarlas con datos, mise run db:replica:local (copia en la base propia del worktree).'
  fi
}

# ---------------------------------------------------------------------- comandos

write_cache() { # vuelca la base ya anonimizada del contenedor efímero a la caché
  mkdir -p "$CACHE_DIR"
  chmod 700 "$CACHE_DIR"
  local ts tmp tmp_meta sha last_mig counts_json
  ts=$(date -u +%Y%m%dT%H%M%SZ)
  tmp=$(mktemp "$CACHE_DIR/.dump.XXXXXX"); TMP_FILES+=("$tmp")
  tmp_meta=$(mktemp "$CACHE_DIR/.meta.XXXXXX"); TMP_FILES+=("$tmp_meta")
  chmod 600 "$tmp" "$tmp_meta"
  svc_dump "$SCRATCH" "$PROD_SCHEMA" | gzip -n > "$tmp"
  gzip -t "$tmp"
  sha=$(sha256sum "$tmp" | cut -d' ' -f1)
  last_mig=$(scratch_mysql -N "$PROD_SCHEMA" -e 'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name DESC LIMIT 1')
  counts_json=$(table_counts scratch_mysql "$PROD_SCHEMA" | node -e '
    const rows = require("fs").readFileSync(0, "utf8").trim().split("\n").filter(Boolean);
    process.stdout.write(JSON.stringify(Object.fromEntries(rows.map((r) => { const [t, n] = r.split("\t"); return [t, Number(n)]; }))));')
  TS=$ts SHA=$sha LAST_MIG=$last_mig COUNTS=$counts_json ANON_SHA=$(sha256sum "$ANONYMIZE_SQL" | cut -d' ' -f1) \
  GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo unknown) \
  APP=$APP HOST=$PROD_SSH_HOST LABEL=$PROD_LABEL SCHEMA=$PROD_SCHEMA node -e '
    const e = process.env;
    const meta = {
      app: e.APP,
      createdAt: new Date().toISOString(),
      file: `${e.TS}.sql.gz`,
      sha256: e.SHA,
      source: { sshHost: e.HOST, containerLabel: e.LABEL, schema: e.SCHEMA, engine: "mysql" },
      anonymized: true,
      anonymizeSqlSha256: e.ANON_SHA,
      repoCommit: e.GIT_COMMIT,
      lastMigration: e.LAST_MIG || null,
      rowCounts: JSON.parse(e.COUNTS || "{}"),
    };
    process.stdout.write(JSON.stringify(meta, null, 2) + "\n");' > "$tmp_meta"
  # Escritura atómica: rename dentro del mismo directorio; latest.* son enlaces
  # duros al último volcado, sustituidos también con rename.
  mv -f "$tmp" "$CACHE_DIR/$ts.sql.gz"
  mv -f "$tmp_meta" "$CACHE_DIR/$ts.meta.json"
  ln -f "$CACHE_DIR/$ts.sql.gz" "$CACHE_DIR/.latest.sql.gz.tmp"
  mv -f "$CACHE_DIR/.latest.sql.gz.tmp" "$CACHE_DIR/latest.sql.gz"
  ln -f "$CACHE_DIR/$ts.meta.json" "$CACHE_DIR/.latest.meta.json.tmp"
  mv -f "$CACHE_DIR/.latest.meta.json.tmp" "$CACHE_DIR/latest.meta.json"
  # Conservar las $KEEP últimas.
  local old
  old=$(find "$CACHE_DIR" -maxdepth 1 -name '2*.sql.gz' -printf '%f\n' | sort -r | tail -n +$((KEEP + 1)))
  for f in $old; do rm -f -- "$CACHE_DIR/$f" "$CACHE_DIR/${f%.sql.gz}.meta.json"; done
  log "Caché guardada: $CACHE_DIR/$ts.sql.gz (sha256 $sha)."
}

refresh() {
  need_env
  command -v ssh >/dev/null || die 'Falta ssh.'
  # Antes de tocar producción: la réplica debe poder arrancar.
  replica_up
  log "Arrancando la MySQL efímera en RAM ($SCRATCH)."
  SCRATCH_UP=1
  compose up --detach --wait --wait-timeout 180 "$SCRATCH" >&2
  recreate_db scratch_mysql "$PROD_SCHEMA"
  log "Volcando producción ($PROD_SSH_HOST, $PROD_LABEL, esquema $PROD_SCHEMA) en streaming."
  prod "$PROD_DUMP" < /dev/null | filter_dump | scratch_mysql "$PROD_SCHEMA"

  log 'Recuento de filas: producción frente a la copia efímera (antes de anonimizar).'
  local scratch_counts prod_counts
  scratch_counts=$(table_counts scratch_mysql "$PROD_SCHEMA")
  # Solo SELECT COUNT(*): la consulta viaja por stdin al mysql del contenedor de prod.
  prod_counts=$(printf '%s;\n' "$(counts_query scratch_mysql "$PROD_SCHEMA")" | prod "$PROD_QUERY")
  compare_counts prod "$prod_counts" efímera "$scratch_counts"

  log 'Anonimizando.'
  scratch_mysql "$PROD_SCHEMA" < "$ANONYMIZE_SQL"
  verify scratch_mysql "$PROD_SCHEMA"
  write_cache
  stop_scratch

  load_shared
  log 'Recuento de filas: producción frente a la réplica compartida.'
  compare_counts prod "$prod_counts" réplica "$(table_counts replica_mysql "$REPLICA_DB")" "$EMPTIED_TABLES"
  log "Réplica compartida lista desde producción. Los worktrees la usan con mise run db:replica:use-shared (o mise run setup)."
}

use_shared() {
  need_env
  replica_up
  if ! replica_has_data; then
    [ -f "$CACHE_DIR/latest.sql.gz" ] || die 'La réplica compartida está vacía y no hay caché: ejecuta mise run db:replica:refresh.'
    log 'La réplica compartida está vacía: se carga la caché anonimizada (una vez).'
    load_shared
  fi
  point_env shared "$CRED_FILE"
  warn_branch_migrations
}

connect() {
  need_env
  if [ "$(env_get DATABASE_TARGET)" = local ]; then
    log 'La app usa la copia local de la réplica (db:replica:local); no se cambia. Para la compartida: mise run db:replica:use-shared.'
    return 0
  fi
  if [ ! -f "$CRED_FILE" ] && [ ! -f "$CACHE_DIR/latest.sql.gz" ]; then
    log 'AVISO: no hay réplica compartida ni caché: la app usa la base propia del worktree (vacía).'
    log 'AVISO: para crearla (necesita ssh coolify-new): mise run db:replica:refresh.'
    point_env worktree
    return 0
  fi
  if bash "$0" use-shared; then return 0; fi
  log 'AVISO: no se ha podido usar la réplica compartida: la app usa la base propia del worktree (vacía).'
  point_env worktree
}

load_local() {
  need_env
  local db
  db=$(env_get WORKTREE_DATABASE_NAME)
  [[ $db =~ ^[A-Za-z0-9_]+$ ]] || die "WORKTREE_DATABASE_NAME no válido en .env: '$db' (ejecuta mise run setup)."
  [[ $db != *_testing ]] || die 'WORKTREE_DATABASE_NAME apunta a una base _testing: no se toca.'
  if [ ! -f "$CACHE_DIR/latest.sql.gz" ]; then
    log "No hay caché en $CACHE_DIR/latest.sql.gz: se hace un refresh desde producción."
    refresh
  fi
  check_services
  check_cache
  ON_ERROR_FN=local_mysql ON_ERROR_DB=$db
  recreate_db local_mysql "$db"
  gzip -dc "$CACHE_DIR/latest.sql.gz" | filter_dump | local_mysql "$db"
  verify local_mysql "$db"
  ON_ERROR_FN=''
  log 'Aplicando las migraciones de la rama a la base del worktree (prisma migrate deploy).'
  node scripts/worktree-db.mjs npm run --silent db:migrate
  point_env local
  log 'Copia local lista. e2e y ux:capture la borrarán (usan esta base); para volver a la compartida: mise run db:replica:use-shared.'
}

replica_down() {
  local purge=0
  case "${1:-}" in
    '') ;;
    --purge) purge=1 ;;
    *) die "Uso: db-replica.sh down [--purge]" ;;
  esac
  if replica_exists; then
    replica_is_ours || die "El contenedor $REPLICA_NAME no es de este script: no se toca."
    log "Parando la réplica compartida $REPLICA_NAME (el volumen se conserva)."
    "$ENGINE" stop "$REPLICA_NAME" >/dev/null
  else
    log "No existe el contenedor $REPLICA_NAME."
  fi
  if [ "$purge" = 1 ]; then
    log "--purge: borrando el contenedor, el volumen $REPLICA_VOLUME y $CRED_FILE (la caché se conserva)."
    if replica_exists; then "$ENGINE" rm "$REPLICA_NAME" >/dev/null; fi
    if volume_exists; then "$ENGINE" volume rm "$REPLICA_VOLUME" >/dev/null; fi
    rm -f -- "$CRED_FILE"
  fi
  log 'Los worktrees que apuntan a la réplica no conectarán hasta mise run db:replica:up.'
}

case "${1:-}" in
  up) take_lock; replica_up; log "Réplica compartida arriba: 127.0.0.1:$REPLICA_PORT ($(replica_has_data && echo con datos || echo vacía))." ;;
  down) take_lock; replica_down "${2:-}" ;;
  refresh) take_lock; refresh ;;
  use-shared) take_lock; use_shared ;;
  connect) connect || { log 'AVISO: db:replica connect ha fallado; revisa el .env.'; true; } ;;
  local) take_lock; load_local ;;
  *) echo "Uso: $0 up|down [--purge]|refresh|connect|use-shared|local" >&2; exit 2 ;;
esac
