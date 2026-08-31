# Roadmap

Status: living document. Established 2026-08-31 after the live-Codex-mission and durable-ledger work. `PROJECT.md` records what is implemented; this file records where the project is going and why in this order.

## Direction set by the project owner (2026-08-31)

The thesis in one line: **if Cursor and Grok Bot had a baby** — Cursor's usability, ease of use, and model control; Grok Bot's agent-swarm technology and teammate communication.

1. **Claude must be an obviously selectable runtime.** The first vertical slice ran on Codex because it shipped first, but the product must never read as "a Codex app with extras." Claude Code reaches the same live, normalized, durable mission path, and the model picker becomes a real control rather than example data.
2. **Teammates collaborate like a workplace.** Specialized teammates share relevant, helpful context with each other while they work — visibly and inspectably, through product-owned messages in the mission record, never as hidden cross-agent authority.
3. **The interface stays simple, like Grok Bot.** The main surface is teammates and their work — each teammate is a distinct avatar with its own identity — and it should feel almost identical to Grok Bot in simplicity. The one control Grok Bot conspicuously lacks — choosing which model and runtime does the work — stays right on the main surface as a simple picker; that gap is this product's opening. The rest of the advanced control surface (fallback policy, permissions, provider setup) lives in settings, not on the main screen; the control-plane transparency this project exists for is surfaced through progressive disclosure, never as a dashboard wall.
4. Standing decisions hold: local-first, free and open source, users bring their own access, no persistent cloud computers until the local trust model is proven.

## Sequencing rationale

Trust primitives come before autonomy. A durable, append-only record of what every teammate did (M1) is the precondition for letting missions survive restarts, for route fallback, and for multi-teammate work; runtime parity (M2) comes before collaboration (M3) so the workplace is never single-vendor; checkpointed fallback (M4) precedes real side-effect tools (M5) because a mission must be able to stop safely before it is allowed to act consequentially.

## M1 — Durable mission ledger (in progress)

