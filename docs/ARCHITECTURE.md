# Architecture

As built, at 0.619 (2026-10-04). Every claim here names the file it was read
from. The design this product started from, in September 2026, is at the end,
as a short account of what was planned and what was built instead.

## What runs where

Locust is one Electron application (`apps/desktop`) with three parts, and two
workspace packages it is built from (`pnpm-workspace.yaml`: `apps/*` and
`packages/*`).

**The main process** (`apps/desktop/src/main/`) owns everything that touches
the machine: finding and starting the AI agents, the ledger, approvals,
routines, the workroom, memory, updates, backup. It is the only part that
spawns a process, reads a file outside the folder a teammate works in, or
reaches the network.

**The preload bridge** (`apps/desktop/src/preload/index.ts`) exposes one
object, `desktop`, to the window through `contextBridge.exposeInMainWorld`.
Each method is one IPC channel with a fixed name (`apps/desktop/src/shared/ipc.ts`).
Nothing else crosses: no paths the window chose, no commands, no file handles.

**The renderer** (`apps/desktop/src/renderer/`) is untrusted. Its window is
made with `sandbox: true`, `contextIsolation: true` and `nodeIntegration:
false` (`main/index.ts`). The session refuses every device and web permission
(`setPermissionRequestHandler` answers no, `setPermissionCheckHandler` answers
false), and in the installed app a `webRequest.onBeforeRequest` filter cancels
every http, https, ws and wss request the window makes, apart from a previewed
web page's requests to the library hosts `docs/NETWORK.md` lists. The
spellchecker's dictionary address points at a folder on this machine, so no
dictionary is fetched. Every IPC handler that acts first checks the request
came from Locust's own window and its top frame (`fromOwnWindow` in
`main/index.ts`): a request from a previewed page's frame is refused.

So the window can show, and ask. It cannot do.

Home's decorative cover holds its current frame after 45 seconds without
pointer, keyboard, wheel or arriving run activity, and immediately while
unfocused, hidden or under reduced motion (`renderer/src/useCoverActivity.ts`).
One class on the cover pauses CSS animations; the same hook's presence stops
canvas frame requests without rebuilding the bots (`components/HomeCover.tsx`,
`components/Bot.tsx`). Arriving work reaches the hook through `App.tsx` and
`components/FirstLaunch.tsx`. The cover's keyframes only animate transform and
opacity; its lime lockup is a prepainted layer faded over the ordinary ink,
and its loading beam rotates a painted gradient (`shell.css`,
`components/PoweredLockup.tsx`, `components/Beam.tsx`).

**Pictures in a thread.** Read-tool rows and changed-file rows add raster
previews beneath their names; local Markdown images use their alt text as a
caption (`renderer/src/components/ThreadImage.tsx`, `ActivityCard.tsx`,
`ThreadItems.tsx`). `ThreadImagesContext` carries the conversation's folder,
or a comparison column's own copy. `AttachedImage.tsx` asks once per mounted
path and folder, discards late answers, and retains no cache across threads.
The host checks both lexical and real-path containment in that selected,
host-known folder, refuses network paths and SVG, and caps reads at 8 MB
(`main/workspace-image.ts`, `shared/image-files.ts`). A refused preview leaves
the named row alone. Pictures keep their proportions within the reply width
and 320 pixels high; pressing one uses the existing file viewer.

## The AI agents run their own tools

Locust has no model of its own and runs no code a model wrote
(`docs/DECISION-2026-09-20-LOCUST-NEVER-RUNS-MODEL-CODE.md`; amended once, for
a web page a teammate made, which runs in a frame of its own origin,
`docs/DECISION-2026-09-28-PAGE-PREVIEW.md`). Each AI agent is the CLI the
person installed and signed into, started by the main process as a child
process in the folder the teammate works in, and it runs its own tools under
its own policy. Locust reads what the agent reports and writes it down.

