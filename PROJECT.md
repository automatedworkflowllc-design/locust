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
- Reconciled checkpoint records derived by the ledger from durable state alone: a tool call that started and never reported an outcome is `unknown`, not failed, so the checkpoint returns `safe`, `approval-required`, or `unsafe` with the cause. There is no `appendCheckpoint(checkpoint)` — a component whose state is in doubt may not author the record that is trusted when its state is in doubt. Closing a window mid-mission writes a `shutdown` checkpoint once that run has settled.

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

Last verified on 2026-09-02: the production build and every workspace TypeScript check passed, with 449 tests passing across runtime adapters, runtime core, the mission store, and desktop services.

The checkpoint suite is verified by mutation, not by being green: `packages/mission-store/test/mutation-control.mjs` breaks thirteen behaviours one at a time and requires the NAMED test to fail, rejecting any mutation that stops the file running (a red suite caused by a broken file proves nothing about any test in it). It found two tests of mine that passed for the wrong reason — a digest test comparing transcripts of different lengths, which a constant-per-event digest satisfies, and a shutdown test that called `dispose()` before the run settled, which passed against a service with the line it names removed.

The post-hardening live smoke is **done**, on the built app against Codex CLI 0.151.0-alpha.7.2, in two layers (`_smoke/`, run by hand — they need a signed-in provider and a desktop session, so they are not part of `pnpm check`):

- `live-ledger-smoke.mjs` — a real read-only mission through discovery, transport, normalizer and the durable ledger, recovered intact by a fresh reader: 6 events, contiguous, phase `completed`, no integrity issues.
- `renderer-smoke.mjs` — the same mission driven through the Electron UI over CDP, asserted on what the screen shows: the composer reaches React state, the run completes, and the answer and the read-only receipt are on screen.

Each carries a committed negative control, because a green check that could never go red proves nothing. The ledger smoke corrupts a copy of the ledger it just wrote and requires recovery to come back short, flagged and `interrupted`; the renderer smoke asks for a computed answer rather than an instructed token (an instructed token is echoed back in the displayed prompt and would match with no model in the loop) and launches with a private profile, since the app restores history from the ledger.

## The shell redesign

The Locust desktop shell design landed 2026-08-31 (`design/locust-desktop/` — spec, interactive reference, brand). Reviewed state-by-state in a browser and mapped surface-by-surface to real backing in `docs/UI-INTEGRATION-PLAN.md`: most of it binds to state that already exists (discovery, live missions, checkpoints, receipts, the ledger-failure hold), a small honest layer is new (teammate profiles as local identity + routing presets), and the capability states (approvals, handoffs, peer threads, swarm) stay unrendered until their backends exist. Execution order: P0 foundation → P1 shell → P2 teammates → P3 inspector/palette → P4 route layer → P5 capability states. P0–P3 do not depend on the Claude adapter.

## Where it is now

2026-09-02. THREE runtimes own real missions -- Codex CLI, Claude Code and
Cursor Agent -- each offering its own models from its own CLI, with the
chosen reasoning effort actually reaching the ones that take one. Missions
run side by side, one per teammate; teammates exchange findings through a
durable workroom; a running mission can be handed between runtimes from a
reconciled checkpoint; per-action approvals run on the app-server transport;
a reply continues its conversation by resuming the runtime's own session; a
mission can be deleted, and old ones pruned on request after a preview that
cannot lie about what it will take. The app ships as a signed-less NSIS
installer with a version people can read in Settings.
`docs/REMAINING-PLAN.md` holds the ordered record of what landed and what is
still open, each entry saying plainly which parts were verified live.

Verification, as of this date: 449 tests across the workspace; 133 mutations
caught across three mutation controls (27 + 34 + 72); and fourteen live
smokes in `_smoke/` driving the built app over CDP -- see `_smoke/README.md`
for what each proves, what it cannot see, and which three spend no provider
quota. Each carries a negative control, because a green check that could
never go red proves nothing.

Still open, in the order I would take them: auto-update (needs a publish
target the owner chooses, and ideally a signing certificate); the curated
OmniRoute gateway with Ask/Automatic fallback; Gemini through Antigravity,
which is blocked on one value only the owner can read out of that IDE; and
the swarm decisions (a quota warning before engaging, a per-mission
override).

## Earlier milestone notes

## Next implementation milestone

The durable ledger and restart recovery landed on 2026-08-31 (with an adversarial review and hardening pass). What remains, in order — see `docs/ROADMAP.md` for the full plan and the 2026-08-31 owner direction (Cursor x Grok Bot thesis, Claude as an obviously selectable runtime, teammate workroom, simple avatar-first UI):

1. ~~Apply the proven runner/event/ledger contract to Claude Code~~ **DONE 2026-09-01** — Claude Code is selectable in the route picker and can own a real mission end to end, recorded at ledger schema v3 with `runtime: claude` and recovered after restart. Remaining from that milestone: the hardening backlog. (Original note: the contract side was done first — the runtime union, ledger schema v2, and the renderer types all landed; what remains is the normalizer and the main-process wiring, specified in `docs/HANDOFF-claude-adapter.md` against a real measured Claude stream.
2. ~~Hardening backlog~~ **DONE 2026-09-01** — durable writes batch a drained burst into one fsync, ledger scans past 500 files select by recency rather than by filename, and history responses are byte-capped.
3. Then the curated OmniRoute gateway adapter and Ask/Automatic fallback from a reconciled checkpoint.

Public roadmap: [live Codex mission](https://github.com/automatedworkflowllc-design/ai-teammate-platform/issues/2), [durable mission ledger](https://github.com/automatedworkflowllc-design/ai-teammate-platform/issues/1), and [Claude/OmniRoute adapters](https://github.com/automatedworkflowllc-design/ai-teammate-platform/issues/3).

Definition of done for issue #1: a user can start a harmless local Codex mission from the desktop UI, observe normalized events, cancel safely, restart the app, and inspect the durable run receipt — implemented, smoke-verified live on the built app, and now checkpointed. Claude and OmniRoute adapters follow the same proven boundary.

**Stated plainly, because it is the kind of gap that reads as done:** the checkpoint record exists, is durable, is recoverable, refuses to contradict itself, and has one production caller (shutdown). Nothing calls it *at a route switch*, because no route switch exists yet — that arrives with the Claude adapter and automatic fallback, and is where the `approval-required` verdict finally gates something. Until then the mechanism is built and exercised, not yet load-bearing.
