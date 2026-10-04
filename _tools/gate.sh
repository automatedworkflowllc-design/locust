#!/usr/bin/env bash
# The one gate before a Locust commit: the type configs, then every suite.
# Exits non-zero on the first failure, so read `$?` (or `gate.sh && commit`)
# and a red gate can never be committed.
#
#   bash _tools/gate.sh > gate.log 2>&1; echo "gate exit $?"; grep -E "Tests |GATE" gate.log
#
# Run from anywhere: the repository is found from this file's own place.
set -e
W="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Scratch files inside one folder (2026-09-30): the suites make thousands of
# temp folders, and an antivirus scanning each one in %TEMP% pinned the CPU
# and timed tests out. Clear old locust-* folders there before a long run.
SCRATCH="${LOCUST_GATE_TMP:-$(cd "$W/.." && pwd)/.tmp}"
mkdir -p "$SCRATCH"
export TMP="$SCRATCH" TEMP="$SCRATCH" TMPDIR="$SCRATCH"
LOGS="$(mktemp -d)"
# The recall model its tests run (no network once staged; hashes checked).
node "$W/_tools/vendor-recall.mjs" > /dev/null
cd "$W/packages/runtime-adapters" && npx tsc -p tsconfig.json
cd "$W/packages/mission-store" && npx tsc -p tsconfig.json
cd "$W/apps/desktop"
npx tsc --noEmit -p tsconfig.node.json
npx tsc --noEmit -p tsconfig.web.json
cd "$W/packages/runtime-adapters" && npx vitest run > "$LOGS/ra.log" 2>&1 || { tail -30 "$LOGS/ra.log"; echo "GATE: adapters FAILED"; exit 1; }
cd "$W/packages/mission-store" && npx vitest run > "$LOGS/ms.log" 2>&1 || { tail -30 "$LOGS/ms.log"; echo "GATE: mission-store FAILED"; exit 1; }
cd "$W/apps/desktop" && npx vitest run > "$LOGS/d.log" 2>&1 || { grep -E "×|FAIL" "$LOGS/d.log" | head -20; echo "GATE: desktop FAILED"; exit 1; }
grep -h "Tests " "$LOGS/ra.log" "$LOGS/ms.log" "$LOGS/d.log"
echo "GATE PASSED"
