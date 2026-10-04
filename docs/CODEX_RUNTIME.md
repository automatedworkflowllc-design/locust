# Codex runtime adapter

Status: verified against local `codex-cli 0.151.0-alpha.7.2` on 2026-08-31 and the official [non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode) and [developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli) documentation. Treat wire fields as versioned runtime data, not a permanent provider contract.

## Safe invocation

The local read-only path is represented as an argv array and receives the prompt through stdin:

```text
codex exec --json --sandbox read-only -C <workspace> -
```

The platform never builds a shell command string and does not expose permission-bypass flags. The executable, workspace, CLI capabilities, and authentication status are discovered in the trusted main process. Runtime credentials remain in Codex's official store and are not copied or inspected.

## Current JSONL envelope

The current CLI emits an open union with these top-level event types:

```text
thread.started
turn.started
turn.completed
turn.failed
item.started
item.updated
item.completed
error
```

`thread.started.thread_id` is the resumable runtime handle. The wire does not expose a turn ID, timestamp, or sequence, so the host assigns local correlation IDs, receive timestamps, and a monotonic ingestion sequence.

Known item families include agent messages, reasoning, errors, command executions, file changes, MCP calls, collaboration calls, web searches, and todo/plan lists. Parsers accept additive fields and unknown item types, preserve bounded redacted evidence, and never fail merely because a newer CLI added a field.

## Terminal semantics

- Success requires both `turn.completed` and process exit code `0`.
- `turn.failed` is a terminal runtime failure.
- A top-level `error` is diagnostic until terminal state or process exit confirms the outcome.
- An `item` whose type is `error` can be nonterminal and does not fail the run by itself.
- Exit/EOF without `turn.completed` or `turn.failed` is a protocol failure unless the host already requested cancellation.
- Preflight failures can produce no JSONL at all, so bounded stderr and process completion always remain part of the receipt.

## Cancellation

Current `codex exec --json` does not emit a reliable cancellation event. The host records `cancelRequestedAt` before signaling the process. After process termination is confirmed, it synthesizes `run.cancelled`. Without that host correlation, an unterminated stream is classified as a failure rather than guessed to be cancellation.

Cancellation does not imply that in-flight side effects were undone. The control plane reconciles completed and unknown tool actions before allowing resume or fallback.

## Limit classification

Observed usage-limit failures can appear twice: a message-only top-level `error`, followed by a message-only `turn.failed`. The normalizer emits a single `route.limit_detected` event and retains both raw records as bounded evidence.

After host/process reconciliation, `run.failed` closes that specific runtime invocation. It does not automatically fail the parent mission: the control plane freezes new work, reconciles tool state, persists a checkpoint, and applies the user's Off, Ask, or Automatic fallback policy before deciding the mission's terminal state.

Classification order:

1. a future structured runtime code, when present;
2. a small allowlist of high-confidence quota/rate-limit messages;
3. `unknown`.

Authentication, billing/spend-cap, safety, malformed request, and policy failures are never treated as automatic-fallback triggers. No exact quota amount or reset time is inferred when the runtime does not expose one.

## Normalized mapping

| Codex wire event | Product event |
|---|---|
| `thread.started` | `run.started` |
| `turn.started` | `step.started` |
| agent-message item lifecycle | `message.delta` |
| command/file/MCP/web item lifecycle | `tool.started`, `tool.completed`, or `tool.failed` |
| todo list | `plan.updated` |
| `turn.completed` | `step.completed`, then `run.completed` |
| `turn.failed` | `step.failed` and `run.failed`, or the checkpoint/fallback flow for an eligible limit |
| host-correlated cancellation | synthesized `run.cancelled` |

Reasoning records are not persisted as hidden chain-of-thought. Only concise, user-facing summaries and execution metadata may enter the mission ledger.
