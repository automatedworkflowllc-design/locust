# Project state

Updated: 2026-08-30

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

The UI currently uses demonstration mission and route data. It does not yet launch Codex or Claude, persist missions, or invoke real app tools.

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

Last verified on 2026-08-30: production build passed, all TypeScript checks passed, and the runtime-core suite passed 4/4 tests.

## Next implementation milestone

Connect one real local runtime end to end, starting with Codex:

1. Detect the installed Codex executable and report version/readiness through a main-process runtime service.
2. Add a documented non-interactive Codex adapter that emits the normalized mission events defined in `packages/contracts`.
3. Expose a narrow, validated preload/IPC API; never spawn processes or handle credentials in the renderer.
4. Replace one demonstration mission timeline with a live streamed run, including cancellation and actionable error state.
5. Persist the event ledger and a resumable checkpoint locally before adding automatic provider fallback.
6. Add adapter contract tests using a fake executable/event stream so CI never needs a personal Codex account.

Definition of done: a user can start a harmless local Codex mission from the desktop UI, observe normalized events, cancel safely, restart the app, and inspect the durable run receipt. Claude and OmniRoute adapters follow the same proven boundary.
