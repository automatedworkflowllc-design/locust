# Cross-task context

This file is the canonical handoff point for Codex tasks working on this project.

## Canonical workspace

```text
C:\Users\<home>\Documents\Codex\ai-teammate-platform
```

To cross-reference work from another Codex chat, open or save that directory as the task's project. Chats created in generated projectless directories do not automatically share a working directory, but they can use this absolute path when it is in their permitted workspace. Prefer a saved Codex project for this directory so future tasks begin in the correct context.

If multiple tasks use the same checkout, all edits are immediately shared. Use that only for coordinated work with explicitly non-overlapping file ownership. Inspect current files and `git status` before modifying anything; do not reset, overwrite, stash, or “clean up” changes owned by another task.

For substantial parallel source changes, create each Codex task in its own Git worktree and branch. Worktree edits are isolated rather than immediately visible in the canonical checkout, so record the branch/commit in the handoff and deliberately merge or cherry-pick it. Never assume another task's uncommitted changes are present in your worktree. If worktrees are not practical, serialize overlapping changes through one owning task.

## Read this first

Every new implementation task should read, in order:

1. `AGENTS.md`
2. `PROJECT.md`
3. `docs/CROSS_TASK_CONTEXT.md`
4. `docs/PRODUCT.md`
5. `docs/ARCHITECTURE.md`
6. `docs/MODEL_ROUTING.md`

Then inspect the actual source tree and tests. The repository is authoritative for implemented state; this document records intent and handoff state.

## Stable product decisions

| Decision | Current direction |
|---|---|
| Product | Local-first, open-source platform for specialized autonomous AI teammates |
| Business model | Community project; users bring accounts, APIs, free tiers, or local models; no token markup |
| Experience | Codex/Claude Code-level execution clarity with Cursor-style model control |
| Initial execution | User's local computer; no persistent cloud computers in MVP |
| Application shell | Electron + React desktop app, with orchestration kept outside the renderer |
| Agent runtimes | Installed Codex and Claude adapters plus a native runtime where needed |
| Routing | Exact runtime/model/provider is visible; fallback is Off, Ask, or Automatic |
| Free fallback | Curated official free tiers and local models, optionally through OmniRoute |
| OmniRoute role | Optional localhost provider adapter, not the control plane |
| Credentials | Never copy CLI auth, pool subscriptions, capture cookies, or expose secrets in logs |
| Safety | Checkpoint and reconcile before route changes; verify before restoring side-effect tools |
| Cloud future | Preserve a runner abstraction so isolated persistent cloud runners can be added later |
| Public name | Undecided; avoid locking architecture or package names to a temporary brand |

## Current implementation status

As of 2026-08-31, the Electron/React desktop control-room prototype is implemented and runnable. It includes an interactive mission index and filter, Signal Rail, approval surface, command dock, runtime/model menu, and fallback-chain controls. Shared TypeScript packages define the runtime/routing/checkpoint contracts, capability-aware fallback, a guarded handoff state machine, and safe installed-runtime discovery.

The desktop now performs live, read-only Codex CLI, Claude Code, and OmniRoute discovery in the trusted main process and shows sanitized readiness/version status through preload IPC. It never reads credential stores. A controlled prompt-on-stdin process transport is implemented and fake-tested, but it is not wired to the renderer yet. The current mission activity remains demonstration data: no Codex/Claude mission process is launched from the UI, and mission persistence and real app/tool execution are not implemented.

From the canonical workspace:

```powershell
pnpm install
pnpm dev
```

Run the complete validation suite with:

```powershell
pnpm check
```

Last verification on 2026-08-31 passed the Electron production build, all workspace TypeScript checks, and 27/27 tests across runtime adapters, runtime core, and desktop discovery.

The next milestone is one end-to-end local Codex path: prompt-on-stdin process execution from the main process, normalized streamed events, safe cancellation, a durable local event ledger/checkpoint, and adapter contract fixtures that do not require personal authentication.

## Important implementation invariants

- The product owns missions, events, approvals, checkpoints, artifacts, tool policies, and receipts.
- Codex, Claude, native loops, and OmniRoute sit behind explicit adapters.
- Runtime, model, provider route, and fallback policy remain separate concepts in code and UI.
- Model switches are visible and occur only from a reconciled checkpoint.
- Unknown side effects are never blindly retried.
- Untrusted content never grants tool authority.
- Free-tier availability and model catalogs are runtime data, not hard-coded promises.
- Initial execution is local, but runtime/store APIs should not assume a process lives forever.

