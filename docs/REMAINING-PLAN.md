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

**P6b — Side-by-side missions. DONE 2026-09-01.** Missions run at once, one
live mission per teammate (a mission of nobody's still runs alone), capped at
four. The service keys live runs by runId, a handoff waits on ITS run's loop
only, and interrupt/dispose stop and checkpoint every live run. The shell
keeps every run it knows about in one map keyed by runId with one on screen;
host updates are addressed by runId, so switching threads mid-run strands
nothing. A run that is still starting is listed under its teammate from the
first moment. The composer refuses a second mission for a teammate who is
working, by name, and starting is per teammate rather than per workspace.
Live-verified by `_smoke/side-by-side-smoke.mjs`: Atlas and Wren ran real
Codex missions together ("2 running"), the thread switched between them
while both were live, and both finished with their own receipts. The
approve-each transport still runs one at a time.

**Avatars — generative pixel faces. BUILT 2026-09-01** from the design
agent's `design/locust-desktop/AVATARS.md`. A face is `hue x headwear x
accessory x mouth` on an 8x8 grid, one element per layer with the rest as
`box-shadow` offsets, seeded from the immutable teammate ID and persisted on
the record (`avatar`, validated; a record without one gets the ID's face, so
nothing changes on upgrade). The create dialog seeds a look on open, shuffles
it, recolours it, and shows the working behaviour on a live 56px preview.
Motion is status: a face works (bob, eyes, mouth) only while its teammate has
a live run, in the sidebar and the workroom header; every other chip is
still, and the presence dot plus the label carry the state under reduced
motion. The live step is one avatar-led line -- a working face for a tool or
turn step, a still face with staggered dots for reasoning -- with no bar or
spinner anywhere. Deviation from "renderer only", by necessity: persisting
the face touches the teammate store and its create request (one validated
optional field), nothing else in the main process. Editing a teammate (name,
hue, face, role) reuses the same dialog from the roster; the id and the
missions filed under it stay. Runtime notices raised before a mission's first
step (Codex's skills-budget warning, a config warning) are the runtime
talking about its own setup, so they stay in the Signal Rail and out of the
thread; notices raised during the work still show.

**Housekeeping.** The window/taskbar icon is the design agent's app icon
(the mark on its own rounded dark tile, `locust-app-icon-rounded.svg`),
rendered by `_tools/render-icon.cjs`. A packaged build will need an `.ico`
and a packaging config, which do not exist yet.

## Still open, in the order I would take them

**Models and effort. DONE 2026-09-01.** Each runtime offers its own models:
Codex's from a live `model/list`, Claude Code's from the aliases its own
`--help` advertises (fable, opus, sonnet), so a release like Fable 5.1
appears without a code change and nothing is listed that the installed CLI
did not name. Effort now actually reaches both runtimes -- `--effort` for
Claude, `-c model_reasoning_effort=` for `codex exec`, and per-turn on the
app-server transport -- where before it was chosen in the UI and dropped.
Live-verified by `_smoke/model-choice-smoke.mjs`: picking Claude Code /
fable at high effort ran a mission that answered "I am Claude Fable 5.1",
and the ledger recorded runtime claude, model fable.

**Approve-each side by side. DONE 2026-09-01.** The app-server transport
keys runs by runId like the exec one, one live mission per teammate, capped
at four, each with its own process tree and client. Stopping one answers
only its own pending approvals and leaves the others going. The cancel
channel now tries the exec service and then this one, instead of telling a
person their live approve-each run "is no longer active"; a handoff of one
is refused explicitly rather than reported as dead.

**Connections.** The composer's `+` menu names Connectors with a "needs
reconnection" hint in the reference; nothing behind it exists. Either a real
screen over discovered MCP servers or the row must not be drawn.

**Mission deletion and retention.** Ledgers only ever grow. A person cannot
remove a mission or its workroom messages, and the store scans every file.

**Swarm decisions.** The reference leaves two open: a quota warning before
engaging, and whether swarm survives restart (it does today, as a workspace
setting). A per-mission swarm override is a third.

## Rules carried into all of it

- Nothing renders as available that discovery has not proven.
- A control that cannot do its job says so rather than appearing and failing.
- Every derived claim gets a test, and every test gets a mutation proving it
  can fail.
- Live-verify in the built app before calling anything done.