The agents this build knows are the ids in `LocalRuntimeId`
(`shared/ipc.ts`): Codex CLI, Claude Code, Cursor Agent, OpenCode, Copilot
CLI, Antigravity, Muse Code, Gemini CLI and OmniRoute. How far each goes is one
table, `RUNTIME_INTEGRATION` in `shared/runtime-integration.ts`: Codex, Claude
Code, Cursor, OpenCode and Copilot are `live`; Antigravity is `experimental`
(it runs through a surface its maker did not publish, `main/antigravity-host.ts`);
Muse Code is `preview` (measured only on its free echo provider); Gemini CLI
and OmniRoute are `planned`, listed and not started.

Each agent is spoken to the way it offers (the builders and normalizers
imported at the top of `main/codex-mission.ts`, from `packages/runtime-adapters`):

| Agent | How a run is started | What Locust reads |
| --- | --- | --- |
| Codex CLI | `codex app-server`, JSON-RPC over stdin and stdout, every mode (`codex-app-server-run.ts`) | its notifications, and its approval requests |
| Claude Code | `claude` in print mode, with a small MCP server beside the app as its permission prompt tool (`main/permission-host.ts`) | its event stream, and the permission questions the bridge forwards |
| Cursor Agent | `cursor-agent` in print mode | its event stream |
| OpenCode | `opencode run`, or `opencode serve` when a mode needs it to stop and ask (`opencode-serve-run.ts`) | its records, and `permission.asked` from the server |
| Copilot CLI | `copilot` in print mode, or over the Agent Client Protocol (`acp-run.ts`) | its events, and `session/request_permission` |
| Antigravity | the IDE's own `language_server.exe agentapi`, while the IDE has the folder open | the conversation's JSONL transcript, polled |
| Muse Code | `muse` in exec mode | its event stream |

Discovery (`packages/runtime-adapters/src/discovery.ts`) finds each CLI,
asks it its version and its models, and asks whether it is signed in, without
reading a credential file. Models in the picker are what the installed CLI
listed (`main/model-catalog.ts`); nothing is offered that it did not list.

**What Locust can stop** depends on whether the agent asks first, and that
differs by agent and by mode. The one list is
`shared/what-locust-can-stop.ts`; Settings > AI agents draws it and
`docs/WHAT-LOCUST-CAN-STOP.md` is written from it. Read that; it is not
restated here.

## The approval path

Where an agent asks, the question reaches the main process as a request:

- Claude Code's permission questions arrive at `main/permission-host.ts`, an
  HTTP listener on `127.0.0.1` that only accepts a token minted for that run.
  The bridge the CLI spawns (`resources/locust-permission-bridge.mjs`) forwards
  each question to it. Connector calls only: Claude Code grants Bash and Edit
  by its own `--tools` flag and never routes them here.
- Codex app-server approvals, OpenCode serve permissions and ACP permission
  requests are turned into one shape by `main/approval-channel.ts`: a kind
  (command, file change, question), a summary, the whole detail, the folder.

Every request then goes through `decide` in `shared/who-decides.ts`, in one
order, before a card is drawn (0.616):

1. A question is never governed: the person answers it.
2. A saved rule that says no: denied, whatever was allowed before.
3. A saved rule that says yes: allowed.
4. An Always the person pressed earlier in this run, if it covers the request:
   allowed, except a command that reaches other programs, which is asked about
   again, and the card says why.
5. Anything else: the card asks.

The rules are `shared/approval-rules.ts` (deny before allow; a command rule
covers one simple command; unreadable rules mean ask), and what a command
reaches is `shared/command-reach.ts`. The hosts remember nothing: the main
process keeps the run's Always keys (`createRunAlways`), and a run id is never
reused. The answer carries who decided, and the ledger records it (schema v21,
`earlier-always`, `packages/mission-store/src/index.ts`), so a saved record
can say "allowed by your rule" or "by your Always on an earlier card".

