# Cross-task context

This file is the canonical handoff point for Codex tasks working on this project.

## Canonical workspace

The repository root, wherever it is checked out. (An earlier version of this
file named one developer's Windows folder here; the public copy of the
repository is a mirror and has no canonical path.) Executor sessions work in
a Git worktree of their own, never in the checkout a tester is using.

To cross-reference work from another agent chat, open or save the checkout as the task's project. Chats created in generated projectless directories do not automatically share a working directory, but they can use the checkout's absolute path when it is in their permitted workspace. Prefer a saved project for this directory so future tasks begin in the correct context.

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

Route-at-start decision (2026-09-10, `astra/work`): the host's saved teammate
route outranks discovery/default composer choices, except for a real picker
change this session for that teammate. Nobody's missions retain their
composer route. Mode is not inherited. See
`docs/FINDING-route-at-start-2026-09-10.md` for evidence and limitations.

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
| Public name | **Locust** (settled 2026-08-31). Package namespace still open -- the desktop app is not distributed through npm or PyPI, where the name is taken |

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

Live smokes in `_smoke/` drive the built app against the real CLIs over CDP; they need a signed-in provider and a desktop session, so they are run by hand rather than by `pnpm check`. **Counts are deliberately not repeated here** -- this paragraph said "350 tests" and "nine live smokes" for eleven days while the real numbers passed 3000 and 32. Run `pnpm test` and `ls _smoke/*-smoke.mjs` for the truth; a number written down twice is a number that will disagree with itself.

Read the newest `docs/PLAN-*-NEXT.md` first — it is where things stand. `docs/REMAINING-PLAN.md` is a 2026-09-01 snapshot and is HISTORY: it still lists as unbuilt several things that shipped (mission deletion and retention, connectors, packaging). In short, as of this date: both runtimes own real missions, missions run side by side one per teammate, teammates exchange findings through the durable workroom, a running mission can be handed between runtimes from a reconciled checkpoint, and per-action approvals run on the app-server transport. Still open: connections, mission deletion and retention, the curated OmniRoute gateway with Ask/Automatic fallback, and packaging. Contract fixtures must remain authentication-free.

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

### 2026-09-09 — live-mission frontier, pinned e05ac6d (astra/work)

- Main e05ac6d merged as d452f20; main checkout untouched. Both caps temporarily 16 for measurement, restored to 8 and rebuilt before validation. No production change.
- [Frontier finding](FINDING-live-mission-frontier-2026-09-09.md): real 8/12/16-way OpenCode-free writes complete with exact files/replies and clean event/ledger coverage. No data-loss boundary through 16; read-only 10/12-member rooms actually peaked at seven processes, not 10/12.
- Important findings: intermittent OpenCode-readiness launch refusals; room start notifications delayed 45–53 seconds; eight answers not comfortably visible; N=16 renderer heartbeat gap 11.994 seconds and max event lag 7.929 seconds despite correct receipts. Counting produces one text record, so it does not establish queue-saturation safety.
- Recommendation: retain fixed 8 pending owner review, constrained by UX/responsiveness/readiness rather than a proven RAM ceiling. Smaller machines and heavier runtimes explicitly unmeasured; no memory squeeze or paid runtime calls.
- Validation: root pnpm test/full Vitest 2,399 tests; desktop pnpm test 1,937 (same desktop portion); recursive node/web typechecks green. File recheck intentionally reports the original solo identity-refusal calibration as a missing file; 40 completed revision-2 files pass strict validation.
- Next step: owner review/profiling, not an automatic cap increase or adapter fix. New measurement tools and evidence are isolated under _tools and docs.

### 2026-09-09 — pinned ledger-fix recheck and Codex question contract (astra/work)

