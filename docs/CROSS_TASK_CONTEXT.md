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
7. `docs/CODEX_RUNTIME.md`

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

The desktop performs live, read-only Codex CLI, Claude Code, and OmniRoute discovery in the trusted main process and shows sanitized readiness/version status through preload IPC. It never reads credential stores. One real Codex path is wired end to end: a bounded renderer prompt crosses a narrow IPC surface, the main process owns the workspace/executable/fixed read-only argv, the controlled prompt-on-stdin transport streams through the privacy-aware normalizer, and the Signal Rail renders the resulting events with host-correlated cancellation. Reasoning content is excluded and only bounded redacted evidence crosses the bridge.

The durable mission ledger is now live: `packages/mission-store` persists schema-versioned, append-only mission records with fsync, contiguity checks, tamper detection, and fail-closed recovery; the desktop persists before emitting, restores history after restart through a tested `mission-history` module, and hardens the renderer boundary (deny-all permissions, packaged-build network egress block, validated window-control IPC, latching dispose). The remaining mission fixtures, Claude/OmniRoute execution, automatic fallback, and connection/tool surfaces are not live. Automatic route fallback stays deliberately disabled until a reconciled checkpoint record exists.

From the canonical workspace:

```powershell
pnpm install
pnpm dev
```

Run the complete validation suite with:

```powershell
pnpm check
```

Last verified on 2026-08-31 after the durable-ledger milestone: production build and all TypeScript checks passed with 63/63 tests, and the Electron app boots cleanly with the ledger wired in. The `LIVE_UI_OK` smoke from earlier that day ran on the pre-hardening build; re-run the live smoke when Codex quota allows.

The next milestone is the reconciled checkpoint record, then Claude runtime parity — see `docs/ROADMAP.md`, which also records the 2026-08-31 owner direction (Cursor x Grok Bot thesis, Claude obviously selectable, teammate workroom, simple avatar-first UI with model choice on the main surface). Contract fixtures must remain authentication-free.

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
- Outcome: the app safely discovers Codex CLI, Claude Code, and optional OmniRoute; displays sanitized version/readiness status; builds conservative command specs; and provides a bounded, cancellation-aware prompt-on-stdin JSONL transport plus typed, privacy-aware Codex event normalization without yet launching a UI mission.
- Validation: `pnpm check` passed the production build, all TypeScript checks, and 37/37 tests; a desktop smoke capture showed both installed runtimes ready and OmniRoute absent on the development machine.
- Decisions made: discovery is read-only and credential-blind; IPC accepts no renderer-controlled path or command; PATH shims are executed without `shell: true`; dangerous permission-bypass flags are forbidden.
- Known issues: the route/model surface remains example data, discovery can take several seconds on first launch, and no live mission event stream or persistence exists yet.
- Recommended next step: wire the controlled Codex transport and normalizer through trusted Electron IPC, then render and safely cancel one harmless read-only mission end to end.

### 2026-08-31 — live read-only Codex mission

- Scope/owner: Electron mission service, secure IPC/preload surface, live Signal Rail UI, tests, and current-state documentation.
- Files changed: `apps/desktop/src/main/codex-mission.ts`, Electron main/preload/shared IPC files, renderer UI/styles, desktop tests, screenshot, and project-status documentation.
- Outcome: a user can run one real account-default Codex mission from the command dock; the host fixes the executable/workspace/read-only command, streams normalized events, enforces one active process, and supports safe cancellation without exposing raw process failures.
- Validation: `pnpm check` passed the production build, all TypeScript checks, and 43/43 tests. A real adapter smoke returned `LIVE_SMOKE_OK`; a real Electron UI smoke returned and rendered `LIVE_UI_OK` with a clean provider/host terminal receipt.
- Decisions made: the renderer controls only the prompt; model selection is account-default for this slice; exact provider allowance is shown as unavailable instead of guessed; `run.failed` closes an invocation, not automatically the parent mission.
- Known issues: mission/event state is memory-only; current-run ownership is process-wide; live model enumeration, Claude/OmniRoute execution, fallback, and external tools are not implemented.
- Recommended next step: add a versioned append-only local mission/event ledger and restart recovery, then persist a reconciled checkpoint before enabling fallback.

### 2026-08-31 — durable mission ledger landed; adversarial review; roadmap

- Scope/owner: Claude Code session taking over from the Codex task that hit its usage limit mid-milestone; full-repo review and completion of the in-flight durable-ledger work.
- Files changed: `packages/mission-store` (completed and hardened, 9 tests), `apps/desktop/src/main/codex-mission.ts` (metadata completion, persistence-error ordering, interrupt/dispose split with a shutdown latch), `apps/desktop/src/main/index.ts` (permission handlers, packaged egress block, validated window-control IPC, `mission-history` extraction), new `apps/desktop/src/main/mission-history.ts` (+ tests), renderer `App.tsx` (restored-receipt/live-update reconciliation, queued-update drain, honest integrity attribution, stopped status), `docs/ROADMAP.md` (new), `PRODUCT.md`/`PROJECT.md`/`README.md`.
- Outcome: `pnpm check` fully green with 63/63 tests (was failing typecheck at handover); an adversarial review (5 parallel reviewers, per-finding refutation; verification completed in-session where agent verifiers hit usage limits) produced 33 findings — 11 real defects fixed, 9 coverage gaps closed with 14 new tests, the rest recorded as the hardening backlog in `docs/ROADMAP.md` M1.
- Validation: build, all typechecks, 63/63 tests; Electron boots cleanly with all changes. Not validated: a live post-hardening Codex mission (provider quota exhausted at the time).
- Decisions made: owner direction 2026-08-31 recorded in PRODUCT.md and ROADMAP.md — the Cursor x Grok Bot thesis, Claude as an obviously selectable runtime (issue #3 elevated), teammate avatars + workroom communication (issue #4 filed), simple main surface with model choice visible and policy in settings.
- Known issues: hardening backlog (write-side event validation parity, batched fsync, >500-ledger scan ordering, byte-capped history IPC, head-of-run preservation past 500 live events); live smoke pending quota.
- Recommended next step: live UI smoke, then the reconciled checkpoint record, then the Claude adapter per ROADMAP M2.

## Prompt for a new Codex task

Use this when starting a related chat:

```text
Work in C:\Users\<home>\Documents\Codex\ai-teammate-platform. First read AGENTS.md, PROJECT.md, docs/CROSS_TASK_CONTEXT.md, docs/PRODUCT.md, docs/ARCHITECTURE.md, docs/MODEL_ROUTING.md, and docs/CODEX_RUNTIME.md. Inspect the current tree and git status before editing because other Codex tasks may share this checkout. Preserve unrelated changes, state which files you own, and use a separate Git worktree for substantial parallel source changes. Update the handoff log if your work changes implementation status or architectural decisions.
```