Tracked by [issue #1](https://github.com/automatedworkflowllc-design/ai-teammate-platform/issues/1).

- ✅ Append-only, schema-versioned JSONL mission ledger (`packages/mission-store`) with strict revalidation on read, sequence contiguity, fsync on append, exclusive create, byte-offset tamper detection, truncated-tail recovery, and bounded file/record sizes.
- ✅ Live Codex missions persist mission metadata, every normalized event, and host failures before they are shown; persistence failure is a first-class, surfaced outcome that aborts the run rather than continuing unrecorded.
- ✅ Mission history IPC and restart recovery: completed, failed, cancelled, and interrupted runs are restored with an explicit recovery state and integrity-issue count.
- ✅ 2026-08-31 adversarial review (5 dimensions, per-finding refutation): 11 confirmed defects fixed — restored-receipt/live-update reconciliation, dispose latch, persistence-error ordering, deny-all permissions, packaged-build egress block, validated window-control IPC, honest per-mission integrity attribution, list limit, cache invalidation after uncertain writes — plus 14 new tests pinning the invariants.
- Remaining: one live post-hardening UI smoke (blocked on Codex quota), reconciled checkpoint records (the safe boundary that fallback and restart-resume build on), and the deferred hardening backlog: write-side event validation parity with the reader, batched fsync, recency-aware ledger scans past 500 files, byte-capped history responses, and preserving the head of >500-event live runs in the rail.

Definition of done: a user starts a mission, kills the app mid-run, restarts, and inspects a truthful durable receipt that says exactly how far the run got — with `pnpm check` green and ledger fixtures covering torn writes, schema drift, and external modification.

## M2 — Claude runtime parity and real model routing

Tracked by [issue #3](https://github.com/automatedworkflowllc-design/ai-teammate-platform/issues/3) (Claude half, elevated ahead of OmniRoute).

- Claude Code stream-json normalizer producing the same product-owned event types as the Codex normalizer, with the same privacy stance (no persisted reasoning, bounded redacted evidence).
- Generalize the mission service, ledger metadata, and IPC contracts from `runtime: 'codex'` to a runtime union so a mission records which runtime ran it. Ledger schema version bumps with a migration-read path.
- Live read-only Claude mission end to end: the already-built restricted/plan-mode command spec (`createClaudePrintCommand` — flags verified against the installed CLI 2026-08-31) through the existing bounded transport, rendered in the same Signal Rail.
- The route picker becomes real: enumerate actually-available runtimes and models from discovery (Codex account default plus explicit models; Claude models by name), show resolved runtime/model/route on every mission, and persist the selection into mission metadata. Selection itself stays one simple, obvious control; policy depth (fallback chains, provider setup) moves to settings per the UI direction.

Definition of done: from one command dock, a user runs the same harmless mission on Codex and then on Claude, sees which runtime/model handled each, and both receipts survive restart.

## M3 — Teammate profiles and the workroom

Tracked by [issue #4](https://github.com/automatedworkflowllc-design/ai-teammate-platform/issues/4), from the 2026-08-31 owner direction.

- Teammate profiles: name, role, instructions, default runtime/model/route, and tool policy — stored locally, reusable across missions.
- Teammate identity: each teammate gets a unique avatar and visual identity; the avatar IS the agent in the UI, Grok Bot-style, with the roster as the primary navigation.
- Concurrent missions: remove the one-active-run limit with per-mission process ownership and per-mission ledger writers.
- The workroom: a product-owned, append-only message channel where teammates post updates, questions, and findings relevant to each other's missions — a shared feed rendered like a workplace, every message attributed and stored in the ledger.
- Safety invariants: a teammate's message to another teammate is untrusted content — it can inform, never authorize; cross-teammate messages never carry credentials or grant tool authority; the user sees the same feed the teammates see.

Definition of done: two named teammates run missions side by side, exchange at least one relevant, visible update through the workroom that measurably informs the other's work, and the whole exchange is inspectable in the durable record.

## M4 — Checkpointed fallback and the curated gateway

Remainder of [issue #1](https://github.com/automatedworkflowllc-design/ai-teammate-platform/issues/1) and [issue #3](https://github.com/automatedworkflowllc-design/ai-teammate-platform/issues/3).

- Reconciled checkpoints at safe boundaries; quota/rate-limit classification (already normalized as `route.limit_detected`) settles the run at a checkpoint instead of failing opaquely.
- Fallback policy Off / Ask / Automatic, capability-checked against the target route, with the switch recorded as a visible mission event.
- Optional curated OmniRoute localhost gateway for approved free-tier providers and local models — never the control plane, never a way around auth or safety failures.

## M5 — Real tools, approvals, receipts

- First side-effect tool integrations (small, well-tested set) with approval classes, side-effect receipts, and idempotency keys.
- Never retry an irreversible action after an uncertain result; reconcile from receipts.

## M6 — Name, packaging, community

- Decide the public name and package namespace; installer/distribution for Windows first; contributor documentation and issue templates beyond the current baseline.

## How I would build this — the planning model's opinionated approach (2026-08-31)

Recorded at the owner's request: not neutral documentation, but the approach the planning model would actually take. Where a milestone above conflicts with this section, the milestones win; this is the how, not the what.

1. **The runner abstraction is the sacred seam — and it is the whole VM story.** `RuntimeProcessRunner` in (bounded prompt, fixed argv) and out (record stream + completion receipt) is already provider-neutral. A future cloud/VM runner is just another implementation of that same contract, so nothing above the adapter layer changes when it arrives. Stay on the local machine until the contract has survived two real runtimes plus the workroom; only then is "our own VM solution" worth designing — likely local hypervisor isolation first (WSL2/Hyper-V class), rented VMs second. Building it earlier would freeze the contract before it has earned its shape.
2. **Never let two writers share a ledger file.** Per-mission single-writer JSONL is already the design; keep it when missions run concurrently (one writer per mission, not one global writer). The workroom becomes its own append-only channel file with the same record discipline — schema version, sequence contiguity, fsync — cross-referenced from mission ledgers by messageId, never interleaved into them.
3. **The Claude adapter is a normalizer, not a rebuild.** The command spec exists and its flags verify against the installed CLI. The work is a `claude-events.ts` mirroring `codex-events.ts`: map stream-json records (init, assistant deltas, tool_use/tool_result, result) onto the same product-owned event types, with fixtures captured from one real authenticated run and then made auth-free. If the mapping forces new event types, the event model is wrong — fix the model, not the mapping.
4. **Model catalogs are runtime data.** Enumerate what each CLI actually offers at discovery time (account default for Codex; named models for Claude), cache briefly, degrade to "unavailable" honestly. Hardcoded model lists rot within a quarter and quietly lie in the picker — the one place this product must never lie.
5. **Swarm communication is routed, not broadcast.** Grok Bot's swarm feel comes from teammates knowing about each other's work; the trustworthy version routes on relevance. Each teammate ends work turns with an explicit share decision — what, to whom, why — posted to the workroom as an attributed message; ambient broadcast of everything to everyone burns context and creates authority confusion. Receiving teammates get workroom messages as quoted, untrusted data in their next turn: inform, never instruct.
6. **Two-layer UI, simple layer wins by default.** The home surface is the Grok Bot layer: avatar roster, one command box, one model picker. The existing control room does not get deleted — it becomes the inspector behind a drill-in, and settings absorbs policy (fallback chains, permissions, providers). Build teammate identity (avatar, name, role, color) as data on the teammate profile from day one; identity bolted on later never feels native.
7. **Every milestone ends in a live smoke, not just green tests.** The fake-runner suite catches contract regressions; only a real `pnpm dev` mission catches wiring truth. Keep the LIVE_SMOKE/LIVE_UI pattern as each milestone's definition-of-done gate, one per runtime.
8. **Schema-version discipline over migration ambition.** Bump `MISSION_LEDGER_SCHEMA_VERSION` on any metadata change, keep reading exactly one version back, surface anything older as "unsupported" honestly. A local-first tool that silently migrates or silently drops history loses the only thing it sells: trust.

## Standing risks

- **Provider drift.** CLI flags and JSONL shapes change under alpha releases; contract fixtures per adapter are the regression net, and discovery must degrade to "unavailable" rather than guess.
- **Terms of service.** Support levels for installed-account authentication per provider remain an open decision; the product never pools or copies credentials regardless.
- **Scope gravity.** Grok Bot comparisons pull toward breadth (many teammates, many connectors). The moat here is trust and control; each milestone ships narrow and verified.
