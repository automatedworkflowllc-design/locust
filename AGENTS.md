# Agent instructions

This repository is the canonical workspace for the AI teammate platform.

## Product principles

- Keep the product local-first and open source. Persistent cloud computers are a later, optional layer.
- Treat runtime, model, provider route, and fallback policy as separate concepts.
- Codex and Claude are first-class agent runtimes. OmniRoute is an optional local gateway, never the control plane.
- Never copy, pool, upload, or inspect user subscription credentials. Prefer installed official CLIs, official SDKs, API keys in the OS keychain, and local models.
- Never retry an irreversible action after an uncertain result. Reconcile it using receipts and idempotency keys.
- Every model/runtime switch must be visible in the append-only mission event stream.

## Engineering practices

- Use TypeScript in strict mode.
- Keep runtime orchestration independent from Electron and React.
- Add tests for routing, quota classification, permission boundaries, checkpointing, and handoff behavior.
- Do not persist hidden chain-of-thought. Persist concise summaries, plans, tool receipts, approvals, and artifact hashes.
- Preserve unrelated changes; multiple Codex tasks may work through separate worktrees.

## Shared context

Read `PROJECT.md` and `docs/CROSS_TASK_CONTEXT.md` before beginning a substantial task. Update the relevant document when a durable product or architecture decision changes.
