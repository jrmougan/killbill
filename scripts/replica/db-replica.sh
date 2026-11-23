#!/usr/bin/env bash
# Réplica local anonimizada de la base de producción (docs/prod-replica.md).
#
#   db-replica.sh load     Carga la caché anonimizada; si no hay caché, hace refresh.
#   db-replica.sh refresh  Vuelca producción en streaming, anonimiza, verifica y
#                          guarda la caché.
#
# Las dos recrean desde cero la BD de este worktree (DATABASE_NAME de .env) y
# acaban con `prisma migrate deploy`. En producción solo se lee: mysqldump y
# SELECT COUNT(*) dentro del contenedor, con la contraseña de root de su propio
# entorno, que nunca sale del VPS. Los datos sin anonimizar no se escriben en
# disco: van de ssh a la MySQL local por una tubería.
set -Eeuo pipefail
umask 077
cd "$(dirname "$0")/../.."

APP=killbill
PROD_SSH_HOST=${REPLICA_SSH_HOST:-coolify-new}
PROD_LABEL=mysql-database-w10cwycdwgjebrdedi1oxxgr
PROD_SCHEMA=killbill
CACHE_DIR=${XDG_DATA_HOME:-$HOME/.local/share}/prod-replicas/$APP
KEEP=3
ANONYMIZE_SQL=scripts/replica/anonymize.sql
VERIFY_SQL=scripts/replica/verify.sql

