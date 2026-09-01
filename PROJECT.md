# Project state

Updated: 2026-08-31

## Product thesis

Build a better, open-source alternative to Grok Bot: specialized AI teammates that complete real work across apps, with the polish of Codex/Claude Code and the model control of Cursor.

The differentiator is not merely “more agents.” It is a trustworthy control plane that shows which runtime, model, account, tools, permissions, and fallback policy are active at every moment.

## Locked decisions

1. Local-first desktop product before persistent cloud computers.
2. Free and open source; users bring accounts, API keys, free-tier providers, or local models.
3. Runtime, model, provider route, and fallback policy are independent settings.
4. Codex and Claude use official local runtimes/SDKs where possible.
5. OmniRoute is optional and restricted to explicitly approved providers by default.
6. Quota fallback happens only at a safe checkpoint boundary.
7. External side effects require approval, receipts, and idempotency protections.
8. The UI is a quiet, keyboard-first mission control room, not a dashboard wall.

## Implemented baseline

- Runnable Electron 44 + React 19 desktop application built with electron-vite.
- Control-room prototype with mission index/filtering, central Signal Rail, details rail, approval interaction, command dock, model picker, and fallback controls.
- Strict TypeScript contracts for runtime, route, capability, teammate, checkpoint, side-effect receipt, event, and handoff state.
- Provider-neutral route compatibility checks and fallback selection.
- Safe-handoff state machine with guarded transitions.
- Automated coverage for forbidden error fallback, privacy/capability filtering, and handoff behavior.
- Shell-free, bounded discovery of installed Codex CLI, Claude Code, and optional OmniRoute.
- Live runtime readiness in the desktop sidebar through a narrow, sanitized main/preload IPC bridge.
- Safe read-only Codex and restricted/plan-mode Claude command specifications with dangerous bypass flags rejected.
- Controlled prompt-on-stdin JSONL process transport with bounded queues/stderr, filtered environment, no retries, and explicit cancellation/termination state.
- Typed, privacy-aware Codex JSONL normalization into product-owned run, step, tool, message, diagnostic, and route-limit events, with bounded redacted evidence and reasoning content excluded.
- Narrow main/preload IPC for one live Codex mission, with a bounded renderer prompt, host-owned workspace/executable/argv, normalized streaming Signal Rail, generic transport errors, one-run concurrency, and safe Stop behavior.

- Versioned, append-only local mission ledger (`packages/mission-store`): strict revalidation on read, ledger/event sequence contiguity, fsync on append, exclusive create, byte-offset tamper detection, truncated-tail recovery, bounded sizes, and fail-closed behavior with cache invalidation after an uncertain write.
- Live Codex missions persist their metadata, every normalized event, and host failures durably before the renderer sees them; a failed durable write aborts the run and surfaces a persistence error only after the process has terminated.
- Mission history IPC and restart recovery: completed, failed, cancelled, and interrupted runs are restored with truthful phase, event-window, and per-mission integrity-issue reporting; a restored receipt that receives live updates becomes a live, cancellable run again.
- Renderer hardening: deny-all permission handlers, no renderer network egress in packaged builds, and sender/frame validation on every IPC channel including window controls.
- Service lifecycle: `interrupt()` for window close versus a latching `dispose()` for shutdown, so no mission can start after the final ledger flush.

One harmless read-only Codex mission is live end to end and now survives restarts through the durable ledger. The remaining mission fixtures, Claude/OmniRoute routes, automatic fallback, token-budget preview, and connection/tool surfaces are still demonstrations, and the app does not invoke real external tools.

## Run and validate

From `C:\Users\<home>\Documents\Codex\ai-teammate-platform`:

```powershell
pnpm install
pnpm dev
```

In a separate run, validate the full workspace:

```powershell
pnpm check
```

Last verified on 2026-08-31 (after the durable-ledger milestone and its hardening pass): the production build and every workspace TypeScript check passed, with 66/66 tests passing across runtime adapters, runtime core, the mission store, and desktop services.

The post-hardening live smoke is **done**, on the built app against Codex CLI 0.151.0-alpha.7.2, in two layers (`_smoke/`, run by hand — they need a signed-in provider and a desktop session, so they are not part of `pnpm check`):

- `live-ledger-smoke.mjs` — a real read-only mission through discovery, transport, normalizer and the durable ledger, recovered intact by a fresh reader: 6 events, contiguous, phase `completed`, no integrity issues.
- `renderer-smoke.mjs` — the same mission driven through the Electron UI over CDP, asserted on what the screen shows: the composer reaches React state, the run completes, and the answer and the read-only receipt are on screen.

Each carries a committed negative control, because a green check that could never go red proves nothing. The ledger smoke corrupts a copy of the ledger it just wrote and requires recovery to come back short, flagged and `interrupted`; the renderer smoke asks for a computed answer rather than an instructed token (an instructed token is echoed back in the displayed prompt and would match with no model in the loop) and launches with a private profile, since the app restores history from the ledger.

## Next implementation milestone

The durable ledger and restart recovery landed on 2026-08-31 (with an adversarial review and hardening pass). What remains, in order — see `docs/ROADMAP.md` for the full plan and the 2026-08-31 owner direction (Cursor x Grok Bot thesis, Claude as an obviously selectable runtime, teammate workroom, simple avatar-first UI):

1. Create a reconciled checkpoint record before any provider fallback or route switch (finishes issue #1).
2. Apply the proven runner/event/ledger contract to Claude Code so both runtimes are selectable from the command dock (issue #3, elevated).
3. Work through the recorded hardening backlog (write-side/reader parity landed in the hardening pass): batched fsync, recency-aware ledger scans past 500 files, and byte-capped history responses.
4. Then the curated OmniRoute gateway adapter and Ask/Automatic fallback from a reconciled checkpoint.

Public roadmap: [live Codex mission](https://github.com/automatedworkflowllc-design/ai-teammate-platform/issues/2), [durable mission ledger](https://github.com/automatedworkflowllc-design/ai-teammate-platform/issues/1), and [Claude/OmniRoute adapters](https://github.com/automatedworkflowllc-design/ai-teammate-platform/issues/3).

Definition of done for issue #1: a user can start a harmless local Codex mission from the desktop UI, observe normalized events, cancel safely, restart the app, and inspect the durable run receipt — implemented and smoke-verified live on the built app; awaiting only the reconciled checkpoint record. Claude and OmniRoute adapters follow the same proven boundary.
