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

**Packaging. DONE 2026-09-02.** `pnpm --filter @teammate/desktop package`
builds `Locust-0.1.0-setup.exe` (NSIS, per-user, its own icon and Start-menu
entry) from `apps/desktop/electron-builder.yml`. The build is UNSIGNED: there
is no certificate, so Windows SmartScreen will name the publisher as unknown
on first run, which is what an unsigned build is. `_smoke/packaged-smoke.mjs`
drives the packaged exe: window titled Locust, renderer loaded from the asar
with its brand fonts, discovery finding the local CLIs, and a control proving
renderer network egress is refused in a packaged build.

**Housekeeping.** The window/taskbar icon is the design agent's app icon
(the mark on its own rounded dark tile, `locust-app-icon-rounded.svg`),
rendered by `_tools/render-icon.cjs`. A packaged build will need an `.ico`
and a packaging config, which do not exist yet.

**Replies continue the conversation. BUILT 2026-09-02, not yet live-verified.**
Colin found that every message opened a fresh mission with no memory: a
follow-up answered "your message got cut off -- I don't have context". Both
CLIs can resume a session (`claude --resume`, `codex exec resume`) and the
runtime's own session id was already recorded, so a reply to the finished
mission on screen now resumes THAT conversation. It is still a new mission --
one mission holds one run -- recorded at ledger schema v6 with
`continuesFrom.reason: 'follow-up'` and the session handle. The thread shows
every turn the person typed, and a follow-up draws no handoff divider,
because nothing was handed off. A reply is refused, in words, when the
earlier mission recorded no session or belongs to another runtime; a blank
run pretending to be a reply is the failure being prevented.

