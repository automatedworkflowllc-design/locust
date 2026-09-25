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
