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

The mission and route activity remains demonstration data. The app detects runtimes but does not yet launch a mission, persist mission state, or invoke real app tools.

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

Last verified on 2026-08-31: production build passed, all TypeScript checks passed, and all 14 tests passed across runtime adapters, runtime core, and the desktop discovery service.

## Next implementation milestone

Connect one real local runtime end to end, starting with Codex:

1. Add a controlled Codex process runner using the existing safe command specification and prompt-on-stdin boundary.
2. Parse Codex JSONL into the normalized mission events defined in `packages/contracts`.
3. Replace one demonstration mission timeline with a harmless live read-only run, including cancellation and actionable error state.
4. Persist the event ledger and a resumable checkpoint locally before adding automatic provider fallback.
5. Add adapter contract fixtures for partial output, malformed events, cancellation, quota classification, and process-tree cleanup.
6. Apply the proven runner/event contract to Claude Code, then add the curated OmniRoute gateway adapter.

Definition of done: a user can start a harmless local Codex mission from the desktop UI, observe normalized events, cancel safely, restart the app, and inspect the durable run receipt. Claude and OmniRoute adapters follow the same proven boundary.