log() { printf '[db:replica] %s\n' "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

[ -f .env ] || die 'Falta .env: ejecuta antes mise run setup.'
DB_NAME=$(node -e 'process.loadEnvFile(); process.stdout.write(process.env.DATABASE_NAME || "")')
[[ $DB_NAME =~ ^[A-Za-z0-9_]+$ ]] || die "DATABASE_NAME no válido en .env: '$DB_NAME'."
[[ $DB_NAME != *_testing ]] || die 'DATABASE_NAME apunta a una base _testing: no se toca.'

TMP_FILES=()
cleanup() { [ ${#TMP_FILES[@]} -eq 0 ] || rm -f -- "${TMP_FILES[@]}"; }
trap cleanup EXIT

compose() { node --env-file=.env scripts/dev-compose.mjs "$@"; }
# mysql/mysqldump como root DENTRO del contenedor local (el host no tiene cliente).
local_mysql() {
  compose exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot --default-character-set=utf8mb4 "$@"' sh "$@"
}
local_dump() {
  compose exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction --routines --triggers --events --no-tablespaces --set-gtid-purged=OFF "$1"' sh "$1"
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
  ssh -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 "$PROD_SSH_HOST" "$(remote_cmd "$1")"
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
    || die 'La MySQL local no responde: ejecuta mise run services:up.'
}

recreate_db() {
  log "Recreando la base local '$DB_NAME' desde cero."
  local_mysql -e "DROP DATABASE IF EXISTS \`$DB_NAME\`; CREATE DATABASE \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
}

# Ante cualquier fallo tras empezar a cargar, la BD queda vacía (sin datos a medias).
EMPTY_ON_ERROR=0
on_error() {
  if [ "$EMPTY_ON_ERROR" = 1 ] && [ "$BASH_SUBSHELL" = 0 ]; then
    EMPTY_ON_ERROR=0
    log 'Fallo: se deja la base local vacía. Ejecuta mise run db:migrate para usarla sin datos.'
    recreate_db || true
  fi
}
trap on_error ERR

table_counts() { # tabla<TAB>filas de la BD local, orden alfabético
  local tables q=''
  tables=$(local_mysql -N -e "SELECT table_name FROM information_schema.tables WHERE table_schema='$DB_NAME' AND table_type='BASE TABLE' ORDER BY 1")
  for t in $tables; do q+="${q:+ UNION ALL }SELECT '$t', COUNT(*) FROM \`$t\`"; done
  [ -n "$q" ] || return 0
  printf '%s;\n' "$q" | "$@"
}

verify() {
  local out failed
  out=$(local_mysql -N "$DB_NAME" < "$VERIFY_SQL")
  failed=$(printf '%s\n' "$out" | awk -F'\t' '$2 != 0 { print "  - " $1 ": " $2 }')
  if [ -n "$failed" ]; then
    log 'La verificación de anonimización ha fallado (comprobación: filas):'
    printf '%s\n' "$failed" >&2
    return 1
  fi
  log "Verificación de anonimización: $(printf '%s\n' "$out" | grep -c .) comprobaciones a 0."
}

migrate() {
  log 'Aplicando las migraciones de la rama (prisma migrate deploy).'
  npm run --silent db:migrate
}

write_cache() {
  mkdir -p "$CACHE_DIR"
  chmod 700 "$CACHE_DIR"
  local ts tmp tmp_meta sha last_mig counts_json
  ts=$(date -u +%Y%m%dT%H%M%SZ)
  tmp=$(mktemp "$CACHE_DIR/.dump.XXXXXX"); TMP_FILES+=("$tmp")
  tmp_meta=$(mktemp "$CACHE_DIR/.meta.XXXXXX"); TMP_FILES+=("$tmp_meta")
  chmod 600 "$tmp" "$tmp_meta"
  local_dump "$DB_NAME" | gzip -n > "$tmp"
  gzip -t "$tmp"
  sha=$(sha256sum "$tmp" | cut -d' ' -f1)
  last_mig=$(local_mysql -N "$DB_NAME" -e 'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name DESC LIMIT 1')
  counts_json=$(table_counts local_mysql -N "$DB_NAME" | node -e '
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
  check_services
  command -v ssh >/dev/null || die 'Falta ssh.'
  EMPTY_ON_ERROR=1
  recreate_db
  log "Volcando producción ($PROD_SSH_HOST, $PROD_LABEL, esquema $PROD_SCHEMA) en streaming."
  prod "$PROD_DUMP" < /dev/null | filter_dump | local_mysql "$DB_NAME"

  log 'Recuento de filas: producción frente a la copia local (antes de anonimizar).'
  local local_counts prod_counts
  local_counts=$(table_counts local_mysql -N "$DB_NAME")
  prod_counts=$(table_counts prod "$PROD_QUERY")
  LC_ALL=C join -t $'\t' -a1 -a2 -e '?' -o 0,1.2,2.2 \
    <(printf '%s\n' "$prod_counts" | LC_ALL=C sort) <(printf '%s\n' "$local_counts" | LC_ALL=C sort) \
    | awk -F'\t' 'BEGIN { printf "  %-22s %8s %8s\n", "tabla", "prod", "local" }
                  { printf "  %-22s %8s %8s%s\n", $1, $2, $3, ($2 == $3 ? "" : "  <- DISTINTO"); if ($2 != $3) bad = 1 }
                  END { if (bad) print "[db:replica] AVISO: hay recuentos distintos; producción puede haber cambiado durante el volcado." > "/dev/stderr" }' >&2

  log 'Anonimizando.'
  local_mysql "$DB_NAME" < "$ANONYMIZE_SQL"
  verify
  EMPTY_ON_ERROR=0
  write_cache
  migrate
  log 'Réplica lista (desde producción).'
}

load() {
  local latest=$CACHE_DIR/latest.sql.gz meta=$CACHE_DIR/latest.meta.json
  if [ ! -f "$latest" ]; then
    log "No hay caché en $latest: se hace un refresh desde producción."
    refresh
    return
  fi
  check_services
  if [ -f "$meta" ]; then
    local want got
    want=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).sha256 || "")' "$meta")
    got=$(sha256sum "$latest" | cut -d' ' -f1)
    [ "$want" = "$got" ] || die "El sha256 de $latest no coincide con latest.meta.json; ejecuta mise run db:replica:refresh."
    log "Cargando la caché anonimizada del $(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).createdAt)' "$meta")."
  fi
  EMPTY_ON_ERROR=1
  recreate_db
  gzip -dc "$latest" | filter_dump | local_mysql "$DB_NAME"
  verify
  EMPTY_ON_ERROR=0
  migrate
  log 'Réplica lista (desde la caché).'
}

case "${1:-}" in
  load) load ;;
  refresh) refresh ;;
  *) echo "Uso: $0 load|refresh" >&2; exit 2 ;;
esac
