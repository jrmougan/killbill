#!/usr/bin/env bash
# Ralph loop for UX/UI fixes against the chosen EQUIL design (see scripts/ralph/README.md).
# Each iteration is a fresh agent run fed with PROMPT.md; state lives in prd.json,
# progress.md, findings/ and git. Stops on <promise>COMPLETE</promise> or after N runs.
#
#   bash scripts/ralph/ralph.sh [max-iterations]      (default 10)
#   RALPH_AGENT='codex exec --full-auto' bash scripts/ralph/ralph.sh 5
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
DIR=scripts/ralph
MAX=${1:-10}
AGENT=${RALPH_AGENT:-claude -p --dangerously-skip-permissions --output-format text}
LOGS=$DIR/logs
mkdir -p "$LOGS"

branch=$(git branch --show-current)
if [[ "$branch" == "main" ]]; then
  echo "ralph: refusing to run on main; create a branch first" >&2
  exit 1
fi
[[ -f .env ]] || { echo "ralph: no .env — run 'mise run setup' first" >&2; exit 1; }
[[ -n "$(ls -A "$DIR/design" 2>/dev/null)" ]] || node "$DIR/render-design.mjs"

remaining() { node -e "const p=require('./$DIR/prd.json');console.log(p.stories.filter(s=>!s.passes).length)"; }

for ((i = 1; i <= MAX; i++)); do
  left=$(remaining)
  if [[ "$left" == 0 ]]; then
    echo "ralph: every story passes"
    exit 0
  fi
  log="$LOGS/$(date +%Y%m%d-%H%M%S)-iter$i.log"
  echo "ralph: iteration $i/$MAX ($left stories left) → $log"
  # shellcheck disable=SC2086 # AGENT is a command line on purpose
  $AGENT "$(cat "$DIR/PROMPT.md")" 2>&1 | tee "$log" || true
  if grep -q '<promise>COMPLETE</promise>' "$log"; then
    echo "ralph: complete after $i iterations"
    exit 0
  fi
done
echo "ralph: stopped after $MAX iterations ($(remaining) stories left)"
