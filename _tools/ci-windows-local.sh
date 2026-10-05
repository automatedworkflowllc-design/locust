#!/usr/bin/env bash
# The Windows CI job's steps, in one place (2026-10-05).
#
#   bash _tools/ci-windows-local.sh            every step in order, timed: the
#                                              laptop's rehearsal of the job
#   bash _tools/ci-windows-local.sh <step>     one step; the workflow
#                                              (.github/workflows/windows-build.yml)
#                                              runs each as its own step
#
# Steps, in order: install, typecheck, suites, package, hash.
#
# The workflow does not repeat these commands, it calls this script, so the
# rehearsal and GitHub's run cannot drift apart: what is green here is what
# runs there. The suites are listed in _tools/ci-windows-suites.txt. What the
# workflow adds around the script -- checkout, pnpm and Node, the cached
# store, the artifact upload -- is the part this cannot exercise; docs/CI-WINDOWS.md
# names it.
#
# Never pushes, publishes, signs or bumps anything. The package lands in this
# checkout's own apps/desktop/release.
set -euo pipefail
W="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP="$W/apps/desktop"
RELEASE="$DESKTOP/release"
SUITES="$W/_tools/ci-windows-suites.txt"

# No signing: there is no certificate, and electron-builder must not go
# looking for one in the machine's store.
export CSC_IDENTITY_AUTO_DISCOVERY=false

# Read from inside the folder: Git Bash turns a /d/... argument into D:/...
# for node, but not a path written inside a script string.
version() { (cd "$DESKTOP" && node -p "require('./package.json').version"); }

step_install() {
  cd "$W" && pnpm install --frozen-lockfile
}

# As _tools/gate.sh does it: the two workspace packages are compiled first,
# because the desktop's configs read their emitted types; then both desktop
# configs.
step_typecheck() {
  (cd "$W/packages/runtime-adapters" && npx tsc -p tsconfig.json)
  (cd "$W/packages/mission-store" && npx tsc -p tsconfig.json)
  cd "$DESKTOP"
  npx tsc --noEmit -p tsconfig.node.json
  npx tsc --noEmit -p tsconfig.web.json
}

step_suites() {
  # Scratch in one folder, as the gate keeps it (an antivirus scanning
  # thousands of temp folders in %TEMP% timed tests out, 2026-09-30).
  local scratch="${LOCUST_GATE_TMP:-$(cd "$W/.." && pwd)/.tmp}"
  mkdir -p "$scratch"
  export TMP="$scratch" TEMP="$scratch" TMPDIR="$scratch"
  # On the laptop, the gate's own rule: not while another vitest runs, and
  # exit 75 (wait and retry) rather than a red that is not real. A runner is
  # a fresh machine running nothing else.
  if [ -z "${GITHUB_ACTIONS:-}" ]; then
    node "$W/_tools/gate-support.mjs" quiet "$W" "$scratch" || exit $?
  fi
  local dir
  while IFS= read -r dir; do
    dir="${dir%$'\r'}"
    case "$dir" in ''|'#'*) continue ;; esac
    echo "suite: $dir"
    # The reporter is named for the reason gate.sh gives: vitest picks a terse
    # one when it sees an AI agent run it.
    (cd "$W/$dir" && npx vitest run --reporter=default)
  done < "$SUITES"
}

# What _tools/ship.mjs runs to make the unsigned NSIS installer -- stage npm
# and the recall model, `pnpm build`, then electron-builder -- with ONE
# difference, `--publish never`. ship.mjs runs `pnpm --filter @teammate/desktop
# package`, whose electron-builder takes the default publish policy: on a CI
# runner building a tag (GITHUB_REF_TYPE=tag, which a workflow cannot
# override) that policy is "onTag", and the builder would try to upload to
# locust-releases. Nothing goes there from CI. The package script's second
# electron-vite build (pnpm build already made out/) and its prune of old
# installers are left out: neither changes what is packaged.
step_package() {
  cd "$W"
  node _tools/vendor-npm.mjs
  node _tools/vendor-recall.mjs
  pnpm build
  cd "$DESKTOP"
  pnpm exec electron-builder --config electron-builder.yml --win --publish never
}

# The installer's hash and size, for a reviewer to set beside the laptop's
# build of the same commit; app.asar's too, since an NSIS installer carries
# its own build time and two builds of one commit need not hash alike.
step_hash() {
  local v installer blockmap yml asar sha size asar_sha
  v="$(version)"
  installer="$RELEASE/Locust-$v-setup.exe"
  blockmap="$installer.blockmap"
  yml="$RELEASE/latest.yml"
  asar="$RELEASE/win-unpacked/resources/app.asar"
  for f in "$installer" "$blockmap" "$yml" "$asar"; do
    [ -f "$f" ] || { echo "missing: $f" >&2; exit 1; }
  done
  grep -q "^version: $v\$" "$yml" || { echo "latest.yml does not say version: $v" >&2; exit 1; }
  sha="$(sha256sum "$installer" | cut -d' ' -f1)"
  size="$(wc -c < "$installer" | tr -d ' ')"
  asar_sha="$(sha256sum "$asar" | cut -d' ' -f1)"
  # A tag says which version it builds; a package.json that disagrees would
  # put another version's name on the installer.
  local label="${CI_LABEL:-}"
  if [ "${GITHUB_REF_TYPE:-}" = tag ] && [ "$label" != "v$v" ]; then
    echo "tag $label does not match apps/desktop/package.json version $v" >&2
    exit 1
  fi
  echo "version:   $v${label:+ (label $label)}"
  echo "commit:    $(git -C "$W" rev-parse HEAD)"
  echo "installer: Locust-$v-setup.exe"
  echo "size:      $size bytes ($(( size / 1048576 )) MB)"
  echo "sha256:    $sha"
  echo "app.asar:  $asar_sha"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "version=$v" >> "$GITHUB_OUTPUT"
  fi
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    {
      echo "## Locust $v, Windows (unsigned)"
      echo
      echo "| | |"
      echo "|---|---|"
      [ -n "$label" ] && echo "| Label | \`$label\` |"
      echo "| Commit | \`$(git -C "$W" rev-parse HEAD)\` |"
      echo "| Installer | \`Locust-$v-setup.exe\` |"
      echo "| Size | $size bytes ($(( size / 1048576 )) MB) |"
      echo "| SHA-256 | \`$sha\` |"
      echo "| app.asar SHA-256 | \`$asar_sha\` |"
      echo
      echo "Unsigned. The suites that drive a window still run only on the laptop (docs/CI-WINDOWS.md)."
    } >> "$GITHUB_STEP_SUMMARY"
  fi
}

STEPS=(install typecheck suites package hash)

if [ $# -gt 0 ]; then
  case " ${STEPS[*]} " in
    *" $1 "*) "step_$1" ;;
    *) echo "usage: $0 [install|typecheck|suites|package|hash]" >&2; exit 2 ;;
  esac
  exit 0
fi

# Every step, timed. Each runs as its own process, exactly as the workflow
# runs it: a `cd` in one cannot move the next, and set -e holds inside it (a
# function called on the left of `||` would run with set -e switched off).
times=()
for s in "${STEPS[@]}"; do
  echo "=== $s"
  start=$(date +%s)
  bash "${BASH_SOURCE[0]}" "$s" || { rc=$?; echo "=== $s FAILED (exit $rc)"; exit "$rc"; }
  times+=("$s $(( $(date +%s) - start ))s")
done
echo "=== times"
printf '  %s\n' "${times[@]}"
echo "CI-WINDOWS LOCAL PASSED"