- Pinned main `2b60cab` merged as `9130f12`; both conflicted test-path files taken from main exactly. Main checkout untouched. Rebuilt mission-store before testing.
- [Independent recheck](FINDING-ledger-fix-recheck-2026-09-09.md): all five former KNOWN DEFECT cases now require and render warnings; physical directory failure and mixed damage pass. Both requested mutations fail (5 and 6 assertions), plus directory-warning mutation (1). Both clean controls retained.
- New measured defect, not fixed: body-damaged but recoverable mission outside the 20-entry page is miscounted as an unreadable file. Desired zero failed with one; explicitly characterized in the 22-test harness. Other refresh paths' stale damage state is source-only, not live-tested.
- [Codex question answer contract](FINDING-codex-question-answers-2026-09-09.md): installed 0.153.0 accepts question-ID → answer-string-array content, selected options by literal label. Malformed payload becomes an empty answer map in version-matched upstream source. No approval-flow change and no model quota; schema inspector includes no-data and wrong-shape controls.
- Validation: root pnpm test and full Vitest 1,996/1,996 (111 files); desktop pnpm test 1,544/1,544 (90 files), matching root's desktop portion. Recursive node/web typecheck green. Main's cwd prohibition passes; production diff from pinned merge is empty.

### 2026-09-08 — physical torn-ledger recovery proof (astra/work)

- Tests/findings only: [torn-ledger finding](FINDING-torn-ledger-2026-09-08.md). Nineteen new physical-file reader/history/preload/component-rendering checks, with clean zero-issue controls and ten measured mutation failures.
- Reader safely retains prefixes and raises issues for all six requested shapes. Body issues render incomplete-receipt wording. **Unfixed:** invalid headers/oversized files have global issues but no recovered mission, so Missions falsely says ledger verified; five tests explicitly characterize the defect.
- Limits: actual React component HTML and mocked Electron transport; no live Electron relaunch or App mount. No production changes. Two existing source-inspection tests now resolve paths from import.meta.url so both test entry points agree.
- Validation: root pnpm test and full Vitest 1,679/1,679; desktop pnpm test 1,227/1,227, matching root's desktop portion. Recursive typecheck green, including node and web.

### 2026-09-08 — app-server receipt-failure hold measurement (astra/work)

- Scope: measurement only, in the isolated locust-astra worktree; no runtime or UI changes.
- Decision: close arbitrary ledger-failure pause as cannot with Codex 0.153.0's exposed protocol. Approval waits are not an all-work-stopped barrier.
- Evidence and limits: [app-server hold finding](FINDING-app-server-hold-2026-09-08.md); generated experimental inventory plus six live dispatcher replies, no generation. Empty-data control exits nonzero.
- Validation: recursive typecheck green; full root Vitest 1,660/1,660, 103 files.
- Separate concern: app-server mission notification persistence rejection is swallowed in this snapshot; source-level finding only, left unchanged for the owning agent.
- Next step: review the finding and merge the named documentation/probe commit from astra/work if accepted. No pause implementation is queued.

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

### 2026-10-03 — W11 Remote Control Settings switch (Casper)

