#!/usr/bin/env bash
#
# PRODUCTION migration runbook for the feat/personal-shared-expenses-and-ia release.
#
# WHY THIS EXISTS
#   Coolify runs `prisma migrate deploy` on release, which executes ONLY migration
#   SQL — never the backfill scripts. For this release that is unsafe:
#     * phase3_ledger creates EMPTY ledger tables; without backfill-ledger.ts the
#       dashboard (which reads balances from the ledger) shows 0 for everyone.
#     * phase2b creates an EMPTY Category table + nullable categoryId; without the
#       category backfill, phase4_budget_unique_swap's `categoryId NOT NULL` FAILS
#       the deploy if any Budget exists, and categories break.
#     * phase4_check_constraints ADD CHECK fails the deploy if any amount<=0 row
#       exists (must pre-validate).
#     * phase5_contract_drops irreversibly drops the columns the backfills READ, so
#       backfills MUST run before it.
#
#   This runbook applies the migrations OUT-OF-BAND with the backfills interleaved
#   in the correct order, then marks every migration `--applied` so Coolify's
#   `prisma migrate deploy` finds nothing pending (a no-op) after you merge.
#
# USAGE (run from the repo root, on the merged/branch code):
#   export DATABASE_URL='mysql://USER:PASS@PROD_HOST:3306/DBNAME'   # <-- PRODUCTION
#   export I_UNDERSTAND_THIS_IS_PROD=yes
#   bash scripts/prod-migrate-runbook.sh
#
#   Optional: BACKUP_DONE=yes  (skip the built-in mysqldump if you backed up yourself)
#
# It stops on the first error and PAUSES for a typed confirmation before the
# irreversible contract-drops. If anything fails, RESTORE FROM THE BACKUP before
# retrying — the migrations are not idempotent.

set -Eeuo pipefail

STEP="startup"
trap 'echo; echo "✗ FAILED during: $STEP"; echo "  The DB may be partially migrated. Restore from the backup before retrying."; exit 1' ERR

require() { [ -n "${!1:-}" ] || { echo "✗ Missing required env var: $1"; exit 1; }; }

# ---------------------------------------------------------------------------
# Guards
# ---------------------------------------------------------------------------
require DATABASE_URL
[ "${I_UNDERSTAND_THIS_IS_PROD:-}" = "yes" ] || {
  echo "✗ Refusing to run. Set I_UNDERSTAND_THIS_IS_PROD=yes once you have pointed"
  echo "  DATABASE_URL at PRODUCTION and are ready. This performs IRREVERSIBLE DDL."
  exit 1
}

# Parse host/db (mask password) for the confirmation banner and for mysqldump.
eval "$(node -e '
  const u = new URL(process.env.DATABASE_URL);
  const q = s => "'"'"'" + String(s).replace(/'"'"'/g,"'"'"'\\'"'"''"'"'") + "'"'"'";
  process.stdout.write(
    "DB_HOST="+q(u.hostname)+"\n"+
    "DB_PORT="+q(u.port||"3306")+"\n"+
    "DB_USER="+q(decodeURIComponent(u.username))+"\n"+
    "DB_PASS="+q(decodeURIComponent(u.password))+"\n"+
    "DB_NAME="+q(u.pathname.slice(1))+"\n");
')"

echo "=========================================================================="
echo " EQUIL production migration runbook"
echo "   host : $DB_HOST:$DB_PORT"
echo "   db   : $DB_NAME"
echo "   user : $DB_USER"
echo "=========================================================================="
read -r -p "Is THIS the production database, and have you told the team? Type 'yes': " ans
[ "$ans" = "yes" ] || { echo "Aborted."; exit 1; }

confirm() { echo; echo "!!! $1"; read -r -p "    Type 'yes' to continue: " a; [ "$a" = "yes" ] || { echo "Aborted."; exit 1; }; }