One exception, said in the code and in the app: Codex keeps its own Always.
Its app-server is told "for the session" and does not ask again, so what that
Always covers never reaches `decide`. Antigravity asks only its questions
(`main/antigravity-mission.ts`), never before an action; Cursor and Muse never
ask. `main/one-path-decides-every-request.test.ts` holds the order.

## The ledger is the evidence

`packages/mission-store` is the record. One file per mission,
`<missionId>.jsonl`, under `mission-ledger` in Locust's profile folder
(`main/profile-backup.ts` names the folder). Each line is one record; records
are appended and never rewritten. On append the file is fsynced; the sequence
must be contiguous; a file that changed between two appends is noticed
(`index.ts`). On read every record is revalidated strictly, a truncated tail is
recovered rather than fatal, and a mission that cannot be read says so with its
issues rather than disappearing. What it is not: tamper evidence at rest. An
edit made with the app closed reads back clean (`PROJECT.md` has said so since
2026-08-31, and it is still so).

Streaming text is held for up to 50 ms from the first fragment of a batch
(`main/streamed-event-batches.ts`). Activity and process exit flush it
immediately. One append is in flight at a time, with bounded backpressure;
each unchanged normalized event is still recorded separately in that append.
Only after the fsync completes does the host send consecutive text fragments
in one IPC message (`main/durable-event-updates.ts`). The renderer folds that
batch in one state update, retaining append/replace semantics and the complete
answer. A write failure stops the run without showing the unwritten batch.

The schema is versioned, at 21 in this build, and every earlier version is
read (`SUPPORTED_MISSION_LEDGER_SCHEMA_VERSIONS`): a file's version is fixed by
its header, and the comment above that list says why each number moved. Three
of those moves shape the product:

- **A hand-off is a new mission.** A mission records one runtime, so a run
  that continues on another runtime, or a second turn in the same
  conversation, is a new mission with `continuesFrom` naming the one before it
  and the reason (`route-switch`, `follow-up`, ...). A conversation is that
  chain. The brief a handed-off run starts with is composed from the ledger's
  checkpoint (`main/handoff.ts`).
- **Who started the run** is written down (`startedBy`): a person, a relay
  between teammates, a routine, a resume, a terminal, a side question. A run
  the host started is never shown as one the person began.
- **Who decided each card** (v20 and v21, above).

The **checkpoint** (`packages/mission-store/src/checkpoint.ts`) is derived from
the ledger and nothing else. It says whether another runtime may pick the
mission up: `safe`, `approval-required`, or `unsafe` with the cause. A tool
call that started and never reported is `unknown`, and an unknown side effect
is never replayed. There is no way to write a checkpoint by hand.

The **workroom** (`packages/mission-store/src/workroom.ts`) is its own
append-only `workroom.jsonl`, kept with the same discipline, because a message
between two teammates has two missions with a stake in it and a ledger has one
writer. Mission ledgers point at its messages by id (`mission.peer` records);
the text lives in one place.

**Save the record** (`main/mission-export.ts`) is a pure function from the
conversation's missions to one Markdown file. It says nothing the ledger does
not, and where the ledger is silent it says so in words. Its own header lists
what the ledger does not hold, and so what the file cannot say. The golden
test `a-saved-record-says-only-what-the-ledger-holds` holds it to that.

## Everything else is convenience

The rest of the profile is JSON files, read on start and rewritten whole:
teammates, routines, memories, saved approval rules, groups, rooms,
comparisons, folders, and this machine's own state (window size, update lane,
the last folder open, runtime facts, usage readings). `main/profile-backup.ts`
names every one of them, each as carried or as left out with the reason.

That split decides **backup**. A backup is a new folder holding a copy of the
named files and the three folders that hold the conversations, the workroom
and the pets taken in, plus a manifest written last with each file's size and
SHA-256. Own-model keys are never in it: they are encrypted by the operating
system (`safeStorage`, `main/own-models.ts`), bound to this account, and a key
belongs in a keychain. A restore is previewed by the same reader, refused for a
missing or mismatched manifest, for a backup from a newer Locust, or while a
run is going, and applied at the next start before any store is read. What it
replaces is moved aside in the profile, never deleted.

