# What is left, and the order to build it

2026-09-01. Written after the approval card landed, which was the last thing
blocked on an unknown. Everything below is now blocked only on work.

## Order, and why

**P4a — Real models and honest effort.** `model/list` returns six models, each
carrying its own `supportedReasoningEfforts`. That single call supplies both the
route picker's model rows and the effort control, and it is the last place the
shell still shows a made-up value (`account-default`). Highest value per unit of
work, and it removes an invented string from the UI.

**P4b — Swarm.** A workspace-wide setting that runs every teammate at its
model's maximum supported effort. It cannot be built honestly before P4a,
because "maximum" is per model — sol and terra reach `ultra`, luna stops at
`max`, the 5.4/5.5 family at `xhigh`. Without per-model data it would be a
label over a guess.

**P5a — Cancellation card. DONE 2026-09-01.** KEPT / STOPPED / NOT DONE, derived from events.
`cancellationSummary` already exists and is tested; it has no UI.

**P5b — Idle teammate. DONE 2026-09-01.** The design's capability-led empty state, shown when a
teammate has no active mission. Small, and it is the state a user sees most.

**P5c — Handoff divider. DONE 2026-09-01.** Mid-mission route switching, resumed from
the reconciled checkpoint. A mission records ONE runtime and its events must
agree with it, so a switch is genuinely two missions: the first is stopped and
reconciled (`createCheckpoint(id, 'route-switch')`), the second starts with
`continuesFrom` (ledger schema v4) and a briefing that lists the unsettled
actions first. Every refusal after the stop says the mission is stopped. The
thread shows the person's original words once, the first run's events, the
divider, then the second run. Live-verified Codex → Claude Code; the divider's
"N actions never reported back" branch was never produced live (every real
switch stopped clean) and is covered by unit tests only.

**P5d — Peer threads. DONE 2026-09-01.** The workroom is real at runtime: a
product-owned append-only channel (`workroom.jsonl`, own directory, the
ledger's record discipline), ledger schema v5 with `mission.peer`
cross-references by message id, and missions that belong to the teammate they
were messaged to. Routed, never broadcast: a completed run ends with one share
block per named recipient; the host checks the name against the roster, bounds
the text, posts it attributed to the sending mission, and the recipient's NEXT
mission is shown it quoted as a claim -- dated, attributed, stated to carry no
authority, share tags defanged. Both transports take part (exec and the
approve-each app-server path). The thread shows the exchange as the design's
"N messages with Atlas" card, UNTRUSTED when open, with the share block
stripped from the agent's own bubble. Live-verified by
`_smoke/workroom-smoke.mjs`: two seeded teammates, Atlas found `pnpm check`
and shared it, Wren's next mission answered "Atlas told me the full-check
command is exactly: `pnpm check`", and the channel file and both ledgers held
the same message id. A control typed text while discovery was still loading
and proved nothing starts without a click.

## Next, in order

**P6a — Reopen a past mission. DONE 2026-09-01.** Colin watched the smoke and
saw Atlas's thread replaced by Wren's the moment Wren's run started, and
Atlas's row gone from the sidebar. Two causes: history was read once at
startup, and selecting a mission was a no-op. Now history re-reads whenever a
run settles, sidebar and Missions-screen rows open a recovered thread (with
its peer cards) when nothing is running, and are disabled with a reason while
something is. A continuation opens stitched: the ROOT mission's prompt (the
continuation's own recorded prompt is the briefing), the prior run's events,
the divider rebuilt from the route-switch checkpoint it resumed from, then
this run. Live-verified by step 8 of `_smoke/workroom-smoke.mjs`.

**P6b — Side-by-side missions.** The one-active-run limit. Per-mission process
ownership and per-mission ledger writers already exist in shape; the service
and the renderer both assume one live run. Only after P6a, because a second
live thread needs somewhere to be shown.

**Housekeeping.** The window/taskbar icon is the bare Locust mark on a
transparent ground (`apps/desktop/resources/icon.png`, from
`_tools/render-icon.cjs`; Colin asked for no tile, as large as the square
allows). A packaged build will need an `.ico` and a packaging config, which
do not exist yet.

## Rules carried into all of it

- Nothing renders as available that discovery has not proven.
- A control that cannot do its job says so rather than appearing and failing.
- Every derived claim gets a test, and every test gets a mutation proving it
  can fail.
- Live-verify in the built app before calling anything done.