**Discovery finds a CLI that never joined PATH. DONE 2026-09-02.** The
packaged app reported "Codex CLI was not found on this machine" on a machine
where Codex was installed and working: it installs into
`%LOCALAPPDATA%\OpenAI\Codexin\<version>\`, which no PATH names, and a
window launched from the Start menu inherits no shell profile. The locator
now also checks the official per-user install roots (newest version first),
and finds the PowerShell host for Claude Code's `.ps1` shim the same way.
PATH still wins. `_smoke/packaged-smoke.mjs` now launches with a bare
`C:\Windows\System32` PATH and requires both runtimes to be found anyway.

**An approaching limit is no longer a red card.** A `temporary-rate-limit`
renders as a quiet line; red is kept for a run that actually stopped.

## Still open, in the order I would take them

**Mission deletion. DONE 2026-09-02.** Colin asked directly. A finished
mission can be deleted for good from the workroom header -- two clicks, the
second of which says "Delete for good?" -- and the host refuses while it is
live, naming the remedy. The ledger's one destructive operation is exactly as
narrow as it sounds: the file goes, nothing else is rewritten. Other missions
that pointed at it keep their pointers, which readers already treat as "stop
here", and its workroom messages stay, attributed, because the person they
were sent to still has a right to see them. Ownership follows the record out.
The mutation control caught my first test for this passing for the wrong
reason (the append after deletion failed at open with or without the cache
invalidation); the test now re-creates the same id and requires it to be as
fresh as the first time. Retention -- pruning old missions on a policy --
remains open.

**Builds are identifiable.** The desktop app is 0.3.0 (0.2.0 added deletion; from 0.1.0, which
every build had been), the installer is named by version, and Settings shows
`Locust <version>` with a development-build marker when unpackaged. There is
still no auto-update: the app never checks for a new version, and adding that
needs a publish target and, honestly, a signing certificate -- both Colin's
decisions.


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

**Cursor Agent. DONE 2026-09-02, live-verified.** Installed with Cursor's
official Windows installer, signed in (the CLI opened the browser; Colin
approved), and measured under the exact argv the builder produces. Three
real streams are fixtures in `packages/runtime-adapters/test/fixtures/cursor/`
and the normalizer is built against them: fragments then one complete
message that replaces them (and closes its item, so a later message does not
overwrite an earlier one), `thinking` deltas redacted and shown as a
reasoning step, typed tool calls with `rejected` results reported as failed,
`--resume <session_id>` continuing the earlier conversation. Discovery reads
sign-in from the text of `cursor-agent status` (it exits 0 either way) and
the model list off `--list-models`: 217 models on this account, effort baked
into the id (`cursor-grok-4.6-high`), so no effort menu -- the builder
refuses one. Read-only runs in `--mode plan`; write mode is the default
mode without `--force`, where shell commands are simply not run. The host
passes `--trust` because a headless run in an unseen directory otherwise
stops on a trust prompt. Per-action approvals are refused for it by name (the
app-server is Codex's). `_smoke/cursor-smoke.mjs`: picked Cursor Agent /
composer-2.5 in the UI, the run answered "I am Composer, a language model
trained by Cursor", and the ledger recorded runtime cursor, model
composer-2.5, resolved name "Composer 2.5", every event signed by the Cursor
normalizer, reasoning redacted. Open: the packaged smoke does not yet
require cursor-agent found (it did pass with three runtimes connected on a
bare PATH, so discovery does find it there).

**Gemini CLI. Found; cannot run, by Google's decision.** Installed
(`@google/gemini-cli` 0.58), discovered, and Colin's Google sign-in went
through -- then Google refused the CLI: "IneligibleTierError: This client is
no longer supported for Gemini Code Assist for individuals". Since
2026-06-18 Gemini CLI serves only API keys and enterprise licences; free, AI
Pro and AI Ultra accounts are all sent to Antigravity. Colin's account is AI
Pro; it makes no difference. Readiness reads that refusal from the text
(the status command exits 0 with it), with a test from the measured output
and a mutation. The command builders exist and are tested; there is no
normalizer because no stream can be captured without an API key, so the host
refuses a Gemini mission by name. Gemini 3.7 Flash is reachable through
Cursor today. Making Gemini CLI itself work needs an AI Studio key in
`~/.gemini/.env`, which is the owner's.

**Antigravity, as the consumer Gemini route. INVESTIGATED 2026-09-02, not
built.** Colin's point stands: most people have Gemini through their Google
account, not an API key, and Antigravity is where Google sends them. Its
language server (`resources/bin/language_server.exe`, built 2026-08-26)
has an `agentapi` subcommand -- `new-conversation
[--model=flash_lite|flash|pro] <prompt>`, `send-message <recipient_id>
<content>`, `get-conversation-metadata <id>` -- reached over gRPC on the
running IDE's port with `ANTIGRAVITY_LS_ADDRESS` and `ANTIGRAVITY_CSRF_TOKEN`
(the token is on the running server's command line). Measured: metadata of
a real conversation came back in full; `new-conversation` is refused with
"project_id is required when providing project_env_config", and any guessed
`ANTIGRAVITY_PROJECT_ID` with "file does not exist". The id names something
on disk the IDE creates per project and nothing local revealed its form. The
one cheap next step is the owner's: open a terminal inside Antigravity and
run `set ANTIGRAVITY_` -- the IDE sets these for its own terminals, and the
real values show the id's shape and where it points. Also note the API
speaks in conversations and messages, not a JSONL event stream, so a
runtime built on it would be a different transport from the three CLIs.

**Muse Spark.** Meta's coding model, on an OpenAI-compatible API at
`api.meta.ai/v1` (`muse-spark-1.2`, and `muse-spark-1.2-contributor` at
roughly a tenth of the price). Its own agent CLI, Muse Code, has a launcher
that supports only macOS and Linux, so it cannot be a native runtime here.
The cheap path needs no runtime at all: a Meta API key configured as a Codex
CLI model provider, so Codex's own stream carries it. Needs the key, which is
the owner's.

**Auto-update.** Nothing exists. The repo is private, and GitHub Releases on
a private repo would need a token inside every installed app, which is out.
Proposed: a separate PUBLIC repo holding only installers, electron-updater
pointed at it, no secret in the app. Signing is separate spend and only
affects SmartScreen. Waiting on the owner's yes.

**A picker one runtime could bury. DONE 2026-09-02, live-verified.** Cursor
lists 217 models on this account, and the picker drew all of them in one
group: the list scrolls, so the three runtimes underneath were not visibly
there at all. Each group is now capped at six rows until someone types, and
a capped group states how many rows it is holding back -- never a silent
truncation. The row you are currently on is always kept, even when it sits
below the cut, because a picker that hides your own route cannot be read.
Searching lifts the cap entirely: narrowing a person's own search a second
time would misreport what matched. `_smoke/picker-smoke.mjs` verifies this
in the built app and starts no mission, so it costs no provider quota: six
rows for Cursor plus "211 more models", 15 rows standing above the last
runtime rather than 217, and 14 rows with no cap line when "grok" is typed.

**Connections.** The composer's `+` menu names Connectors with a "needs
reconnection" hint in the reference; nothing behind it exists. Either a real
screen over discovered MCP servers or the row must not be drawn.

**Retention. DONE 2026-09-02, live-verified.** Settings now states what the
local history costs -- how many missions, how many bytes, and how far back it
goes -- and offers to delete finished missions older than 30 days, 90 days or
a year.

Nothing is ever pruned automatically. A durable local record is this app's
whole claim, and deleting one on a timer, with nobody present and no undo,
would quietly take history no one agreed to lose. So the first press only
ASKS, and what comes back is the host's own plan, computed by the same code
that does the deleting -- a separate preview implementation could disagree
with the real one, and the disagreement would only ever be discovered after
the files were gone. A mutation proves the preview deletes nothing.

The rule that made this worth building carefully: a reply is a NEW mission
that continues an older one, so an unguarded "delete everything older than a
month" would gut a conversation you are still in. The prune walks back from
everything that survives and keeps the whole chain behind it, not just the
immediate parent. Both of those have mutations. It also never deletes a
mission the transports report as running, and leaves a file it cannot read
alone rather than guessing its age.

Two things the host decides rather than the window: the cutoff, computed from
the host's own clock (a window sends a number of days, never an instant, so
it cannot send a date in the future and take everything), and which missions
are live. Anything but an explicit `dryRun: false` is a preview, so a
malformed request can never be the thing that deletes a history.

`_smoke/retention-smoke.mjs` drives it in the built app on a seeded ledger
and starts no mission, so it costs no provider quota. It caught one real
defect: the report dated the history by the FILE's timestamp while the prune
judges by the record, so a copied ledger directory would have shown "oldest:
today" over missions from months ago -- exactly the number someone reads
while deciding to delete. Both now read the record.

Still open here: workroom messages are not pruned with their missions, and
the store still scans every mission file to list.

**Swarm decisions.** The reference leaves two open: a quota warning before
engaging, and whether swarm survives restart (it does today, as a workspace
setting). A per-mission swarm override is a third.

## Rules carried into all of it

- Nothing renders as available that discovery has not proven.
- A control that cannot do its job says so rather than appearing and failing.
- Every derived claim gets a test, and every test gets a mutation proving it
  can fail.
- Live-verify in the built app before calling anything done.