apply() { # apply one migration SQL out-of-band, then record it as applied
  local name="$1"; STEP="apply $name"
  echo ">>> apply migration: $name"
  npx prisma db execute --file "prisma/migrations/$name/migration.sql" --schema prisma/schema.prisma
  npx prisma migrate resolve --applied "$name"
  echo "    ✓ applied + resolved"
}

reconcile() { STEP="reconcile-ledger"; echo ">>> reconcile-ledger (gate — aborts on mismatch)"; npx tsx scripts/reconcile-ledger.ts; }

# ---------------------------------------------------------------------------
# 0. Backup + read-only pre-flight
# ---------------------------------------------------------------------------
STEP="backup"
if [ "${BACKUP_DONE:-}" = "yes" ]; then
  echo ">>> backup: skipped (BACKUP_DONE=yes) — you confirmed a manual backup."
else
  BK="prod-backup-$(node -e 'process.stdout.write(String(Date.parse(new Date().toISOString())))').sql"
  echo ">>> backup: mysqldump -> $BK"
  MYSQL_PWD="$DB_PASS" mysqldump -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" \
    --set-gtid-purged=OFF --single-transaction --routines --triggers "$DB_NAME" > "$BK"
  echo "    ✓ backup written: $BK  ($(wc -l < "$BK") lines)"
fi

STEP="validate-check-constraints"
echo ">>> pre-flight: validate-check-constraints.ts (read-only; aborts if any amount<=0 etc.)"
npx tsx scripts/validate-check-constraints.ts

# ---------------------------------------------------------------------------
# 1. Expand migrations (additive) — through phase3_ledger (creates empty tables)
# ---------------------------------------------------------------------------
for m in \
  20260704000000_add_personal_expenses_and_budgets \
  20260704090000_phase0_hygiene_currency \
  20260704093000_phase1_group_membership \
  20260708120000_phase2a_split_strategy \
  20260708130000_phase2b_category_table \
  20260708140000_phase2c_receipt_line_items \
  20260708150000_phase2d_recurring_series \
  20260708160000_phase2e_budget_periods \
  20260708170000_phase3_ledger ; do
  apply "$m"
done

# ---------------------------------------------------------------------------
# 2. Backfills (BEFORE the constraint tightening + the contract drops)
# ---------------------------------------------------------------------------
STEP="backfill-categories"
echo ">>> backfill: system categories + Expense/Budget.categoryId (raw SQL)"
npx prisma db execute --file scripts/prod-backfill-categories.sql --schema prisma/schema.prisma
echo "    ✓ categories seeded + categoryId backfilled"

STEP="backfill-ledger"
echo ">>> backfill: ledger from existing shared expenses + confirmed settlements"
npx tsx scripts/backfill-ledger.ts

reconcile

# ---------------------------------------------------------------------------
# 3. Phase-4 tightening (constraints + budget unique swap — now safe)
# ---------------------------------------------------------------------------
for m in \
  20260708180000_phase4_budget_periods_read \
  20260708190000_phase4_recurring_sync \
  20260708200000_phase4_recurring_template_ptr \
  20260708220000_phase4_check_constraints \
  20260708260000_phase4_budget_unique_swap ; do
  apply "$m"
done

reconcile

# ---------------------------------------------------------------------------
# 4. Contract drops (IRREVERSIBLE) + the final additive migration
# ---------------------------------------------------------------------------
confirm "Next step DROPS columns irreversibly (receiptData, isRecurring*, Budget.month, the category ENUM, User.coupleId). Backups + reconcile are green above."
apply 20260709100000_phase5_contract_drops
apply 20260709200000_import_fingerprint

reconcile

STEP="done"
echo
echo "=========================================================================="
echo " ✓ DONE. All 16 migrations applied + resolved, backfills done, reconcile green."
echo "   Coolify's 'prisma migrate deploy' on merge is now a NO-OP (nothing pending)."
echo "   Keep the backup until you have verified prod (balances, categories, budgets)."
echo "=========================================================================="
