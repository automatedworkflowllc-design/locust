#!/usr/bin/env bash
# Can a connector still be REACHED when tool search defers them? One harmless,
# read-only public connector (the Anthropic Economic Index), allowed alone,
# asked for by name -- with tool search forced on, and without (control).
set -u
OUT="$(cd "$(dirname "$0")" && pwd)/weight"
mkdir -p "$OUT"
WS="$(mktemp -d)"
cd "$WS" || exit 1
ASK="Using the Anthropic Economic Index connector, call its tool that lists countries and reply with only the number of countries it returned."
ARGS=(--restricted --print --output-format stream-json --verbose --include-partial-messages --permission-mode acceptEdits --model haiku --tools "Read,Glob,Grep,Edit,Write,NotebookEdit,Bash,Task,mcp__*" --allowedTools "mcp__claude_ai_Anthropic_Economic_Index__*")
echo "$ASK" | ENABLE_TOOL_SEARCH=true claude "${ARGS[@]}" > "$OUT/e-search-reach.jsonl" 2> "$OUT/e-search-reach.err"
echo "e-search-reach exit $?"
echo "$ASK" | claude "${ARGS[@]}" > "$OUT/f-plain-reach.jsonl" 2> "$OUT/f-plain-reach.err"
echo "f-plain-reach exit $?"
rm -rf "$WS"
