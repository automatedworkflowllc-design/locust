# Real Codex app-server recordings

Recorded on 2026-10-03 with installed **codex-cli 0.160.0**, requesting
**gpt-6-luna / low** on each `turn/start`, through Locust's existing
`startCodexAppServerRun`. `thread/start` reports the installation's default
`gpt-5.6-luna` before the per-turn selection; the recorded requests explicitly
select `gpt-6-luna`. No model-reroute notification was observed in these successful
recordings. This is evidence of the requested route, not independent proof of
the backend's internal model execution.

| Fixture | Observed live | Replay assertions |
| --- | --- | --- |
| `approval-declined.jsonl` | One `item/commandExecution/requestApproval` for printing `FIXTURE_APPROVAL`; answered `decline`, not approved. Tool completed as `declined`; final `APPROVAL_DECLINED`. 42 rows. | Strict outbound request/reply order; the request carries its command; declined tool is a failure receipt, never a successful one. |
| `file-change.jsonl` | `apply_patch` changed disposable `notes.txt` from `BEFORE\n` to `AFTER\n`; host read-back verified the file. Final `FILE_CHANGED`. 24 rows. | Recorded patch preserved, one matching `apply_patch` start/completion, same item id, successful receipt and final reply. |
| `steer.jsonl` | During the started two-second shell command, `turn/steer` was accepted for the active turn. Final `STEER_ACCEPTED`; no interrupt sent. 42 rows. | Same live turn id, successful steer RPC reply, no `turn/interrupt`, final replacement contains the steered answer. |

The replay process checks every outbound message against the recording before
releasing the next inbound messages. Notifications pass through the real
app-server client, run adapter, and event normalizer. It checks contiguous
event sequences, token usage, exactly one run start/completion, and process
cleanup. No real Codex is invoked by replay tests.

Each JSONL row is `{ "dir": "out" | "in", "message": ... }`, followed by
`{ "dir": "exit", "completion": ... }`. The last row records **the adapter's
completion receipt**, not a measured OS exit status: the adapter ends its owned
server tree when the turn ends. The recorder awaited child close. The manifest
`recording.json` summarizes the successful retained sessions.

## Scrubbing

Scrubbing happens before the recorder writes anything to fixture files:

- Scratch/home/rollout paths become `C:\fixture\codex`, `C:\fixture\home`
  and `/fixture/rollout.jsonl`; email addresses and known credential shapes are
  redacted. No credentials or account files were inspected.
- Thread/turn/item ids become correlated `fixture_id_N` values; session ids,
  process ids and the user agent become `[machine metadata removed]`.
- Wall-clock timestamps become zero (null stays null). Durations and token
  counts for these scratch runs remain. Git identity, base/developer instruction
  bodies, account, plan and credential fields are omitted.
- Legacy `codex/event/*` mirrors, raw-response notifications, reasoning text
  deltas, account/rate-limit readings and unrelated startup notifications are
  omitted. Completed reasoning items keep only their concise public summary;
  `content` is an empty array. Hidden chain-of-thought is never persisted here.

Wire shapes, ordering, prompts, tool commands, diffs, result text and token
breakdowns remain; these are scrubbed recordings, not invented server shapes.
The scrubber itself has a unit test and all three files have privacy guards.

## Limits and failed attempts

**No exhausted-limit fixture was obtained.** No attempt was made to exhaust
the account, manufacture a provider limit, or present ordinary usage as a hard
limit. Account readings are deliberately not retained as personal metadata.

There were six short requests in total: four successful turns (the first
approval capture was superseded) and two rejected starts saying
`model 'gpt-6-luna' is not enabled in rustponsesapi`. The file-change turn
succeeded between those two errors, and the final same-model approval/steer
attempts succeeded. No model or account was switched. An initial recorder
cleanup error was fixed; the unsuccessful recordings were not relabelled as
successful fixtures. Future failures use `failed-<scenario>.jsonl` so they
cannot overwrite a successful recording.

## Reproduction

Only run the recorder with explicit permission to spend the signed-in Codex
account's usage. It never installs, signs in, changes account settings, or
approves a tool request. It uses isolated git scratch folders outside AppData
and a 90-second bound per turn.

```sh
pnpm --filter @teammate/runtime-adapters build
LOCUST_SPEND=1 node _tools/record-codex-app-server-fixtures.mjs
# Optional bounded re-record of named scenarios:
LOCUST_SPEND=1 node _tools/record-codex-app-server-fixtures.mjs --only approval-declined,steer
pnpm --filter @teammate/runtime-adapters exec vitest run a-real-codex-session a-codex-schema-change
```

## Opt-in generated-schema check

```sh
LOCUST_CODEX_SCHEMA=1 pnpm --filter @teammate/runtime-adapters exec vitest run a-codex-schema-change
```

This runs `--version` and `app-server generate-json-schema` on the installed
fixture-pinned **0.160.0** CLI, not a model session. Without that flag, the one
installed-CLI test is skipped. It checks the inventory in
`test/codex-schema-read-fields.ts`, scoped by notification definition and tagged
item variant, including classified error enum values. A spelling elsewhere in
the schema cannot mask a missing field. Update the pin/inventory deliberately
when upgrading Codex or adding parser reads. The older snake_case/rate-window
aliases and `turn.threadId` fallback are documented compatibility reads without
a current canonical v2 schema location; the check does not claim to validate
those aliases or runtime behavior from a schema alone.

**Observed current drift:** the opt-in test fails for exactly
`ConfigWarningNotification.message`: generated 0.160.0 uses `summary`, while
`src/app-server-events.ts` still reads `params.message` for `configWarning`.
This task records and exposes that mismatch without changing the production
parser or weakening the schema check. Four ordinary contract tests run offline;
the installed-CLI check is a maintainer diagnostic, currently red for that drift.
