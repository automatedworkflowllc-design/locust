#!/usr/bin/env bash
# What is a Claude run's first prompt made of? Three Haiku turns, one word
# each, from an empty folder, differing only in how connectors are offered.
# Written as a file, not a heredoc: heredocs here eat backslashes.
set -u
OUT="$(cd "$(dirname "$0")" && pwd)/weight"
mkdir -p "$OUT"
WS="$(mktemp -d)"
cd "$WS" || exit 1
BASE=(--restricted --print --output-format stream-json --verbose --include-partial-messages --permission-mode acceptEdits --model haiku)
run() {
  local name="$1"; shift
  echo "Reply with OK." | claude "${BASE[@]}" "$@" > "$OUT/$name.jsonl" 2> "$OUT/$name.err"
  echo "$name exit $?"
}
run a-locust --tools "Read,Glob,Grep,Edit,Write,NotebookEdit,Bash,Task,mcp__*"
run b-no-connectors --tools "Read,Glob,Grep,Edit,Write,NotebookEdit,Bash,Task"
run c-strict-mcp --tools "Read,Glob,Grep,Edit,Write,NotebookEdit,Bash,Task,mcp__*" --strict-mcp-config
rm -rf "$WS"