- Scope: `exec/w11-casper`, fresh worktree `<home>\Documents\Codex\locust-exec-w11-casper`, based on `origin/main` at `edb05f22141f253d461cf4e73681b1fd28af8d7d`. No version or CHANGELOG change, packaging, push or publication.
- Built: an off-by-default Settings > AI agents switch; host-owned `claude remote-control --spawn worktree --name Locust` in the current project folder; boolean-only validated IPC; first stdout/stderr shown verbatim, separately capped at 64 Ki characters with a visible truncation notice. No persistence, automatic retry or stdin answers.
- Lifecycle: off/quit kill only the owned process tree and await close. Dispose latches against later starts; a pending discovery is invalidated by off or quit. A termination deadline reports failure rather than claiming the process ended.
- Trust/setup: trust prompts, `Workspace not trusted`, and the one-time enable prompt stop the server before opening normal interactive Claude Code for the person. It is a setup terminal, not a second unmanaged server. The person completes setup and explicitly enables the switch again. Windows/macOS terminal launch is unit-tested with mocks; other platforms receive manual guidance. Settings uses the existing switch/card styles; its search includes Remote Control, phone and claude.ai.
- Observed: 40/40 new unit tests in four files passed with fake processes/terminal launchers. Four deliberate regressions to arguments, off cleanup, quit cleanup and whitespace preservation each failed the named assertion, then were restored. Full `_tools/gate.sh` via Git Bash passed, exit 0: 761 adapter, 150 mission-store, 7,678 desktop tests plus its required TypeScript checks. `git diff --check` passed.
- Earlier checks: Windows' default `bash` selected an unavailable WSL distribution; Git Bash ran the gate. The first executable gate caught two new source-check failures (class names and the trust regex's slash spelling), both fixed without weakening tests. The second timed out an existing conversation-name cap test; that case then passed in a 59/59 smaller run and the final gate passed using `LOCUST_GATE_TMP=<home>/Documents/Codex/.tmp/w11-casper-gate`.
- Deduced: the main process's existing bounded quit path now awaits Remote Control disposal. Unit tests exercise disposal with a fake child; no actual app quit or OS process tree termination was observed for this feature.
- Not run: real `claude remote-control`, account/sign-in checks, trust or enable answers, live UI, packaged UI, or a remote phone session. Colin owns the account-dependent live check. Review/merge this executor branch before any release; W11 is built, not live.

### 2026-10-03 — comparison and drive polish (Codex)

- Ready for review: `exec/polish-batch`, based on `06e4a6c9`, in `<home>/Documents/Codex/locust-polish-batch`. Full file list, evidence paths, and limitations: [polish handoff](HANDOFF-2026-10-03-POLISH.md).
- Four requested fixes: full comparison route tooltip (owned by Composer.tsx), styled judge select, stdout route probe, and a seeded Copy assertion with `--copy-only` mode.
- Gate exit 0: 761 adapter, 150 mission-store, 7,762 desktop tests and required TypeScript checks; runtime-core 4/4 separately. Five new tests pass and all four requested regressions fail their named tests. Built-app drives: comparison 8/8, seeded Copy 1/1, zero captured renderer errors. Isolated real-component judge checks 5/5; generated frame inspected.
- No version/CHANGELOG change, paid turn, packaging, push, or publication. Live model round trips and packaged checks remain unverified. Review and merge before release.
### 2026-10-03 — research 3.2 real Codex fixtures and schema drift (Casper)

- Scope: `exec/3-2-casper`, fresh from `origin/main` at `06e4a6c9aa648ab1d391ef7a95ca096aa36a9592`, in `<home>\Documents\Codex\locust-exec-3-2-casper`. No production adapter change, push, publication, packaging, version bump or CHANGELOG edit.
- Observed live: installed Codex 0.160.0; each turn explicitly requested `gpt-6-luna` / `low`. Three retained recordings in `packages/runtime-adapters/test/fixtures/codex`: one approval declined (42 rows), a file changed from BEFORE to AFTER with host read-back (24 rows), and an accepted mid-command steer whose final answer is STEER_ACCEPTED (42 rows). No tool approval was granted. Two other turns were rejected with `model 'gpt-6-luna' is not enabled in rustponsesapi`; later requests on the same model succeeded. Six requests total are documented in the fixture README.
- Privacy: paths/ids/machine metadata/timestamps scrubbed before fixture persistence; private account readings, instruction bodies, legacy raw mirrors and hidden reasoning omitted. Public summaries and the real prompts, commands, patches, messages, usage counts and ordering remain. Fixtures replay through the actual client, run adapter and normalizer, strictly matching outbound requests before releasing the next inbound messages. The recorder is `_tools/record-codex-app-server-fixtures.mjs`, explicitly gated by `LOCUST_SPEND=1`.
- Observed tests: 9 new offline tests passed, one installed-CLI schema test skipped by default. Four negative controls failed their named assertions (decline status, file receipt, steer answer and missing-field detection), then were restored. Final gate exit 0: 770 adapters passed / 1 skipped, 150 mission-store passed, 7,757 desktop passed, 8,677 passed in total; all gate TypeScript checks passed. `git diff --check` passed.
- Observed opt-in check: `LOCUST_CODEX_SCHEMA=1` generated the installed 0.160.0 schema without a model call. Four helper contract tests passed; the one installed-CLI test failed for exactly `ConfigWarningNotification.message`. The generated notification has `summary`; the existing normalizer's combined warning branch reads `params.message`. The test intentionally exposes the mismatch instead of weakening the field inventory. Canonical fields/error variants are listed in `test/codex-schema-read-fields.ts`; schema-less compatibility aliases are documented separately.
- Deduced, not observed live: a configWarning carrying only summary would be silently dropped by that existing branch. Production repair is a follow-up: support the current warning field and deliberately update the schema inventory; the enabled installed-CLI test should then pass. Replay/schema validation does not independently prove the backend's internal model choice, every protocol event family, or schema-less legacy aliases.
- Not recorded/run: an exhausted provider limit (no account-exhaustion attempt), live configWarning, other Codex versions, packaged UI, or a release. Review the executor commit before any merge/release; the default gate is green and the opt-in maintainer diagnostic currently reports the existing warning-field drift.

