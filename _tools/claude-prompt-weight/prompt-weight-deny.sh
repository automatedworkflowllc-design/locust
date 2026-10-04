#!/usr/bin/env bash
# Run G: Locust's flags, with every connector server but one disallowed.
# Does a disallowed server's schema leave the prompt, or only its calls?
set -u
OUT="$(cd "$(dirname "$0")" && pwd)/weight"
mkdir -p "$OUT"
WS="$(mktemp -d)"
cd "$WS" || exit 1
DENY="mcp__claude_ai_Robinhood__*,mcp__claude_ai_Figma__*,mcp__claude_ai_Gmail__*,mcp__claude_ai_Zapier__*,mcp__claude_ai_Clay__*,mcp__claude_ai_Google_Drive__*,mcp__claude_ai_Google_Calendar__*,mcp__claude_ai_Claude_Docs__*,mcp__claude_ai_Notion__*,mcp__claude_ai_Canva__*"
echo "Reply with OK." | claude --restricted --print --output-format stream-json --verbose --include-partial-messages --permission-mode acceptEdits --model haiku --tools "Read,Glob,Grep,Edit,Write,NotebookEdit,Bash,Task,mcp__*" --disallowedTools "$DENY" > "$OUT/g-deny-all-but-one.jsonl" 2> "$OUT/g-deny-all-but-one.err"
echo "g-deny-all-but-one exit $?"
rm -rf "$WS"