A store that is lost is a setup to rebuild. A ledger that is lost is a record
that is gone. That is the difference the folder names carry.

## Teammates, modes and routes

A teammate (`main/teammate-store.ts`) is a name, a role, a look and routing
defaults: runtime, model, reasoning effort and mode. It owns no process. Up to
64 teammates (`MAX_TEAMMATES`); up to 8 conversations live at once
(`MAX_LIVE_MISSIONS` in `shared/live-missions.ts`), each with its own process
and its own ledger writer.

Five modes, `MissionMode` in `shared/ipc.ts`: Ask, Plan, Accept edits, Approve
each, Auto. A mode is given to the agent in the agent's own terms (a Codex
sandbox, Claude Code's permission mode, OpenCode's permission map, Cursor's
read-only flag where it can be held) and the record keeps what was asked for
(`MissionRecordedMode` in the ledger) beside what the agent reported.

A teammate's route is the one that runs: a saved route outranks the composer's
default unless the person changed the picker for that teammate this session
(`shared/route-at-start.ts`). Your own models (an endpoint speaking the OpenAI
chat API) run through OpenCode as a provider of its own (`main/own-models.ts`);
the window is told only that a key is kept.

## Teams

- **Shares.** A run that completed may end with a share block per named
  recipient; the host checks each name against the roster, bounds it, and
  writes one attributed workroom message plus one ledger link
  (`main/peer-exchange.ts`). The recipient's next turn sees it quoted as a
  claim, dated and attributed, never as an instruction. A cancelled or failed
  run shares nothing.
- **The relay** (`main/relay.ts`) lets teammates answer each other with no
  person typing: a share may start the recipient's run, and its answer starts
  the sender's next turn in the thread that asked. A switch in Settings, a hop
  cap, and the rule that a reply with no share starts nothing bound it.
- **Rooms** (`main/room-store.ts`) are a named set of teammates and the posts
  made to all of them. A post starts one ordinary mission per teammate on its
  own route; the room remembers only which missions a post started.
- **Hand-off chains** (`shared/hand-off.ts`) run a routine's steps across
  teammates, each given the step before it quoted, with a checker step that
  must end "VERDICT: APPROVED" before the run counts.
- **Own branch** (`main/worktrees.ts`): a teammate with it on works in a git
  worktree of the folder, under `.locust/worktrees/`, on a `locust/` branch.
  Locust never merges.

## Routines

A routine (`main/routine-runner.ts`) replays its steps: step 1 as a new
mission for its teammate, each later step as a follow-up once the step before
completed. A step that failed or was stopped ends the routine there, said.
Each run is recorded as started by the routine. Schedules
(`shared/routine-schedule.ts`): every N hours, daily, weekly, once, or when a
new file arrives in a folder inside the project (`main/routine-file-watch.ts`,
polled, with a settle time and a cap on fires per hour). The runner ticks once
a minute while the app is open; a time that passed while it was closed is
missed and said missed, never caught up. "Keep running in the background"
(`main/keep-running.ts`) keeps the app alive after the window closes so
schedules fire. When the person was last at the window is written to a mark
(`main/away.ts`), and the next start shows what happened since. Starter
routines ship as files under `resources/routines/`. Routines take inputs and
travel as files (`shared/routine-inputs.ts`, `main/routine-file.ts`).

## Compare

A comparison runs one question on two or three models at once
(`shared/compare.ts`). A column that cannot be held read-only answers in a copy
of the folder under `.locust/compare` in the person's home folder, uncommitted
work included, dependencies and build output left out
(`main/compare-copies.ts`). A judge, one model the person picks, reads the
answers under blind letters and never the models' names
(`main/compare-judge.ts`), and it keeps nothing; the person does.

## Memory

