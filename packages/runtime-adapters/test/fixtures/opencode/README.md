# OpenCode captures

Real `opencode run --format json` streams from opencode-ai 1.18.27, captured
2026-09-03 on Windows. They are the only source the `opencode-events` adapter
was built from.

One thing was replaced, and nothing else: the captured workspace was a
temporary directory under the operator's profile, and it reads `C:\work\pebble`
here — the same placeholder the Cursor fixtures use. `C:\Users\<operator>`
became `C:\Users\dev`. The streams carry no provider blobs and no system
prompt, so nothing else needed scrubbing.

| File | What it captures |
| --- | --- |
| `write-mode-read-and-write.jsonl` | Three steps: a `read` of the workspace, a `write` that creates `notes.txt` (`metadata.exists` is `false`), and a final `DONE`. |
| `resumed-turn.jsonl` | The same `sessionID` continued with `-s`; the model recalled the earlier turn and answered `DONE`. |
| `read-only-no-write-tool.jsonl` | Run with `OPENCODE_CONFIG_CONTENT` denying edit/write/bash/patch. The write tool is not offered at all; the run says so and lists the eight tools it did get. No file was created. |
| `plan-agent-text-only.jsonl` | `--agent plan`, kept as the evidence that plan mode is narration and not enforcement: the model announces "In PLAN MODE — read-only" and writes a plan instead of the file. |
| `compaction-small-context.jsonl` | 2026-09-25, the free Ling 3.0 Flash Fin with its context cut to 24,000 tokens in a scratch `OPENCODE_CONFIG_CONTENT`, asked to read six 38 KB files one at a time. After two reads OpenCode summarized (a step with no tool), printed its synthetic `compaction_continue` note, and went on to answer. The workspace path reads `C:\work\pebble`; the two `read` outputs and their display text are cut to six lines each, marked in place -- nothing else changed. |
| `context-overflow-recovered.jsonl` | 2026-09-25, OpenCode against a local OpenAI-compatible endpoint that refused the first request as too long (`context_length_exceeded`) and answered every later one: a `ContextOverflowError`, the summary step, the continue note, then `RECOVERED-ANSWER`. The process exited 1 (`run` does on any session error). Unedited: it carries no paths. |
| `rate-limited-1.18.27.stderr.txt` | 2026-09-25, `opencode run --print-logs --log-level WARN` against a local OpenAI-compatible endpoint answering every request 429 (`Rate limit exceeded`, `retry-after: 2`), stdin closed. The stderr, not the stdout: one `stream error` line per attempt of the `build` agent, one from the `title` agent, then the `process` line as it gave up (stdout then carried one `error` record, and the process exited 1 after 18s). Session and message ids replaced with `ses_captured` / `msg_captured`; the run's two `duplicate skill name` WARN lines are removed (Locust passes ERROR, which prints neither). |
| `rate-limited-free-1.18.27.stderr.txt` | 2026-09-26, the REAL free model rate limited: `opencode run --print-logs -m opencode/ling-3.0-flash-fin-free` during the 0.367 drive sweep, whose drives sat on "Starting" for six minutes. Its two ERROR lines, which are everything Locust's `--log-level ERROR` would print: one `stream error` from the `build` agent (`Rate limit exceeded. Please try again later.`) and the `title` agent giving up after three quick attempts -- and then nothing for the next minute, when the run was stopped. Unlike the local endpoint above, the real provider's wait is minutes, so a second `build` line is minutes away. Session id replaced with `ses_captured`. |
