#!/usr/bin/env bash
# Run D: Locust's flags with Claude Code's tool search forced on. If the
# connectors are deferred, the first prompt drops toward run C's 13k while
# the tools stay listed.
set -u
OUT="$(cd "$(dirname "$0")" && pwd)/weight"
mkdir -p "$OUT"
WS="$(mktemp -d)"
cd "$WS" || exit 1
echo "Reply with OK." | ENABLE_TOOL_SEARCH=true claude --restricted --print --output-format stream-json --verbose --include-partial-messages --permission-mode acceptEdits --model haiku --tools "Read,Glob,Grep,Edit,Write,NotebookEdit,Bash,Task,mcp__*" > "$OUT/d-tool-search.jsonl" 2> "$OUT/d-tool-search.err"
echo "d-tool-search exit $?"
rm -rf "$WS"