Team memory (`main/memory-store.ts`) is one file per folder in the profile,
each memory naming who wrote it, which folder and which conversation; a person
can edit, switch off or delete any one, and a forgotten one can come back for
seven days. A memory that looks like a key is refused at the door
(`shared/secrets.ts`). Recall by meaning (`main/memory-recall.ts`) ranks the
notes with a small sentence model that ships beside the app
(`_tools/vendor-recall.mjs` stages it; hashes checked), on this machine, with
no network, and is never in the way: a recall that cannot answer in time falls
back to the keyword order.

## Updates

Locust checks for its own updates and installs only when asked, never while a
run is live (`main/updates.ts`); every build is published as a prerelease and
one a day is promoted to the release the tester lane takes
(`main/update-lane.ts`, `_tools/promote-release.mjs`). For the two agents
installed with npm, Codex CLI and Copilot CLI, `main/runtime-updates.ts` looks
for a newer version after the app has been up a while, installs it only when
nothing is running from the agent's folder and only once it is twelve hours
old, and reads a verdict file first, written by the canary that ran the new
version through one real turn (`_tools/runtime-canary.mjs`). Every address
any of this reaches is in `docs/NETWORK.md`, and
`main/the-network-is-written-down.test.ts` fails when a new place in the main
process reaches the network without being listed there.

## Packaging

The Windows build is a per-user NSIS installer, unsigned
(`apps/desktop/electron-builder.yml`; the policy is `docs/CODE-SIGNING.md`).
Beside `app.asar` sit the files that must be real files: the window icon, the
permission bridge Claude Code spawns, npm, the recall model, the pets and the
starter routines (`extraResources`). `_tools/ship.mjs` checks the installer,
not the build folder, and that each changelog claim's words are in the asar.
A Mac build is made in CI as a draft release, signed only ad hoc and not with
a Developer ID (`.github/workflows/mac-build.yml`).

## Two packages the app does not import

`attic/contracts` and `attic/runtime-core` are the September design's shared
types (`RuntimeProfile`, `FallbackPolicy`, `DataBoundary`, the checkpoint and
handoff contracts) and its routing core (capability-aware fallback selection
and a guarded hand-off state machine). They were moved out of `packages/` at
0.589 and are outside the pnpm workspace. Checked on this build: a grep for
`@teammate/contracts` and `@teammate/runtime-core` across `apps/`, `packages/`
and `_tools` finds no import; the only mentions are inside `attic/` itself.
They are kept for history, not built, not tested by the gate, and not
distributed.

## What was planned, and what was built instead

The September 2026 design (this file's first version, 2026-08-30) drew a
control plane with a tool broker every action passed through, a SQLite store,
a native first-party agent loop, a route resolver with Off, Ask and Automatic
fallback at a reconciled checkpoint, and an OmniRoute gateway for free and
local models. Its invariants were a renderer with no permissions and no
network, an append-only record written before the screen, and approval before
consequence.

The invariants held and are what the sections above describe. The mechanisms
mostly did not ship, and the reasons are on record:

- **No tool broker.** Each agent runs its own tools, and Locust gates where
  the agent asks first. Interposing on every action would have meant running
  the agents' tools itself, which `DECISION-2026-09-20` refuses.
- **No SQLite.** JSON files for setup state and the JSONL ledger for evidence
  were enough; the measured bottleneck at 0.573 was the renderer, not the
  store.
- **No native runtime, no OmniRoute, no automatic fallback.** Both ids are
  still `planned` in `RUNTIME_INTEGRATION`. A route switch exists as a
  hand-off the person asks for, from a checkpoint the ledger derives; nothing
  switches on its own.
- **The normalized event vocabulary** survived: it is what each adapter in
  `packages/runtime-adapters` emits, one normalizer per agent, each built from
  streams measured off the real CLI.
- **The runner abstraction and a cloud runner** were not built. Execution is
  local, and the record says so.

`docs/ROADMAP.md` and `docs/REMAINING-PLAN.md` are that period's plans and are
kept as history. `CHANGELOG.md` is the running record of what shipped, in the
app's own words.