### 2026-10-03 — Codex app-server config warning fields (Gemini Flash)

- Scope/owner: `exec/codex-warning`, in `<home>\Documents\Codex\locust-codex-warning`.
- Files changed: `packages/runtime-adapters/src/app-server-events.ts`, `packages/runtime-adapters/test/codex-schema-read-fields.ts`, `packages/runtime-adapters/test/a-config-warning-says-its-summary.test.ts`, `docs/CROSS_TASK_CONTEXT.md`.
- Outcome: Fixed schema drift in `app-server-events.ts` where `configWarning` notifications dropped when `message` was missing. The normalizer now reads `params.summary` with optional `params.details` line appended, while maintaining fallback to `params.message` for `configWarning` and retaining `params.message` for `warning` and `guardianWarning`. Updated `codex-schema-read-fields.ts` to track canonical `['summary', 'details']` on `ConfigWarningNotification`.
- Validation:
  - Observed control: `test/a-config-warning-says-its-summary.test.ts` failed 2 assertions (`expected [] to have a length of 1 but got +0`) on the un-fixed code, then passed 6/6 after fix.
  - Observed opt-in schema test: `LOCUST_CODEX_SCHEMA=1 npx vitest run test/a-codex-schema-change-cannot-silently-drop-a-read-field.test.ts` passed 5/5 against installed Codex CLI 0.160.0.
  - Observed adapter suite: `npx vitest run && npx tsc -p .` passed with 780 tests passed (1 skipped).
  - Observed gate: `bash _tools/gate.sh` passed exit 0: 780 adapter tests, 150 mission-store tests, 8,046 desktop tests passed (8,976 total); all TypeScript checks passed; `git diff --check` clean.
- Deduced: When Codex app-server emits `configWarning` with `summary` and optional `details`, it produces a normalized `adapter.diagnostic` warning event with code `app.warning` instead of silently dropping the event.
- Not run: Live session with a real broken config trigger causing Codex app-server to push live `configWarning` over JSON-RPC; no model calls.
- Decisions made: `ConfigWarningNotification` in `codex-schema-read-fields.ts` tracks `['summary', 'details']` to ensure any future removal of either field from generated schema is caught.
- Known issues: None.
- Recommended next step: Review and merge `exec/codex-warning` into main.

## Prompt for a new Codex task

Use this when starting a related chat:

```text
Work in <repository root>. First read AGENTS.md, PROJECT.md, docs/CROSS_TASK_CONTEXT.md, docs/PRODUCT.md, docs/ARCHITECTURE.md, docs/MODEL_ROUTING.md, and docs/CODEX_RUNTIME.md. Inspect the current tree and git status before editing because other Codex tasks may share this checkout. Preserve unrelated changes, state which files you own, and use a separate Git worktree for substantial parallel source changes. Update the handoff log if your work changes implementation status or architectural decisions.
```
