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

Last verified on 2026-08-31 (after the durable-ledger milestone landed): the production build and every workspace TypeScript check passed, with 63/63 tests passing across runtime adapters, runtime core, the mission store, and desktop services, and the Electron app boots cleanly with the ledger wired in. A real UI smoke mission returned `LIVE_UI_OK` through Codex CLI 0.151.0-alpha.7.2 earlier the same day on the pre-hardening build; re-run the live smoke once Codex quota allows.

## Next implementation milestone

The durable ledger and restart recovery landed on 2026-08-31 (with an adversarial review and hardening pass). What remains, in order — see `docs/ROADMAP.md` for the full plan and the 2026-08-31 owner direction (Cursor x Grok Bot thesis, Claude as an obviously selectable runtime, teammate workroom, simple avatar-first UI):

1. Re-run the live UI smoke once Codex quota allows, confirming the post-hardening build end to end.
2. Create a reconciled checkpoint record before any provider fallback or route switch (finishes issue #1).
3. Apply the proven runner/event/ledger contract to Claude Code so both runtimes are selectable from the command dock (issue #3, elevated).
4. Work through the recorded hardening backlog: write-side event validation parity with the reader, batched fsync, recency-aware ledger scans past 500 files, and byte-capped history responses.
5. Then the curated OmniRoute gateway adapter and Ask/Automatic fallback from a reconciled checkpoint.

Public roadmap: [live Codex mission](https://github.com/automatedworkflowllc-design/ai-teammate-platform/issues/2), [durable mission ledger](https://github.com/automatedworkflowllc-design/ai-teammate-platform/issues/1), and [Claude/OmniRoute adapters](https://github.com/automatedworkflowllc-design/ai-teammate-platform/issues/3).

Definition of done for issue #1: a user can start a harmless local Codex mission from the desktop UI, observe normalized events, cancel safely, restart the app, and inspect the durable run receipt — implemented; awaiting one live post-hardening smoke plus the checkpoint record. Claude and OmniRoute adapters follow the same proven boundary.