## Open decisions

Resolve these through small, evidence-backed implementation choices and record the outcome here:

- final public product name and package namespace;
- initial storage and operating-system secret-store libraries;
- precise support level for each provider's installed-account authentication under current terms;
- first three real-world tool integrations and their approval classes;
- minimum local/free models that pass the runtime capability fixtures;
- cloud runner isolation technology, deferred until after the local MVP.

## Handoff protocol

Before ending a Codex task that changes the project:

1. Re-read the diff and preserve unrelated concurrent work.
2. Run the narrowest relevant checks, then the broader project checks if available.
3. Update documentation when an architectural decision or user-visible behavior changed.
4. Add a concise handoff entry below if another task must continue the work.
5. Report absolute, clickable paths and exact validation results to the user.

Use this template:

```markdown
### YYYY-MM-DD — task title

- Scope/owner:
- Files changed:
- Outcome:
- Validation:
- Decisions made:
- Known issues:
- Recommended next step:
```

## Handoff log

### 2026-08-30 — workspace and product baseline

- Scope/owner: initial shared product documentation.
- Files changed: `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/MODEL_ROUTING.md`, `docs/CROSS_TASK_CONTEXT.md`.
- Outcome: captured the local-first product direction, runtime boundaries, Cursor-style routing model, OmniRoute policy, and safe checkpoint handoff.
- Validation: documentation reviewed for internal consistency; implementation validation is owned by the scaffold task.
- Decisions made: see the stable decisions table above.
- Known issues: public name, installer/distribution packaging, and initial connectors remain open.
- Recommended next step: complete one vertical slice—create a mission, run through one installed runtime, stream normalized events, checkpoint, and render a final receipt.

### 2026-08-30 — runnable desktop prototype

- Scope/owner: Electron/React control-room scaffold, shared contracts, routing core, and project-status documentation.
- Files changed: application and package scaffold plus `README.md`, `PROJECT.md`, and `docs/CROSS_TASK_CONTEXT.md`; inspect Git for the exact current set.
- Outcome: the desktop prototype runs with interactive mission, approval, command, model, and fallback surfaces; routing and handoff primitives compile and are tested.
- Validation: `pnpm check` passed the production build, all TypeScript checks, and 4/4 runtime-core tests.
- Decisions made: Electron + React is the first desktop shell; orchestration remains framework-independent and outside the renderer.
- Known issues: the prototype uses demonstration data and does not yet execute or persist a real mission.
- Recommended next step: implement the local Codex detection/adapter vertical slice described in `PROJECT.md`.

### 2026-08-31 — live installed-runtime discovery

- Scope/owner: runtime adapter foundation and Electron readiness bridge.
- Files changed: `packages/runtime-adapters`, Electron main/preload/renderer runtime-discovery files, tests, and project-status documentation.
- Outcome: the app safely discovers Codex CLI, Claude Code, and optional OmniRoute; displays sanitized version/readiness status; builds conservative command specs; and provides a bounded, cancellation-aware prompt-on-stdin JSONL transport without yet launching a UI mission.
- Validation: `pnpm check` passed the production build, all TypeScript checks, and 27/27 tests; a desktop smoke capture showed both installed runtimes ready and OmniRoute absent on the development machine.
- Decisions made: discovery is read-only and credential-blind; IPC accepts no renderer-controlled path or command; PATH shims are executed without `shell: true`; dangerous permission-bypass flags are forbidden.
- Known issues: the route/model surface remains example data, discovery can take several seconds on first launch, and no live mission event stream or persistence exists yet.
- Recommended next step: implement the controlled Codex JSONL runner and persist one harmless read-only mission end to end.

## Prompt for a new Codex task

Use this when starting a related chat:

```text
Work in C:\Users\<home>\Documents\Codex\ai-teammate-platform. First read AGENTS.md, PROJECT.md, docs/CROSS_TASK_CONTEXT.md, docs/PRODUCT.md, docs/ARCHITECTURE.md, and docs/MODEL_ROUTING.md. Inspect the current tree and git status before editing because other Codex tasks may share this checkout. Preserve unrelated changes, state which files you own, and use a separate Git worktree for substantial parallel source changes. Update the handoff log if your work changes implementation status or architectural decisions.
```
