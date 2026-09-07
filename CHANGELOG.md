# Changelog

What changed in each build, written for someone using Locust rather than
reading its source. The commit history carries the engineering detail; this
carries what you would notice.

Dates are when the build was cut. Versions are the number Settings shows.

## 0.43.3 — 2026-09-07

- **A routine taught on Cursor replays again.** Saving one recorded the
  reasoning level beside the model, and Cursor keeps its levels *inside* the
  model id and refuses one passed separately — so a routine taught on Cursor
  threw the moment it replayed and never opened a mission. It had been that
  way since 0.43.0. The level is now stored only where it would actually be
  sent, so a routine on Codex or Claude Code still replays at the level it was
  taught with. A routine saved on Cursor by 0.43.0, 0.43.1 or 0.43.2 still
  carries the bad route: save it again and it will run.

## 0.43.2 — 2026-09-07

- **The next thing you type no longer goes missing.** Typing a second line
  before a teammate had finished starting could leave it stuck in NEXT under
  "that conversation is no longer open" -- about the conversation on screen --
  where it sat until you noticed and sent it by hand. A mission moves to its
  real id the moment the host answers, and anything queued against it now
  moves with it. The same applies across a handoff, where the conversation
  carries on under another runtime.

## 0.43.1 — 2026-09-07

- **One file changed once is counted once.** A one-line append could report as
  `2 files · +2 −0` when git said one line in one file: some runtimes restate
  the same edit with the other spelling of the path, once relative to the
  folder and once absolute, and both the count and the file list took those
  for two changes. They are folded now, on the path as the list draws it. Two
  genuine edits to one file still count as two.

## 0.43.0 — 2026-09-07

- **A routine replays at the effort it was taught with.** Saving one records
  the level you had set; replaying it uses that instead of falling back to
  whatever the runtime does by default. A route whose model reports no levels
  stores none, so nothing changes on the runtimes that take no effort.
- **A teammate stops volunteering another teammate's work.** Shared memory
  stays on — it is useful, and each memory already names who wrote it — but a
  teammate was bringing one up when nobody had asked, reporting what a
  colleague had done to a file you were not asking about. It is now told when
  *not* to raise a memory, which the brief had never said.

## 0.42.0 — 2026-09-07

- **The effort chip agrees with the model beside it.** While a mission ran, the
  chip named the live model but took its levels from whatever route you had
  queued next — two models on one chip.
- **Every turn says when it changed nothing.** `no files changed` was written
  onto the newest turn only, so scrolling up in a conversation showed the same
  silence the line exists to break.

## 0.41.3 — 2026-09-07

- **A conversation shows that it has a menu.** Saving a routine needed a
  right-click, and nothing said so — which is why the feature looked missing
  even after the Automations screen started naming the gesture. Hover a
  conversation in the sidebar (or tab to it) and the actions are there,
  `Save as routine` among them.

## 0.41.2 — 2026-09-07

- **Resuming a mission keeps the effort you set.** It sent the model and
  nothing else, so a resume quietly fell back to the runtime's own default —
  and on Cursor, where the effort is part of the model id rather than a
  separate flag, it ran a different model than the one on screen.

## 0.41.1 — 2026-09-07

- **Swarm is in Settings.** Its only control was the mark on the composer,
  which exists on the workroom alone and is disabled while a mission runs — so
  a workspace-wide setting could not be reached from any other screen, or
  turned off while anything was running. The mark is the glance; Settings is
  the record.
- **A runtime that is already installed stops offering to install itself.**
  One whose version probe has not answered yet was tagged CHECKING and fell
  through to the Install button — or to `Get it ↗` for Cursor and Antigravity.
- **A connected runtime with no version shows its status instead of nothing.**
  The check was written against `undefined` where the value is `null`, so it
  never fired and the slot came out blank — on Antigravity, whose version can
  genuinely be absent.

## 0.41.0 — 2026-09-07

The two things that stopped a stranger, from the full-scope plan.

- **A fresh install lands on a route that exists.** `account-default` means
  "use whatever your account uses", and every runtime honours it — but only
  Codex had a row for it, so once a new machine started preferring OpenCode
  you landed on a lowercase placeholder with no effort control and nothing
  marked as your current route. Every runtime has its own **Account default**
  row now.
- **The install screen shows its work.** The command is shown while it runs
  rather than only after it fails, and `Show output` opens onto everything npm
  said — on the live line and on the failure, where the last lines are usually
  the cause.

## 0.40.1 — 2026-09-07

Three more from the outside tester's report.

- **The two mission counts explain each other.** The sidebar is scoped to the
  folder you are in; the Missions screen is the whole ledger. Both were right
  and neither said so, so one read 3 while the other read 5. The header now
  says `5 local, 0 in this folder`, and only adds that clause when the two
  actually differ.
- **The model chip stops naming the runtime twice.** `OpenCode /
  opencode/ling-3.0-flash-fin-free` truncated to `OpenCode / opencode/big-pic…`
  — the runtime twice and the model cut off. A provider that merely repeats
  the runtime is dropped; one that is real information (`anthropic/…` under
  OpenCode) stays.
- **OpenCode names the output cap.** It was the last of the five runtimes that
  went quiet when Locust stopped a run for sending more than it accepts.

## 0.40.0 — 2026-09-07

- **Automations shows what you set up in the CLIs.** Agents, commands and
  automations you configured in Claude Code, Codex or Cursor are listed in one
  place — with what each one is for, and where to find the file. Locust did
  not make them and does not run them, so they sit apart from your routines
  and have no buttons. A machine with nine of them on it used to read
  "Nothing saved yet."
- **The Automations screen stops sending you to the wrong place.** It said to
  save a routine "from that teammate's card", under a button reading "Open the
  team" — and the control is on neither. It is a right-click on a conversation
  in the sidebar, which is what the screen now says.

## 0.39.2 — 2026-09-07

- **An npm permission error now shows the fix.** It used to say "run the
  command below in a terminal with permission to install global packages" and
  show the same `npm install -g` that had just failed — which fails the same
  way, because the unwritable thing is npm's global folder, not the terminal.
  It now gives `npm config set prefix "<a folder you own>"` and the install,
  and says to put that folder on your PATH.
- **A machine with nothing installed no longer claims Codex.** The welcome
  screen recommends OpenCode while the composer said `Codex CLI /
  account-default`. They agree now.
- **The Memory screen's notice can be dismissed.** Once any teammate
  remembered, proposed or forgot something, that sentence stayed for the rest
  of the session — including after you acted on it on that very screen. An
  update where nothing actually changed also drew an empty paragraph.

## 0.39.1 — 2026-09-07

- **Every runtime names the output cap, not just Codex.** Locust stops a run
  whose single line of output passes 256 KB. Codex has said so since 0.38.4;
  Claude Code, Cursor Agent and Copilot CLI share the same cap and said
  nothing, so a huge-output run looked like the model shrugging rather than
  Locust stopping it. (OpenCode's terminal path has a different shape and is
  still to do.)

## 0.39.0 — 2026-09-07

From a first outside tester's report and an audit of the six releases before
this one. **It corrects 0.38.7, which claimed something untrue.**

- **The composer says how to type a new line.** Enter sends and always did;
  Shift+Enter makes a new line and nothing said so. A tester typed a two-line
  prompt, the first Enter submitted the first line, and the rest queued behind
  it as NEXT until the conversation had closed — losing their opening mission.
  The hint appears while there is something in the box and nowhere else.
- **The effort on the chip is the effort the run is given.** It was not.
  0.38.7 said *"what the chip says is what the run is given"* and that was
  false: the chip rendered a default that was never assigned, so from every
  launch it read `medium` while the run was started with **no effort argument
  at all**. Display and dispatch now share one expression.
- **Changing the mode no longer promises writes it cannot deliver.** Set to
  Accept edits on a thread begun in Ask, the follow-up still ran with no write
  tools, because a resumed runtime session keeps the tools it was built with.
  A changed mode now starts a fresh session instead of silently inheriting the
  old permissions.
- **The typecheck gate is green again.** `pnpm typecheck` runs two configs and
  I had been running one, so three releases were cut over eight errors — six of
  them dead props left by 0.38.7, two in a test file. The dead props are gone,
  along with two comments that described the opposite of the shipped code.

## 0.38.9 — 2026-09-07

- **A run that was allowed to edit and edited nothing says so.** Cursor Agent
  said "Applying the two edits to notes.ts now", reported completed, and left
  the file untouched — and nothing on screen contradicted it, because the
  file count is only drawn when it is above zero. The fold now ends in
  `no files changed`. Stated plainly rather than in amber: asking a question
  in an edit-permitted session changes nothing either, and that is fine.

## 0.38.8 — 2026-09-07

- **Cursor's file rows name your file again.** Cursor Agent reports what it
  edited from inside its own copy of the project
  (`~/.cursor/projects/C-Users-you-code-streaks/src/streak.js`), and a real
  two-line edit produced eleven rows like that, with the filename pushed off
  the end of the row. That folder name is the workspace path with its
  separators flattened to hyphens, so it is recognised rather than guessed:
  only a mirror of the folder you actually opened is read as your file.
  Another project's mirror keeps its full path.

## 0.38.7 — 2026-09-07

Effort is its own control again, and it always says something.

- **A separate effort dropdown, beside the model.** Folding it onto the route
  chip made it invisible until chosen, and choosing a model cleared it — so
  picking a model instantly left you with no effort and no way to see one.
- **Picking a model no longer empties it.** The level carries across when the
  new model advertises it, and lands on that model's default when it does not.
  Never on nothing. What the chip says is what the run is given.
- **Nothing about effort in the model list any more.** Each row still names
  the levels a model reports, because that is information worth having while
  choosing a model; choosing between them belongs on the composer.

## 0.38.6 — 2026-09-07

- **The swarm mark is back on the composer.** The design review moved it into
  the route picker's header; it belongs where you can see it. It is the app's
  own logo and it says, at a glance, that every mission is running at its
  model's maximum. It is never disabled now either -- swarm is a statement
  about every mission, not about the one route you happen to be on. The
  picker keeps the consequence rather than a second switch: the effort levels
  grey out and say who is holding them.
- **The route chip has a chevron.** Effort moved behind that chip, and nothing
  said the chip opened anything.
- **A connected runtime never offers to install itself.** Antigravity showed a
  green dot and a `Get it ↗` button in the same row, because its tag is
  EXPERIMENTAL rather than READY and the row fell through to the download
  branch. A row cannot say connected and not-installed at the same time.

## 0.38.5 — 2026-09-07

Effort on the route you actually start on. 0.38.4 put the control back but
only on routes that name a model; this is the one that fixes a fresh install.

- **The account default is a row you can select.** It is the route a new
  profile starts on, and it was the only route in the app naming a model no
  list contained -- so the picker had no ACTIVE row for it, and the effort
  levels, which sit under that row, had nothing to attach to. It now appears
  as **Account default**, carrying the levels every model on your account
  agrees on. An intersection, not a union: a level only some models accept
  would be a control that silently does nothing.
- **The route you are on is the first row in its group.** It sorted by the
  same rules as everything else, so a route that is neither recently used nor
  a famous name sank below six models and behind a "1 more model · type to
  search them" line. The row the composer points at should never need finding.

## 0.38.4 — 2026-09-07

The effort control, which 0.38.1 removed and did not replace.

- **You can choose reasoning effort again.** 0.38.1 dropped the composer's
  `effort · fixed` chip, and the chips that replace it -- under the selected
  model in the route picker -- landed after that build was cut. So the shipped
  app had the old control gone and the new one absent. Open the route picker
  and the levels sit under the model you are on; the one you pick rides on the
  route chip as `Claude Code / sonnet · high`.
- **Swarm is always there.** It was drawn only when the selected route
  reported effort levels, so on a route that reports none -- including the one
  a fresh profile starts on -- the setting vanished from the app entirely
  rather than moving. It is a pill in the picker's header now, always.
- **A run stopped for output volume says so.** Locust caps a single line of
  runtime output at 256 KB and kills the process past it. It used to report
  "Codex invocation did not complete successfully" -- the words it uses when it
  has no idea what happened -- while knowing exactly what happened. It now
  names the cause and suggests narrowing the ask.
- **The finished-exchange line is still the exchange.** Collapsing it dropped
  its identity along with its band, so screen readers lost it.

## 0.38.3 — 2026-09-06

The rest of the design pass, matched to what was actually drawn rather than to
the description of it.

- **The reasoning effort rides on the route chip** — `Codex CLI / gpt-5.6 ·
  high` — instead of sitting in the picker as a row of its own. It is a
  property of the route, so it reads as part of it.

- **Swarm is a pill beside the picker’s search**, not a band across the top of
  the list. It is one setting, not a section.

- **The activity fold counts the plan’s steps** in its own summary line:
  `41s · 3 of 3 steps · asked 1 subagent · 6 tool calls · 3 files`.

- **A teammate’s message to a teammate is drawn as the same bubble** as
  everything else said in the thread, rather than one with its own size,
  padding, corner and border. Who sent it is a label above it.

## 0.38.2 — 2026-09-06

Two things found by pressing the Install button for the first time.

- **An install that worked no longer looks like nothing happened.** The
  package landed, the command was on disk, and the screen still said no
  runtime was connected and still offered to install it. It notices
  immediately now.

- **A machine without Node is told so, before it is offered a button.** Four
  of the five runtimes install through npm, so without it those buttons cannot
  work — and pressing one used to report that npm had stopped with an error,
  which blamed the command for not existing. The panel now says Node is
  missing and links to it instead.

- **A failed install keeps the command on screen**, with a button to copy it,
  so it can be run by hand or passed to someone who can read it.

## 0.38.1 — 2026-09-06

A design pass over the conversation column, which had grown nineteen different
kinds of object where Claude Code has three. Nothing is removed; several
things stop being their own box.

- **A plan now sits inside the activity fold**, as its first rows, instead of
  in a card above it. A plan is the clearest statement of what a run did, so
  it belongs with the rest of what it did. A run that answers with steps and
  touches nothing keeps its plan where it was.

- **What a conversation taught the team** is a note now rather than a bordered
  card. It already happened and it asks nothing of you.

- **The mission id is said once.** It sat at the top of the thread and in the
  header band above it, thirty pixels apart. The start time was only in the
  thread, so that stays.

- **The durable receipt is one line** — runtime, model, checkpoints, verified —
  with the full table behind the same disclosure the activity fold uses.
  Nobody reads "Events: 41 recorded" twice. An unverified action still shows
  without opening anything.

- **A teammate's row in the sidebar stops stacking five lines.** The routine
  step and the branch answer the same question, so one line shows whichever
  applies: the step while a routine runs, the branch otherwise.

## 0.38.0 — 2026-09-06

- **Locust installs a coding agent for you.** Open it on a machine with none,
  and each one now has an Install button beside it instead of a command to copy
  into a terminal you have to find. OpenCode leads the list and is the only one
  with a filled button, because it is the only one that needs no account at all
  — one install and there is a working teammate.

- **It shows the line it is about to run, before it runs it**, and while it
  works it shows npm's own last line and how long it has been going. There is
  no progress bar, because npm does not report anything that honestly becomes
  one.

- **When an install fails it says what happened and what to do** — no network,
  a proxy, permissions, a name that has moved, or something nobody has seen
  before — and the command stays on screen so you, or someone helping you, can
  run it by hand. If npm finishes cleanly and the command still is not there,
  it says that too and offers a restart.

- **Cursor Agent and Antigravity are not packages**, so their button opens
  their own page instead. Same size, same place, one different word.

- **Signing in has no button and will not get one.** It happens in a browser
  or with a device code, and a button that opened a terminal and left you in it
  would be worse than the line telling you what to type. The row shows the
  command, and Locust notices on its own when it is done.

- **The composer lost three controls it did not need**: a `+` that was
  permanently disabled, an effort chip that read "effort · fixed" on most
  routes, and a swarm toggle that switched the effort chip off. Effort now sits
  under the model it belongs to in the route picker, and swarm is that picker's
  own switch.

## 0.37.1 — 2026-09-06

Three corrections, two of them to fixes from earlier the same day.

- **A teammate replying to another is no longer told the folder was shared.**
  When one teammate passes work to another, the second was told "another
  teammate was working in this folder at the same time, so what changed on
  disk cannot be told apart" -- about a run that had already finished. Its own
  work then counted for nothing. Two runs share a folder when both are
  running in it, which is now what gets asked.

- **Teammates on their own branch are told so even in a folder with no
  LOCUST.md.** The sentence that stopped those runs dying was riding along
  with the project's own instructions, so a folder without an instructions
  file never got it -- which is every folder, for someone who has just
  installed the app. The team's memory also stopped naming the main folder to
  a teammate that is not standing in it.

- **A run stopped by the folder boundary says which folder.** It used to say
  "OpenCode ended without a step that reported it had stopped", which
  describes the silence rather than the cause.

- **A room teammate that repeats the example no longer files it as work.**
  Every teammate in a room is shown an example of how to update the task
  board, and repeating that example back put its placeholder text on the
  board as a real task.

## 0.37.0 — 2026-09-06

- **Install the runtime Locust asked you to install, and it just works.** It
  did not before. The composer was pointed at Codex CLI from the moment the
  app opened and never moved, so someone who installed OpenCode -- because
  Settings told them to -- came back to a box still reading "Install a coding
  agent and sign in to start a mission", pressed Enter, and got nothing at
  all. The route now follows what is actually on the machine, preferring the
  one that needs no account; a route you pick yourself is never moved for you.

- **A message that cannot be sent says why.** Pressing Enter used to do
  nothing, silently, whenever the route could not run. That is the worst thing
  a first run can do.

- **The model list keeps up.** It was read once when the app opened, so a
  runtime whose check finished a moment later showed a single "account
  default" row for the rest of the session -- Claude's Sonnet, Opus and Fable
  simply missing, and every OpenCode model too. It is re-read when the
  runtimes change and when you open the picker.

- **The picker says which models are free.** OpenCode's free ones were listed
  by name with nothing to distinguish them from the paid ones.

- **A runtime that needs no account is no longer described as signed in.**
  OpenCode said "Signed in on this machine, using your own account" to people
  who had never signed in to anything.

- **The first screen and Settings stop asking for a sign-in that is not
  needed**, and on a machine with nothing installed the list leads with the
  one that needs no account instead of burying it fifth.

## 0.36.5 — 2026-09-06

- **A runtime Locust cannot find now tells you how to get it.** It used to say
  only "Claude Code was not found on this machine. Install it and sign in" --
  true, and a dead end that sends you off to search. Each one now shows the
  exact line to run, with a button that copies it, and says what signing in
  takes afterwards. The two that do not install from a package manager link to
  their own page rather than to a command line invented for them.

- **And on a machine with none of them, it says which one to start with.**
  OpenCode needs no account at all -- one command and its free model runs --
  so that is the sentence at the top of the list, instead of leaving you to
  read down a list that opens with one wanting a paid subscription.

## 0.36.4 — 2026-09-06

- **Teammates on their own branch actually finish now.** Giving each teammate
  its own worktree is how you stop several of them colliding in one folder, and
  it was the least reliable way to run them: with three going at once, six of
  nine runs died with nothing but "the run could not continue". A teammate was
  being told its instructions belonged to the main folder, which is not the
  folder it works in, so it went looking -- and OpenCode ends a run that asks
  for a directory outside its own. A teammate on a branch is now told what is
  true for it: this is the project, you have your own copy, work inside it. Nine
  runs since, none lost, and nothing written outside anyone's own copy.

## 0.36.3 — 2026-09-06

- **A shared folder now says it is shared.** 0.36.2 stopped a teammate taking
  credit for another's files, and went too quiet doing it: a run that had just
  edited a file could show five tool calls and no file at all. It now says what
  it honestly knows -- "another teammate was working in this folder at the same
  time, so what changed on disk cannot be told apart" -- and names how many
  files in the folder are different, counted against nobody. What each model
  reports about its own work is still counted as its own.

## 0.36.2 — 2026-09-06

- **Teammates working at the same time no longer take credit for each other's
  files.** Start three teammates in one folder and each activity card counted
  every file all three had changed: a teammate that wrote a single forty-line
  file reported three files and a hundred and twenty-four lines. The host was
  comparing the whole folder before and after each run, which is how it catches
  an edit a model makes quietly and never mentions, and it cannot tell whose
  edit it is when two are working at once. Now it says nothing rather than
  something wrong, and what each model reports about its own work is unchanged.

- **A teammate that cannot be read from the roster file says so** in the log
  instead of simply not appearing.

## 0.36.1 — 2026-09-06

- **"Install and restart" restarts.** It never did: installing on quit is
  silent and starts nothing, and the call that relaunches could not be
  made while the app was still flushing its record. The installer now runs
  as the last act of that shutdown, with the flag that starts the app
  again (Colin: "the restart after update and restart has never worked").
- **A plan is still a plan after a restart.** Reopening one lost its
  "Build this plan" offer and told you instead that the change was only in
  the reply, which is the wrong thing to say about a plan. The record now
  keeps which mode was asked for, beside what the run was allowed.

## 0.36.0 — 2026-09-06

A sidebar you can fold, a place for automations, and eight fixes from an
outside review.

- **The sidebar folds.** Teammates and Automations are sections with a
  count and a chevron, and the whole heading is the button. Missions
  appears when there are conversations no teammate owns, and says just
  "Missions". Every conversation is still one click away under its
  teammate.
- **Automations.** Every routine in one place, scheduled ones first,
  with its teammate, steps, runs and next run. The section stays on the
  sidebar even when it is empty, so the capability is visible before you
  have used it.
- **Settings toggles are switches**, the same control the Memory screen
  has always had.
- **How full the model's context is**, as a small ring beside the route.
  Hovering says it in words. It is drawn only where the runtime reports
  its own window size, so nothing is measured against a guess.
- **Real model names.** Claude Code takes an alias -- sonnet, opus,
  fable -- and only its result says which model that meant. The picker
  now learns from there, so a route reads "Sonnet · claude-sonnet-5"
  after its first run.

Fixed, from a review that ran the app rather than reading it:

- **Memory's "Open the conversation" opened nothing**, every time.
- **A handoff could take its title from your own words** when they
  happened to contain a sentence the app writes into its briefings.
- **The activity fold counted the wrong things.** A model's own to-do
  list counted as a changed file; a deleted file counted as none.
- **A scheduled routine that could not start failed silently** and kept
  failing. It now says which one, why, and when it will try again.
- **A long name no longer wraps the controls row** at any window size.
- **A borrowed route says what it may do.** A teammate replying on
  someone else's route never inherits Auto, and now says so.

## 0.35.2 — 2026-09-06

From a targeted QA pass on 0.35.0, and one thing Colin saw on the bar.

- **The composer addresses whoever owns the conversation you opened.**
  Clicking a teammate's message in an exchange opened their run under a
  header with their name, while the composer still said "Message Wren…"
  and Wren's card stayed lit. Three surfaces, two answers, on the one
  control whose job is saying where the next message goes.
- **"2 files" over one file.** The fold counted rows, so the same file
  edited twice was two files. It counts distinct paths now.
- **A refused write is not a changed file.** It was being counted as one,
  and counted again as a refusal.
- **A handoff shows the words you actually typed.** When a route switch
  carries a new instruction, the thread was reaching past it to the
  sentence that opened the conversation. A rescue with nothing new still
  shows the original.
- **Auto is always in the permission menu.** It used to be absent until
  you switched it on in Settings, so choosing it meant going somewhere
  else first (Colin: "always allow auto to be chosen from the permission
  dropdown, we want the user experience to be fluid"). Picking it is what
  switches it on. Settings still shows the state and takes it back, and
  the app still asks that switch as each run starts.
- **A long name no longer breaks the controls row.** OpenCode's free
  model is `opencode/muse-spark-1.3-contributor-free` and a scratch folder
  is not much shorter; the row wrapped to a second line to fit either one
  (Colin: "so long in txt it collapses below", then "maybe got to auto
  shorten file text as well"). The name gives way instead, and each chip's
  tooltip carries the whole thing.

## 0.35.1 — 2026-09-06

- **A turn that wrote to a teammate is not a silent turn.** "This turn
  ended without a reply" was appearing directly above the message the
  turn had just sent: those messages are drawn beside the thread rather
  than in it, so the check never saw them (Colin: "the this turn ended
  with a reply intended?"). A turn that genuinely wrote nothing still
  says so.
- **The exchange pill says which way the message went.** "1 message to
  Booty" or "1 message from Booty" instead of "with", and the row
  underneath no longer repeats the sender the pill just named.

## 0.35.0 — 2026-09-06

- **Auto mode: a run that is not confined to the workspace folder.** Off
  until you switch it on in Settings, and then offered in the composer
  beside the others, saying what it does in amber: "Runs without asking
  and may change files anywhere on this machine, not only this folder."
  Every other mode still refuses a write outside the folder. The switch
  is checked again each time a run starts, so turning it off stops the
  next one -- including one a teammate or a saved routine was about to
  start -- and the mission's record says `auto · whole machine` rather
  than leaving a reader to guess what that run was allowed.

  What each runtime is actually given, measured off its own `--help`:
  Claude Code `--permission-mode bypassPermissions` (and only in Auto,
  without `--restricted`: the CLI refuses those two together), Codex CLI
  `--sandbox danger-full-access`, Cursor Agent `--force`, Copilot CLI
  `--allow-all-paths`, OpenCode `--auto`. Nothing else is unlocked: the
  wider flags each of them offers, and the ones that would send the work
  somewhere else, stay refused in every mode.

  The record keeps up: the mission ledger moves to schema 14 so a run that
  was not confined to its folder is written as exactly that. An older
  reader refuses such a mission rather than drawing it as one that stayed
  in the folder, which is the same rule that moved the number when writing
  was first allowed at all.

- **Antigravity runs end when the answer arrives.** A model that reasons
  and answers in the same step never looked finished, so the run stayed
  live and the composer kept its stop button until the idle timeout
  (Colin: "antigravity models with stop button stuck after its done with
  output"). Found by replaying his own stuck transcript.

- **The app icon is the designer's own.** The "portrait, soft fade"
  candidate: the wings run edge to edge, the antennae break the top, and
  the abdomen fades out at the bottom so the crop ends in air. Its five
  supplied sizes are used as drawn and only the three Windows also wants
  are scaled; nothing is re-rendered from an SVG, which is how a
  differently-framed picture got shipped in the first place.

- **No disclaimer under a teammate's message.** The "treated as claims"
  footer is gone with the tag that went in 0.34.1 (Colin: "teammates are
  AI, no one else adds disclaimers with their models in chat like that,
  why clutter?"). Every message is still attributed and still opens the
  conversation it reached.

## 0.34.1 — 2026-09-06

- **Cursor Agent with an effort picked ran again.** Cursor carries the
  effort inside the model id; Locust sent that id and the effort beside
  it, and every Cursor run with an effort chosen failed with "cannot be
  started with the options chosen" (Colin, on grok 4.6). The effort now
  travels as the id alone.
- **The failure names its reason.** "That runtime cannot be started with
  the options chosen. Cursor Agent takes no effort level. Nothing was
  recorded." instead of the first sentence alone.
- **A teammate's message is the way to its conversation.** The underlined
  "open the run this reached" under every relayed message is gone; the
  message itself opens the conversation it reached (Colin: "just feels
  clunky and isn't really needed").
- **No UNTRUSTED tag on an exchange.** Colin: "it's literally AI, it's
  inherently not to be supremely trusted, doesn't need to be there." The
  footer still says teammate messages are claims.
- **The app icon is Locust's again.** Colin: "it's literally showing the
  electron emblem, and it worked prior." The window had carried the right
  icon all along; Windows was drawing the taskbar icon from a Start-menu
  shortcut named "Electron" that a development run had left behind with
  the installed app's id, pointing at a bare electron.exe. Development
  runs now use an id of their own, and a packaged start removes such a
  shortcut if one exists. Also: the packaged window is handed a real
  `.ico` beside the archive rather than a path inside it, and the icon
  is the designer's dark tile -- the bare white mark on a transparent
  ground was invisible on a light taskbar.

## 0.34.0 — 2026-09-06

The design agent's SURFACES-0.22 spec, built as written.

- **The fold's one line is now a trace.** "41s · thought 12s · asked 1
  subagent · 3 tool calls · 2 files" replaces "3 tool calls". The parts a
  person should notice are amber: a subagent that did not report or
  failed, a refused tool. A run that failed or was stopped reads "stopped
  at 41s", and a stopped run that changed nothing says so.
- **A subagent that never reported.** The helper row used to say "working
  on it" forever once the run had ended without the subagent's report; it
  now reads "did not report". The row names the subagent's kind ("Explore
  subagent") and carries its summary in full.
- **Subagent at work, in the sidebar.** A small mark sits beside "subagent
  working" on the teammate's card, so a glance down the list shows who is
  delegating.
- **How much of the window is used, in words.** "67% of the 5-hour window
  used, resets 10:10 PM · 53% of the 7-day window, resets Mon 3:00 AM" on
  the Claude Code row in Settings and in the route chip's tooltip. From
  80% the chip carries an amber dot and the tooltip adds "Long runs may
  be cut short."; at 100%, "This window's limit is used up."

## 0.33.2 — 2026-09-06

- **How much of the account's window a run has used.** Claude Code reports
  it while a run is still allowed ("5-hour window 35% used · resets 7:30
  PM"); Locust used to show a limit only once hit. The reading now sits in
  the route chip's tooltip and on the runtime's row in Settings, kept
  across a reload from the record.

## 0.33.1 — 2026-09-06

- **Codex's subagents show, and stay shown.** Codex records them as
  `collab_tool_call` items, which Locust filed as steps, so a run that
  spawned two agents showed nothing in the fold once they were done. They
  are tool rows now: "spawn_agent" with the ask, settled when the agent
  reports; the sidebar says "subagent working" while one runs.
- **Copilot CLI's reasoning no longer floods the thread.** Copilot 1.0.83
  streams reasoning in pieces, and each piece became an "Unhandled Copilot
  record" line. One Thinking step per reasoning now, and its tool rows
  name the file or pattern they acted on.
- **The taskbar shows Locust's icon on the installed app.** The packaged
  window takes the executable's own icon instead of a path inside the
  archive.
- **A machine with nothing installed says what to do.** Runtimes read
  NOT INSTALLED instead of UNAVAILABLE, the home screen names the agents
  Locust runs and says they appear on their own once installed and signed
  in, and the composer says the same.
- **Locust no longer vanishes on an unexpected error.** The main process
  writes it to locust-errors.log in its data folder, says so in a dialog,
  and carries on.

## 0.33.0 — 2026-09-05

Signal parity with Claude Code, measured from its own stream
(docs/SIGNAL-PARITY-2026-09-05.md has the table).

- **What a subagent is doing, as it happens.** The sidebar says "subagent
  working", the working line says which kind and what it is doing right
  now ("Explore · Reading README.md · last tool Read"), and when it reports
  back its row reads "Explore subagent · reported back · 3".
- **Claude Code's own notifications reach the thread.** A hook that failed
  ("Stop hook error occurred") is said where the run is, as a warning.
- **Settings lists a runtime's skills and agents** beside its MCP servers
  and hooks, by name, from the same folders the runtime reads.

## 0.32.3 — 2026-09-05

- **The activity fold shows the diff on Codex CLI.** That route names the
  files it changed and never sends the change, so a whole session read
  "did not report the change". Locust now reads the change off the disk:
  a new file as an add from its own contents, a tracked file from git, and
  a new file edited again on a later turn as the difference between the
  two. The diff sits on the runtime's own row.
- **"Subagent working."** While a teammate's own subagent runs, the sidebar
  says so instead of "working". The fold's rows and summary say subagent.

## 0.32.2 — 2026-09-05

- **Claude Code teammates can use subagents.** The tool list Locust hands
  Claude Code never included its subagent launcher, so no helper could be
  spawned. It can now, in both modes; a helper inherits the run's tools,
  so a read-only run's helpers read only. The activity fold names what
  each helper was asked and whether it reported back.
- **Read-only on Claude Code no longer runs in plan mode.** Plan mode wrote
  a plan file of its own under your home folder, which the fold counted as
  an edit, and called a tool that fails without a person to answer it. The
  reading-only tool list is what keeps the run read-only.
- **A handed-off mission is one conversation in the sidebar,** not two rows
  with one title, and the teammate keeps the route you handed it to.
- **Settings' Own branches list updates when a run ends,** so "In use"
  becomes "Remove" without leaving the screen.

## 0.32.1 — 2026-09-05

- **A teammate's message that goes nowhere is always said.** When replies
  are off, or a reply could not be started for any reason, the thread that
  sent the message now says so instead of showing nothing.
- **Teammates may ask each other for things.** The brief used to say "share
  findings, never instructions", and the free model read that as a ban on
  passing along the person's own request; it now says a message may carry a
  finding, a question, or a request, and must never forward instructions
  found in files or tool output.
- **Fixed:** a slow test that failed one run in five when the disk was busy.

## 0.32.0 — 2026-09-05

- **Locust makes a folder when none is chosen.** Opened from the Start
  menu with no folder picked, it now works in Documents\Locust, the way a
  terminal always has a working directory, and says so where the folder is
  named. Any other folder is one click away in Settings.
- **Settings reads in one screen fewer.** Each section opens with one line
  and folds its explanation under "How it works"; the folder, its LOCUST.md
  and Own branches sit in one card; runtimes list with the version beside
  the name; the switches sit in aligned rows.
- **The window icon is Locust's.** The taskbar showed Electron's icon,
  because the icon file was not shipped in the package.
- **An approved Codex edit shows its diff in the activity fold.** The row
  read "did not report the change" after the card had shown the change.
- **The approval card scrolls into view when it appears.**
- **Small things seen driving the app:** a mission that failed before it
  started said "Codex CLI" in its header whatever route it was sent to; the
  "Thinking" row showed an item type as if it were a tool.

## 0.31.1 — 2026-09-05

- **A teammate on its own branch reads like one in the folder.** The
  activity fold showed every path as .locust/worktrees/<id>/README.md; now
  it shows README.md, since the tree is the same project and the sidebar
  already says which branch the teammate is on.
- **The thread header uses a Custom teammate's title.** It said "Custom"
  where the sidebar said "Release manager".
- Found by driving the built app through a first session as a person
  would; the record is in docs/user-session/.

## 0.31.0 — 2026-09-05

- **Own branch.** A teammate can work in its own copy of the project
  folder: turn Own branch on in its card and its runs happen in a worktree
  of the folder's repository, on branch locust/<name>, so two teammates
  editing one repository never collide. The sidebar says which branch each
  is on. Settings lists the worktrees and can remove one; the branch stays,
  and merging back is yours to do. Needs the folder to be a git
  repository; a teammate that cannot get its tree says why instead of
  running in the folder unannounced.
- A Custom teammate's title is kept. It was dropped on the way to disk, so
  every Custom teammate read "Custom".

## 0.30.0 — 2026-09-05

- **The approval card shows the change.** When Codex asks to change files
  in "Approve each action" mode, the card now carries the diff itself --
  each file named, added and removed lines counted, the lines drawn with
  the same viewer the activity fold uses -- instead of a summary of what
  it was told. Nothing changes until you approve, as before.

## 0.29.0 — 2026-09-05

- **One instruction file for the whole team: LOCUST.md.** Put a LOCUST.md
  at the root of the project folder and every teammate, on every runtime,
  is given it before each mission -- the file they all read in common,
  beside each runtime's own CLAUDE.md, AGENTS.md or rules. Read fresh at
  every start, so an edit lands on the next mission. Bounded at 200 lines,
  and the brief says when the rest was cut. Settings shows whether one was
  read and how much of it.

## 0.28.1 — 2026-09-05

- **Two more things reach the desk while you are away.** A teammate that
  ends a run with a question card, and a run that stops at its account's
  limit, now show a desktop notification like an approval does -- only when
  Locust is not the window in front. Clicking it brings Locust forward.

## 0.28.0 — 2026-09-05

- **Settings shows what each runtime has set up for itself.** Under every
  runtime: its MCP servers and its hooks, by name and event, read from the
  runtime's own configuration files (Claude Code's settings and MCP files,
  Codex's config.toml, Cursor's, OpenCode's and Copilot's). Names only, so
  no command line or secret reaches the screen; the tooltip names the files
  read. Locust adds none of its own and changes nothing there. A runtime
  with nothing configured says so in words.

## 0.27.6 — 2026-09-05

- **A runtime's own helper has its own row.** When Claude Code or OpenCode
  starts a sub-agent for itself, the activity fold now says "asked 1
  helper" apart from the tool calls, and the row says what the helper was
  asked and whether it reported back. What the helper did inside is not
  reported by the runtime, so nothing is invented about it.

## 0.27.5 — 2026-09-05

- **A runtime slow to answer reads CHECKING, not UNAVAILABLE.** Discovery
  ran once at launch, so a runtime whose first probe took too long (Claude
  Code on a cold start) stayed marked unavailable all session. Now an
  installed runtime that did not answer in time is tagged CHECKING, Locust
  asks again three times fifteen seconds apart, and once more whenever the
  window comes back into focus, so a sign-in done elsewhere shows without a
  relaunch. UNAVAILABLE is kept for a runtime that is not on the machine.

## 0.27.4 — 2026-09-05

- **The home screen, tightened after a design review.** The count says how
  many runtimes are connected, without the two planned ones in the
  denominator; those are named once under the panel as coming soon. The
  privacy claim is made once. The instruction to pick a teammate is the
  sidebar's alone. The mark card is smaller. Runtime names sit against
  their dots. Cursor's build stamp shows its date, not its commit hash.
- **The permission mode looks like the control it is**: boxed like the
  route and effort chips, with a shield and a chevron.
- "no effort" reads as "effort · fixed" (or "effort · default").

## 0.27.3 — 2026-09-05

- **The logo takes you home.** Click the Locust mark in the sidebar to
  return to the home screen from anywhere.
- **Memory lives in Settings.** The sidebar row is gone; Settings has the
  mode, the count, what is waiting for you, and Open memory (Ctrl 5).
- **What a conversation taught the team folds like tool activity.** One
  quiet line -- "Wren remembered 2 things" -- with the lines a click away,
  instead of warning-coloured notices at the bottom of the thread.

## 0.27.2 — 2026-09-05

- With no folder chosen, the title bar shows the build (Locust 0.27.2)
  instead of repeating what the composer's folder chip already says, and
  that chip reads in the usual soft gray rather than amber.

## 0.27.1 — 2026-09-05

- **Locust opens on the home screen.** Launch showed the newest finished
  conversation instead of the home screen with the connected runtimes and
  the folder. Now a conversation is put on screen at launch only if it is
  still running; otherwise the home screen is what you see, and the
  sidebar has the chats.

## 0.27.0 — 2026-09-05

- **Your team remembers.** Teammates keep a shared memory per project
  folder, plus a smaller set marked everywhere -- the way Claude Code and
  Cursor do, managed from Locust. A teammate writes one by ending a reply
  with it; every teammate in the folder reads what is kept, with who wrote
  it and where. The Memory screen (Ctrl 5, or the row at the top of the
  sidebar) lists every memory with who, where, and the conversation it came
  from: edit, switch off, remove, or write one yourself. Settings chooses
  what happens when a teammate writes a memory: keep it and say so in the
  conversation, ask you first, or off. Nothing leaves this machine.

## 0.26.1 — 2026-09-05

- **Editing a schedule keeps what you set.** Pressing the choice a routine
  already has (Daily, or Every few hours) no longer resets its time or its
  hours. Found by driving the edit path after 0.26.0 shipped.

## 0.26.0 — 2026-09-05

- **Routines can run on their own.** Saving or editing a routine now offers
  a schedule: every few hours (1 to 24, counted from its last run) or daily
  at a time. A scheduled routine starts exactly as if you pressed Run -- on
  its teammate's route, recorded as started by the routine -- and the Team
  card says the rule and the next run. It runs only while Locust is open
  and only when its teammate is free; a run missed while Locust was closed
  happens once, when it is next open, not once per missed interval. A start
  that fails is tried again an hour later, not every minute.

## 0.25.0 — 2026-09-05

- **Rooms tell you when something happened while you were away.** A teammate
  moving the board, or the last teammate answering a post, shows a desktop
  notification -- only when Locust is not the window in front. Changes to
  one room are gathered for two minutes and said once, newest last, so three
  teammates finishing together are one thing to read, not three.

## 0.24.0 — 2026-09-05

- **Tasks in a room.** Every room has a board: a task is a line of text, an
  owner, a state (open, in hand, done) and the conversation that last moved
  it. Add, assign, finish, reopen or remove tasks from the room. Teammates
  move the board themselves by ending a reply with a task block -- they are
  told the board and the block with every post -- and the room says what
  they did.

## 0.23.0 — 2026-09-05

- **Rooms.** Make a room out of some teammates (Ctrl 4, or the Rooms section
  in the sidebar once you have one). Post to it and every teammate in it
  answers in their own card, each on their own runtime and model; each card
  opens the conversation it came from. A post starts an ordinary mission per
  teammate, so everything you already know about missions applies.
- **A blank window after switching the route on a finished conversation.**
  With a teammate picked and their finished conversation open, choosing a
  different runtime for the next message could throw during render and leave
  nothing on screen (0.21.6 to 0.22.1). Fixed; found by the room's own smoke.

## 0.22.1 — 2026-09-05

- **The sidebar no longer promises a teammate will pick up a message you
  are sending to nobody.** With no one picked it says so; once someone is
  picked it names them. The first-run footnote said the same wrong thing.
- **Nobody is drawn as chosen until you choose them.**
- **Settings' READY tags are green, not lime.** Lime means something is
  happening right now.

## 0.22.0 — 2026-09-05

- **See the exchange.** When teammates are talking to each other, the
  conversation shows who is in it and on what model, how many automatic
  replies it has used of your budget, what every run in it has cost so far,
  and a Stop that halts all of them at once.
- **The budget is yours.** Settings → Teammates now has "Automatic replies
  per exchange" as fixed steps (1 to 12). Six was a constant; now it is a
  number you chose, and the exchange line counts against it.

## 0.21.6 — 2026-09-05

- **A runtime's usage limit survives a restart.** Settings said AT LIMIT, a
  reload said READY, and nothing had changed. The ledger knew; now the window
  asks it on the way up.
- **Reply on another model after a run stopped.** Switching provider after a
  failure used to start a stranger with no memory of the task. The next turn
  now starts on the new runtime from the old run's checkpoint, briefed on what
  was done and what was left unsettled, with your reply as its latest
  instruction. The composer says so before you send.
- **Edits a runtime never mentioned are still shown.** When a run allowed to
  write ends, Locust compares the working tree (git) with how it was before,
  and every changed file no tool named becomes an *observed on disk* row.
- **A conversation with nobody, and Assign to a teammate later.** From the
  home screen with no one picked, a message is just a message. Right-click
  the conversation to hand it to a teammate.
- **Headings and bold render in replies.** `### Summary` and `**like this**`
  no longer arrive as punctuation. Links stay labels on purpose.
- **Settings tells the truth about limits.** Hand off, continue elsewhere,
  and the automatic fallback that is deliberately not built.
- **The route picker's search no longer floods.** One letter gave 92 rows;
  each runtime now shows twelve and says how many more match.
- Small windows: no stray scrollbar or clipped text in the collapsed sidebar.

## 0.21.5 — 2026-09-05

- **Your teammates work in a folder you choose.** Opened from the Start menu,
  Locust took its own install folder as the workspace, so every teammate was
  reading and editing inside `AppData\Local\Programs\Locust`. Antigravity
  refused outright and OpenCode auto-rejected its way out and failed. Now the
  install folder is never a workspace: Locust uses the folder you last chose,
  and until you choose one it refuses to start anything and says so. The
  folder lives in Settings, on a chip beside the permission mode, and in the
  title bar.
- **The permission menu no longer folds under the window.** It opens from a
  control at the bottom edge, and a stylesheet rule left behind by a deleted
  overflow menu had flipped it to open downward. Two pixels of a 305px menu
  were on screen.
- **A runtime's own words arrive readable.** Failure cards showed the terminal
  colour codes around them as little empty boxes.
- **Right-click a teammate** to message, edit, or remove them. Removing says
  how many routines go with them.
- **A refused delete says so.** The message only appeared inside the
  conversation you were looking at, so refusing a delete from the sidebar
  reported nothing anywhere and looked like the menu doing nothing.
- **Claude Code's refusals are reported.** When it is not permitted to run
  something it stops quietly; the run now says which tool was blocked.
- **First run rebuilt.** The mark sits in its own card, the runtimes are one
  panel in two columns rather than a stack, connected ones come first, and
  the count on the screen agrees with the count in the sidebar footer. The
  route and effort now read as a pair of boxed controls.
- **The sidebar's empty message no longer wraps to one word per line** on a
  narrow window.

## 0.21.4 — 2026-09-05

- **Delete in the mission header removes the whole conversation.** It removed
  only the turn whose id the header carried, leaving the rest of the thread
  you were looking at. The sidebar's Delete had the same bug and was fixed in
  0.21.0; this was the other half of it.
- **The header names the model, not just the runtime.** This app exists to
  put two models on the same work, and two missions from different models
  read identically once the composer had moved on.

## 0.21.3 — 2026-09-05

The welcome screen, as the design pass drew it.

- **One greeting, not two.** The wordmark already says the name in the
  largest type on screen, so the headline under it was a second voice saying
  less. It survives only where it is information: nothing here can run, and
  saying so is the screen's whole job.
- **The mark, not a box holding the mark.** A bordered card wrapped a logo
  that already sits in the sidebar 40 pixels away.
- **Two claim lines, not three.** Once something is signed in, the roster
  line says discovery ran and what it found, so the line repeating that in
  other words steps aside. It stays when nothing is ready, where it is the
  only account of what happened.

## 0.21.2 — 2026-09-05

- **The box you type in is on screen when the app opens.** On a 1280x860
  window the welcome screen's eight runtime rows pushed the composer below
  the fold, while the copy said "describe a mission in the box below" — the
  sentence was true and the layout made it a lie. The welcome now keeps to
  the space it has and scrolls inside it, so it can never push the composer
  anywhere. Measured: 16 pixels above the edge, where it used to be 395
  below.
- **The runtime list is a count you can open.** It reads "5 of 8 runtimes
  signed in under your own accounts", and opens to the full list. It starts
  open when nothing is ready, because then the list is the whole point of the
  screen, and closed when something can run, because then the point is to
  type a mission. The sentence every signed-in runtime repeated is said once,
  above the list, so each row is a name, a version and its state.

## 0.21.1 — 2026-09-05

The rest of the design pass's objections.

- **A queued message can be edited.** While one is waiting the box is
  disabled, so fixing a single word meant discarding the sentence and
  retyping it from memory. Edit lifts it back into the box.
- **Every held message says why it is held**, and the reason now sits under
  the message where a caption belongs rather than competing with it. The one
  state that described the button instead of the reason is gone, and cannot
  come back: a queue that is ready to send has already sent.
- **"Add a step" stays and says why** at a routine's twelve-step limit
  instead of disappearing, which read as a broken dialog. The Steps label
  carries the count, so the limit is visible before you meet it.
- **First launch is calmer.** Its READY tags are green rather than lime.
  Lime means happening right now, and nothing on a first launch is
  happening; five lime elements leave the quietest screen in the app.

## 0.21.0 — 2026-09-05

- **You can scroll a long conversation again.** The thread used a layout rule
  that pushes content out of the top of a scrolling box, and an overflowed
  top cannot be scrolled to — so past about a screenful, everything above the
  newest work was unreachable. It now uses spacing that collapses when there
  is no room to spare, so the scroll always starts at the first message.
- **Delete removes the whole conversation.** A sidebar row stands for every
  turn of one conversation, but Delete removed only its last turn, so the row
  stayed on screen and the menu read as doing nothing.
- **Plan is a permission mode, not a switch beside one.** It could only ever
  be on together with a read-only mode, so the composer was asking the same
  question twice in two shapes and the two could disagree. Plan now sits in
  the mode menu with the others and states its consequence there: answers
  with the steps it would take, and changes nothing. It is offered exactly
  where read-only containment is real, and withheld with the runtime's own
  reason where it is not. "Build this plan" is an ordinary mode switch now
  rather than a hidden state change.
- Each message on an exchange card can open the run it reached, so a
  teammate's reply is reachable from the conversation that asked rather than
  by scrolling the sidebar. Offered only where the record shows something
  received it.

## 0.20.1 — 2026-09-05

Three things Colin found in an evening of real use.

- **A teammate's briefing is no longer shown as your own message.** When one
  teammate answers another, the host writes that run a briefing — *"end with
  one <locust-share to="Wren"> block... do not use a <locust-ask> block
  here"* — and the thread was drawing that whole paragraph in the place your
  message goes, as the most prominent text on screen. It now shows the
  message that caused the turn, the way the mission list already did, and
  shows nothing at all when the record no longer holds it. The rule the
  thread was written with, and had been breaking: a run the host briefed is
  never drawn as a person's words.
- **The box empties the moment you send.** It was waiting for the host to
  answer first, so your words sat in the box beside the bubble for the whole
  "Starting…" second or two and read as lag. If a send genuinely never
  happens, the words come straight back.
- **A teammate who never writes back now says so.** Booty asked Wren a
  question; Wren answered in its own conversation without a reply block, so
  nothing came back and Booty's thread showed nothing — which reads as the
  message never arriving. A meeting has always said who stayed silent; a
  one-to-one exchange now does too, and says the answer is in that
  teammate's own conversation.
- **The message box says "Write a message", and nothing more.** Three of its
  lines used to restate the permission mode — "it may edit files in this
  workspace" — which the mode control says in two words directly underneath.
  Every other line it can show survives, because each says something no
  other part of the screen does: a runtime still being looked for, one that
  needs signing in, a route this build cannot run, and what happens to what
  you type while a mission is working.
- **The composer no longer gets clipped by the window edge.** It could give
  up height when the window was short, so its bottom row — route, effort,
  swarm — folded under the edge. It now keeps its height, and its controls
  wrap rather than running off the end when a model id is long.

## 0.20.0 — 2026-09-05

The two habits people bring from other agent tools, and miss first.

- **Say the next thing while a teammate is still working.** The box used to
  be dead during a run, so the only way to add an instruction was to stop
  the work. Now it stays usable: what you type waits, the screen shows it
  waiting, and it goes as the next turn the moment that run **completes**.
  If the run failed, was stopped, or never finished, it is held instead,
  with the reason and a Send now button — the next instruction assumes the
  last turn happened, and sending it into a turn that did not is how you
  end up building on work nobody did.
- **Plan first.** A control beside the mode: the run answers with the steps
  it would take, numbered, and changes nothing. The thread then says so in
  its own words and offers **Build this plan**, which starts the doing turn
  of the same conversation with edits allowed. Offered only in a mode whose
  sandbox already refuses writes, and the host checks that again rather
  than trusting the window — a plan that could edit your files is a promise
  the app cannot keep. Cursor Agent on Windows has no sandbox that can hold
  a run read-only, so plan first is not offered there, and the control says
  that rather than telling you to switch to a mode you cannot pick.
- **A turn that ends without a reply now says so.** Found by Colin watching a
  live test: a follow-up finished cleanly, spent tokens, recorded its
  reasoning and wrote nothing back. The thread showed the message, then
  blank space, under a header reading "completed" — which reads as the app
  losing the answer. It now says the runtime finished and wrote nothing,
  that nothing was changed, and that sending again usually works.

## 0.19.0 — 2026-09-05

- **Routines: teach a teammate a job once, then hand it back any time.**
  Right-click a finished conversation and choose *Save as routine*. The
  dialog arrives already filled in with what you typed on each turn, in
  order, so you are editing rather than writing. Press Run on the Team
  screen and the teammate replays it: step one starts, and each later step
  starts only when the one before it **completed**. A step that fails, is
  stopped, or is interrupted ends the routine there and says which step and
  why, rather than building the next step on work that never happened.
  - A routine belongs to a teammate and replays on the route it was learned
    on, so one saved read-only stays read-only.
  - Corrections are the point: edit the name or any step, and the next run
    uses the corrected version. Editing cannot move a routine to another
    teammate, change what it runs on, or lose where it came from.
  - Every replayed run is recorded as one, with the routine and the step
    number in the mission's own header, so a shared record never reads as
    though a person asked for it.
  - The sidebar says which step is running, read from the runs themselves,
    so the label cannot outlive the work.
  - **What this is not:** a teammate still cannot watch you work outside
    Locust. It has no view of your editor, browser or terminal. It can only
    learn from work it did with you, which every mission already records.
    That is the honest version of the feature, and it is most of the value.

## 0.18.3 — 2026-09-05

Found by using the app as a new person would, in a fresh profile, with the
screen at every step kept and read afterwards.

- **A runtime that just ran out of quota no longer says READY.** Two missions
  in a row failed on Codex's usage limit and Settings, the welcome list and
  every Codex row in the route picker still read READY — which means signed
  in, not able to run. Until a run on that runtime completes, those rows now
  say AT LIMIT and carry the runtime's own sentence, reset time included.
  The row stays pickable: the limit is your account's and lifts on the
  provider's clock.
- **One failure, said once.** A quota failure was drawn three times in a row:
  the limit card, the runtime's red error line, and the run's own failure
  card, each carrying the same sentence. The limit card is the one that
  names it; the other two stay out of its way. A slow-down warning never
  hides a real failure reason.
- **The idle teammate's sentence now matches the mode.** It said "Nothing is
  changed unless you pick a mode that allows it" above a composer whose
  default is Accept edits, so a fresh Research teammate promised read-only
  while the footer said it may edit the workspace. It now says what the
  current mode does.
- **A reply keeps its line breaks.** Asked for "every file, one per line",
  the teammate answered with one per line and the thread drew them on one
  line, which read as the teammate ignoring the request. Checked against the
  record: the newline was there; the screen dropped it.
- The Missions list says "checkpoints", not "ck". The teammates screen is
  titled Team, as its button already was. A model with one effort level no
  longer reports "1 effort levels".

## 0.18.2 — 2026-09-05

- **A teammate answering a teammate no longer asks a person who isn't there.**
  Since 0.17.0 a run that reaches a fork stops and asks you with a decision
  card. A relayed run — one teammate replying to another — still had that
  instruction in its prompt, and one in three test exchanges used it: the
  recipient (rightly) wanted context before acting on a message it could not
  verify, asked for it with a card, and the card sat in a thread nobody was
  watching. No reply went back, and the exchange ended in silence. The relayed
  brief now says there is no person in the exchange and that any question
  goes in the share block to the teammate who asked. Meetings get the same
  line.
- **When a teammate's reply arrives, the thread still shows what was sent.**
  A reply that comes back on its own opens the next turn of the thread that
  asked, and that turn was rebuilt without the message it had sent — so the
  thread showed the answer and not the question, and read as though the
  teammate had answered you. The person-typed follow-up had the same fix on
  2026-09-04; this is the other path.

## 0.18.1 — 2026-09-05

- **A read-only Copilot or OpenCode mission could silently have write access.**
  Both take the request as a command-line argument, reached through `cmd.exe`,
  and `cmd.exe` stops reading a command line at the first newline. Any
  multi-line request — every teammate briefing is one — dropped every flag
  after it: the JSON output the app reads, and the flag that made the run
  read-only. The run then ran in Copilot's human mode, exited 0, and the thread
  said it "ended without a terminal result record". Fixed by running what the
  npm shim wraps directly — `node` plus the script, or the native `.exe` —
  with no shell in between, which also removes the 8,191-character ceiling.
- **A request too long for a Windows command line is refused with the reason**,
  naming the limit, the actual length, and the runtimes that read from input
  instead — rather than failing with nothing on screen to explain it.
- **The record now says what was actually run.** Each mission's header carries
  the executable and flags, with the request itself replaced by a marker so it
  never rides along in a shared ledger. This is how the bug above was found.
- The waiting line's clock counts from the start of the turn instead of
  restarting on every event, so it climbs rather than looking like a loop.
- Launch failures report their real reason instead of "could not be started
  safely" for everything.

## 0.18.0 — 2026-09-05

- **A mission the app stopped in the middle of can be picked back up.** The
  ledger has written checkpoints since the beginning and the receipt has
  reported them; what never existed was the way to act on one, so an
  interrupted mission was a record you could read and nothing else. It now
  offers to resume from its last checkpoint, and the new run is told what had
  finished, what had not, and what to verify before building on it.
- **It says which of three things is true, rather than showing a button that
  might not work.** If every recorded action reported an outcome, it offers a
  plain resume. If something started and never reported back, it offers the
  resume *and names those actions*, so you can go and look before saying go.
  And if the ledger itself came back incomplete, it refuses and says why —
  continuing from a record the app cannot vouch for would build on work it
  cannot describe.
- **Closing the app mid-run is what this is for; pressing Stop is not.** A run
  you stopped on purpose is not offered a resume, because undoing your own
  decision is not the app's to suggest.
- A teammate's question can no longer be a yes/no. That is a permission
  request, and there is already a card for those.

## 0.17.0 — 2026-09-05

- **A teammate can ask you which way to go, instead of guessing.** When a run
  reaches a real fork — two defensible ways to do what you asked, where picking
  wrong means undoing work — it can stop and put the question to you as a card
  with the options as buttons, each labelled with what the runtime says it
  costs. Your answer starts the next turn.

  This is deliberately **not** the approval card. An approval asks *may I do
  this thing I am about to do*; the agent has already decided. This asks
  *which of these should I do*, before anything is done. Until now an agent at
  a fork had exactly one move — pick, and carry on — and you found out
  afterwards from a diff.

  No option is marked as recommended: the card exists because the model
  reached a decision it should not make alone, and quietly nominating a
  favourite would make it anyway. The card also says plainly that you can
  ignore the buttons and just reply.
- **The card never claims more than it knows.** The design's line was "paused,
  nothing changed" — but a run permitted to edit may well have changed files
  before it asked. So it says *nothing was changed* only when the mode made
  writing impossible; otherwise it says work is kept, or that the run could
  edit, and claims nothing.
- Every mission now tells its runtime how to ask, and — as importantly — when
  not to: not for anything it can settle by reading the workspace, and never
  as a way to ask permission to continue.

## 0.16.6 — 2026-09-04

- **A teammate's automatic reply is no longer named after machine
  instructions.** When one teammate writes to another, the host starts the
  recipient's run with a prompt the host wrote — *"Wren (Code & Migrations)
  sent you a message... end with one `<locust-share>` block"* — and that
  sentence was appearing as the NAME of a mission, beside conversations you
  actually started. It is now named by the message that caused it: *"Wren
  asked: Please reply with the passphrase."* If the workroom no longer holds
  that message the briefing still shows, because an invented title is worse
  than an ugly true one.
- **The ledger records who started a run.** Until now every mission in the file
  looked like something a person asked for, because every mission was. Nothing
  said otherwise when the app started one itself, so it could only present its
  own work as yours.
- A waiting line no longer says **Working** directly above an approval it is
  stopped on, while the header says *waiting on you*.

## 0.16.5 — 2026-09-04

- **You can see both halves of a conversation between two teammates.** Ask one
  of them to message another and the thread showed the reply and never the
  question -- so it read as though the second teammate had answered *you*. The
  message asking is written on an earlier turn than the answer, and the thread
  only ever drew the newest turn's. Every turn's now shows, filed against the
  turn it happened on.
- **A short exchange opens where it sits.** Two messages is something you read
  in place, not a toggle to find. Longer ones stay folded and now show their
  first line instead of only counting themselves.
- **Pressing send does something immediately.** The working line appeared only
  once the runtime reported its first step, so for a CLI that has to launch a
  process the thread sat blank for seconds and the bounce looked late. It was
  not late -- there was no line for it to be on. A live run always shows one
  now, and it says what is true: with no step reported it names the wait rather
  than inventing a step.
- **The `...` shows up where you are actually waiting.** It used to mean "a
  reasoning step is open", which most runtimes never report, so it almost never
  appeared. It now means waiting on the model with nothing to show yet.
- **The composer lets go of what you sent.** A start the host refused left your
  text on screen twice -- as a failed turn and still in the box -- which read as
  though nothing had been sent. If the bridge is missing the text stays, because
  then the box is the only copy of it.
- **The window remembers its size and position.** It also refuses to reopen onto
  a monitor that is no longer plugged in, which would put it where you cannot
  see or drag it.
- The app icon drops the black tile and keeps the ink.

## 0.16.4 — 2026-09-04

- **A new app icon.** The mark is a fine engraving, and downsampled to the
  sizes a taskbar actually uses it averaged to grey -- under 2% of the tile
  carried solid ink at 32px, so it stopped reading as a locust. The new one is
  the same artwork, thickened and zoomed so the wings reach the edges: 43% at
  32px, and the `.ico` now carries every size Windows picks from rather than
  making it scale one.
- **The window opens at a sensible size.** It was a flat 1480x940 — most of a
  laptop screen. It now takes a fraction of your display and caps there.
- The sidebar's second button reads **Team**.

## 0.16.3 — 2026-09-04

- **A short conversation sits on the composer** instead of hanging in mid-air
  above 70px of nothing. It grows upward out of the box you type in, the way
  every chat does.
- **The sidebar footer cannot bleed past the rail.** Its buttons are a grid
  that can shrink rather than a row laid out by content, and the connection
  count has its own line: `6 runtimes connected`, with a settled dot.
- **The window icon uses the 512, not the 256 beside it.** Windows scales from
  whatever it is handed, so it was downsampling a downsample.
- The visual pass from 2026-09-03 is applied throughout: code blocks, lists,
  link labels, the read-only rerun note, and the roster card.

## 0.16.2 — 2026-09-03

- **The routes you move between sit at the top of the picker.** Recency
  already ordered models within a runtime, which helps when you stay on one
  and does nothing for the move this app exists for -- putting two models on
  the same work. The other runtime's group sat below six rows of the one you
  were on, in a list showing less than half its height. A Recent group now
  carries the routes actually used, across runtimes. It appears only once
  there are two of them (a single recent is the route you are already on) and
  never lists a model its runtime has stopped offering.

## 0.16.1 — 2026-09-03

- **Opening Locust in a project shows that project's work.** It opened on the
  most recent mission anywhere, so starting it in a new folder greeted you with
  a conversation from a different one, and the sidebar listed that folder's
  missions too. The workroom now keeps to the folder it was launched in; the
  Missions screen is still the whole archive, which is what it is for.
- **Two runtimes were recording a random id for the folder they ran in.**
  Codex missions hashed the workspace path, so they could be matched back to a
  folder; the app-server and Antigravity paths minted a fresh id each time,
  which looks identical in a receipt and means the opposite. All three now use
  the same derivation, and the path itself never enters the ledger.

## 0.16.0 — 2026-09-03

- **The Teammates screen says what a teammate has been doing.** It could tell
  you a teammate existed, their route, and how many missions they owned --
  which answers "who is on my team" and not "what have they been up to". Each
  card now carries when they last ran, what their work has cost, and their
  newest missions, and clicking one opens it. A teammate who has never run
  reads `never`, `not reported`, `not set yet`, because a card that filled
  those with zeroes would be claiming things nobody measured.

## 0.15.8 — 2026-09-03

- **A retrying mission stops looking frozen.** Against a dead endpoint Codex
  retries five times across several minutes and reports each attempt. Every
  one of those notices arrives before the first tool runs, and the thread
  dropped everything that arrived that early -- so the mission sat reading
  "running" with an empty thread while the runtime was working. Setup chatter
  still stays hidden; trouble with the run itself no longer does.
- **A mission from another day says which day.** The marker read `started
  12:25 AM` with no date, which is unambiguous only until tomorrow.
- **A teammate's card shows the mode they actually ran in.** It printed
  `read-only` for everyone, whatever they had run in -- a fact the card never
  had, and simply false once a runtime could edit.

## 0.15.7 — 2026-09-03

- **Claude's activity rows say what they touched.** They read `Read done`,
  `Glob done`, `Write failed` -- the tool and nothing else, so the card could
  not tell you which file was read or written. A Claude tool's input arrives
  after the call opens, streamed as JSON, and nothing had picked it up from
  the finished block. Rows now read `src/format.js Read`, `src/cli.js Read`,
  `src/format.js Edit`.
- **The sidebar stopped pointing at a box that is not there.** Its empty state
  said "Describe one below" on the Teammates and Settings screens, which have
  no composer.

## 0.15.6 — 2026-09-03

- **Claude Code really can edit now.** 0.15.5 said it could and it could not:
  two places still forced read-only before the mode reached the process. The
  host coerced Claude's sandbox to `read-only` outright, and the Claude branch
  built its command without passing a sandbox at all. The receipt claimed
  `workspace-write` while the run was in plan mode and answered "I don't have
  a Write tool available in this session" -- the record and the process
  disagreeing, which is the one thing a receipt must never do. Verified from
  the ledger this time: a mission recorded `runtime: claude` and
  `sandbox: workspace-write`, and Claude created a new file.
  **0.15.5's note that this was "verified live" was wrong** -- the run used to
  verify it was Codex, not Claude. Corrected here rather than quietly.

## 0.15.5 — 2026-09-03

- **Claude Code can edit now, like it does in its own app.** It was launched
  `--permission-mode plan` with a three-tool reading list on every mission,
  whatever the composer asked, so it could only ever read. Accept edits now
  sends `--permission-mode acceptEdits` with the editing tools and Bash named,
  and a Claude mission can change files and run the tests it just changed.
  Read-only keeps exactly what it had. Both stay `--restricted`, so your own
  Claude settings never leak into a mission and the tool list is explicit
  either way.
  (0.15.4 had "fixed" the composer-says-one-thing-header-says-another problem
  by removing Accept edits from Claude Code. That was the wrong repair for the
  right complaint: the mode now decides the arguments.)
- **The sidebar footer stopped wrapping.** Adding the Missions and Teammates
  buttons squeezed the connection count until "6" sat above "connected".

## 0.15.4 — 2026-09-03

The rest of what using the app turned up. Notes in
`docs/USING-IT-2026-09-03.md`.

- **Asking a teammate to talk to another teammate now reaches them.** Asked to
  review some tests and ask a colleague whether they agreed, a teammate wrote
  the colleague's name into its reply and stopped -- and the colleague never
  ran. Nothing had told it that naming someone in prose does not reach them,
  and the briefing opened with wording that discouraged a hand-off exactly when
  you had just asked for one. Both are now said plainly.
- **Claude Code offers Ask only, because that is all it can do.** The composer
  said `Accept edits` while the mission header said `read-only` on the same
  screen: Claude Code is always launched restricted to reading. The composer
  now never shows a mode the chosen route cannot honour.
- **Lists and links render.** Bullets and numbered lists were collapsing into
  the sentence around them, and `[label](target)` showed its raw brackets with
  a full absolute path in the middle of a line.
- **Paths read the way you write them.** An activity row showed a long temp
  path with the filename cut off; inside the workspace it is now
  `src/streak.js`. Outside it the full path stays, because there the location
  is the information.

## 0.15.3 — 2026-09-03

Found by using the app on a real project rather than testing it. Notes in
`docs/USING-IT-2026-09-03.md`.

- **A Claude Code answer no longer appears twice.** Claude streams its reply
  and then sends the finished message to replace what streamed; the replace
  targeted a fixed block while the text had arrived in a different one, so the
  whole answer rendered a second time underneath itself.
- **Shell rows show the command, not the thing that ran it.** Every command was
  displayed as `"C:\Windows\...\powershell.exe" -Command "..."`, and since a
  row is one line wide, all you could read was the same truncated path. They
  now read `npm test`, `node --test`, `git status --short`.
- **A Codex edit lists one row per file again**, instead of one row with every
  path run together saying the change was not reported.
- **The first screen stops asking for something already done.** It said
  "Connect a runtime to start working" above six runtimes marked READY; when
  something can run it now says so and points at the composer.

## 0.15.2 — 2026-09-03

- **Fixes a Codex regression 0.15.1 introduced.** Making PATH win meant
  reaching npm's `codex.ps1`, and that shim cannot take Codex's own arguments
  -- the bare `-` that sends the prompt on stdin makes PowerShell reject the
  whole call -- so every Codex mission failed for anyone whose Codex came from
  npm. Windows itself runs the `.cmd`, and now so does Locust. **If you are on
  0.15.1 and Codex stopped working, this is why; install this one.**
- **Replies render as written.** Fenced code blocks are code blocks and
  `inline code` is inline code, instead of one flat paragraph with the
  backticks still in it. This mattered most exactly where it was worst: a
  read-only run cannot edit the workspace, so it pastes the patch into its
  answer, and a diff with every newline collapsed is the one reply nobody can
  read. Long lines scroll inside the block rather than stretching the thread.
- **A new teammate starts on Accept edits.** Under Ask, "add a discount
  function" was refused by the sandbox and the model pasted its patch into the
  reply instead, with nothing saying the mode was why. Ask is still one click
  away, and a teammate you have run keeps whatever they last ran on.
- **A read-only run that answers with code offers to run again with edits
  allowed** -- one click, instead of changing the mode and retyping. It
  appears only when the reply actually carries code, and it is an offer, not
  an error: the run did exactly what its mode permits.

## 0.15.1 — 2026-09-03

- **Locust now runs the runtime you installed, not an older copy it found
  somewhere else.** It searched every likely install directory for a `.exe`
  before it looked on PATH for a shim -- and a tool installed from npm lands
  as a `.cmd` and a `.ps1`, never a `.exe`. So a runtime you installed or
  updated could be ignored in favour of an older copy sitting somewhere the
  app had guessed, with nothing on screen to say which one was running. What a
  terminal would run now genuinely wins.

## 0.15.0 — 2026-09-03

- **Updates now actually install.** "Install and restart" quit the app and
  brought it back on the same version; the update it had downloaded was never
  applied. If your copy has been stuck on an old version with "ready to
  install" in Settings, this release fixes that. It cannot fix itself from
  inside the stuck copy, so this one time: quit Locust, and run the installer
  from the download page, or the one waiting in your updater folder.
- **Codex edits name their files.** A change Codex made showed a row with no
  path and "did not report the change"; a two-file change said "Edited 1
  file". Every changed file is now its own row, and the count is files.
- **The window is titled by your folder**, not "Local workspace".
- **Missions and Teammates are one click away** in the sidebar footer, with
  their shortcuts in the tooltips.
- **A failure now says what the runtime said.** Every failure card showed the
  app's own sentence -- "Codex invocation did not complete successfully" --
  and threw away the runtime's explanation, which the ledger had been
  recording all along. Two runs lost this way turned out to be a folder Codex
  refused to work in and a Cursor account out of capacity; on screen both read
  as the same shrug. The runtime's own last word is now on the card, and
  capacity exhaustion is said in English instead of as `resource_exhausted`.
- **Codex missions work in a folder that is not a git repository.** Codex CLI
  refuses to start outside a repo unless asked not to check, so a mission in a
  plain folder died in half a second before the model was ever reached. Locust
  decides what a run may touch itself -- read-only or accept-edits, an approval
  gate, and a recorded diff of every write -- so it now asks Codex to skip that
  check.
- **A reply after a failed run stays in the same conversation.** Being the next
  turn and resuming a runtime's session are different things, and the second
  was gating the first: replying to a run that failed before its runtime
  started opened a second sidebar row and dropped the turn above it from the
  screen. The conversation now continues either way, and when the runtime has
  no session to resume the thread says the model started without the earlier
  messages rather than letting you assume it remembers.

## 0.14.0 — 2026-09-03

- **What a run cost.** The receipt, the inspector and a new column on Missions
  say what each run cost in the runtime's own unit: dollars for Claude Code,
  premium requests for Copilot, tokens in and out for the rest, with a total
  across priced runs. A runtime that reports nothing is shown as exactly that,
  never as free.
- **Approvals find you.** If a teammate needs an approval while Locust is
  behind another window, you get a notification naming the teammate and the
  action; clicking it brings Locust forward. Nothing else notifies.
- **Custom roles mean something.** Pick Custom and say what the teammate does.
  Those words show beside their name and are what their runtime is told.

## 0.13.0 — 2026-09-03

- **Antigravity, as an experimental route.** If Google's Antigravity is open
  with your folder, Locust can hand its agent a mission on the Flash, Pro or
  Flash Lite tier, watch the work land in the thread (tool calls, the final
  answer), keep the receipt, and continue the conversation on a reply. It is
  tagged EXPERIMENTAL in the picker because it drives an interface Antigravity
  never published; it may break with an Antigravity update. Two limits are
  built in and said out loud: it only works while Antigravity is open with
  that folder, and it cannot be held read-only, so only Accept edits is
  offered. Stopping a mission stops the watch; Antigravity's agent may keep
  going inside Antigravity.

## 0.12.0 — 2026-09-03

- **Two new routes.** OpenCode, which ships free models that need no sign-in
  at all (Muse Spark, Nemotron, and more), so a fresh install can run a
  mission for nothing the minute it opens; and GitHub Copilot CLI, for anyone
  on a Copilot plan that includes the CLI, offered as Auto so Copilot picks
  the model your plan allows. Both keep the same guarantees as the other
  routes: read-only really is read-only (OpenCode is held by its own
  permission config, Copilot by denying its write and shell tools), a reply
  resumes the same session, and every run is recorded like any other.
- **Meetings.** Write to two or more teammates at once and each gets their
  own run, but your teammate's next turn waits until all of them have
  answered or finished, then starts once with every reply quoted. The thread
  says who it is waiting on and who left without a word.
- Each teammate row now says which runtime and model they are. The roster
  draws the same faces as the sidebar. A banner above the composer says when
  a new version is downloaded and offers the restart.
- The route search folds hyphens and dots, so "muse spark" finds
  `muse-spark-1.3` and "gpt 5" finds `gpt-5.6`.

## 0.11.0 — 2026-09-03

- **Faces that say what a teammate is doing.** Eight states, each with its own
  motion: up thinks, down works, forward talks to you, sideways listens.
  Thinking tilts and looks up with the dots beside it; working bobs with
  weight and looks down; replying looks at you and talks; waiting on you holds
  a stare inside a slow amber ring; a message arriving earns a glance; a
  finished mission earns one hop. Idle and blocked are the only still faces,
  and blocked shuts its eyes behind a red border so it never reads as idle.
- **One teammate, one state, everywhere.** The sidebar row, the workroom
  header and the working line in the thread now resolve the same teammate to
  the same state at the same moment, and the word beside the face is that
  state's word: "thinking", "working", "replying", "waiting on you".
- Reduced motion turns every animation off; state still reads from the text
  and the presence dot.

## 0.10.2 — 2026-09-03

- **Each teammate stays the model you made them.** The route you last started
  a teammate on (runtime, model, mode) is now theirs. When they reply to
  another teammate on their own, they reply on that route, never on whoever
  wrote to them, so Grok argues as Grok and Claude answers as Claude. Picking
  a teammate in the sidebar now also sets the composer to their route.
- A teammate who has never run borrows the sender's route once, and the thread
  says so, with the fix: message them once on the route they should keep.
- Seen live: asked by a Cursor teammate to parrot a passphrase, a Claude
  teammate declined and said why, because teammate messages are delivered as
  claims, not orders. That is the point, and it survives across models.

## 0.10.1 — 2026-09-03

- **Teammates reply to each other by default**, and for as long as the work
  needs. Colin's call, and the right one: talking to each other is the point
  of having more than one teammate. An exchange now ends when a reply has
  nothing more to say, rather than after a fixed two hops; six automatic runs
  is the backstop. Each hop continues that teammate's own conversation, so
  both sides read as one thread. Settings → Teammates now only turns it off.

## 0.10.0 — 2026-09-03

- **Teammates can reply to each other.** Turn it on under Settings → Teammates.
  When one teammate writes to another, Locust starts a run for the recipient
  with the message as its brief, and their answer starts the sender's next
  turn, so it lands in the thread that asked. If that thread is on screen, the
  view follows it to the new turn. Two hops, then it stops and waits for you.
- Each hop is a real run on a real account, so it is capped at two. Each
  hop runs on the sender's runtime, model and mode, is owned by the teammate
  who replied, and is recorded like any other mission. When a reply could not
  start, the thread that shared says why.
- **Auto-update is live.** Installed copies now find new versions on their
  own and install them when you quit. No more installers by hand.

## 0.9.1 — 2026-09-03

- **One conversation, one sidebar row.** Every reply used to appear in the
  sidebar as its own entry, even though the thread showed the exchange as one.
  The sidebar now lists a conversation once, named for what you typed to start
  it, with a small count of how many turns it holds. Clicking it opens the
  newest turn. Nothing changed underneath: each turn is still its own recorded
  run with its own receipt.
- Tool rows in the activity card say what the tool was (`read`, `glob`), so a
  file the teammate read and then edited no longer appears as the same path
  twice with nothing to tell the rows apart.

## 0.9.0 — 2026-09-02

- **See the actual diff.** The activity card used to say a teammate edited a
  file and stop there. Open it now and every changed file is listed with its
  status and `+N −M`; click one and the change itself unfolds inline, line
  numbers, hunk headers, and the exact span that changed on each line.
  Unchanged runs collapse behind a button that names how many lines it hides,
  and an open file always ends by saying whether you have seen all of it.
- Every number on that card is counted from the lines shown, so the total,
  each file, and each hunk header agree. If a change was too large to record
  in full, the footer says so and gives the runtime's own total rather than
  quietly showing less.
- Commands sit in the same list as files, with their exit code, so what a
  teammate did reads top to bottom in the order it happened.
- **Colour means one thing again.** Lime is now only "happening right now".
  Done plan steps, standing permissions, and reachable-but-idle routes moved
  to green, so a glance at the window tells you what is live.
- Cards that need a decision are raised toward you; cards about something
  that already happened sit recessed. Screen titles and the two empty states
  carry real display size.

## 0.8.0 — 2026-09-02

- **Right-click a mission** in the sidebar for Open, Copy mission id, and
  Delete. Delete still asks before it acts, and refuses while the mission is
  running.
- **Search actually searches.** The sidebar's search field had never been
  wired to anything. It now matches a mission's title or its id, so an id
  copied from a receipt finds its mission.
- Deleting a mission from anywhere now updates the Settings storage line
  instead of leaving the number it read at launch.

## 0.7.2 — 2026-09-02

- **Fixed: replying to a teammate started a new mission instead of
  continuing.** On Windows, Cursor cannot be held read-only — its sandbox
  needs macOS or Linux — so every Cursor mission in "Ask" was refused before
  it ran, and a run that never started leaves nothing to continue. Cursor on
  Windows now offers "Accept edits" only, and the menu says why.

## 0.7.0 — 2026-09-02

- **The model list is readable.** Cursor lists every effort of every model
  separately, 217 entries on a real account. They are now one row per model,
  with the efforts in the effort control where they belong.
- **Better order.** Models you have actually run come first, then a shortlist
  of flagship families, then the rest. Nothing is hidden.
- **"Approve each action" is no longer offered where it cannot run.** It works
  on Codex CLI only; picking it with another route used to refuse every
  message you sent.
- The Missions screen's "Running" filter now matches running missions, and its
  rows are titled with what you typed rather than a machine-written briefing.

## 0.6.0 — 2026-09-02

- **Updates.** Locust checks for a new version shortly after launch and
  downloads it quietly. It never installs on its own, and it will not install
  while a mission is running. Settings has a Check now button.

## 0.5.0 — 2026-09-02

- Cursor missions can no longer claim to be read-only when nothing enforces
  it, and the ledger no longer records a failed command as a successful one.
- Discovery no longer re-runs a full probe sweep on every mission start.
- A mission whose options cannot be turned into a command records nothing at
  all, instead of leaving a permanent file for a run that never happened.

## 0.4.1 — 2026-09-02

- **Fixed: replies on Codex never worked.** `codex exec resume` rejects two
  of the arguments Locust was passing, so every Codex follow-up failed. Both
  turns now share one session, verified on a real run.
- A run that failed before it started no longer says "Starting…" forever, and
  the next thing you type starts a fresh mission rather than an error.

## 0.4.0 — 2026-09-02

- **Retention.** Settings shows what your history costs and offers to delete
  finished missions older than 30 days, 90 days or a year. Nothing is ever
  deleted on a timer; the first press only previews, and a mission an ongoing
  conversation continues from is kept even when it is old.
- The route picker no longer lets one runtime's long model list bury the
  others.

## 0.3.0 — 2026-09-02

- **Cursor Agent is a third runtime**, with its own models read from its own
  CLI. Missions run, stream, and resume on it.
- Gemini CLI is found but cannot run: Google stopped serving it to consumer
  accounts in June 2026. Gemini models are reachable through Cursor.

## 0.2.0 — 2026-09-01

- **Delete a mission** for good from the workroom header.
- Settings shows which build you are on.

## 0.1.0 — 2026-09-01

First installable build: Codex CLI and Claude Code as selectable runtimes,
teammates, missions recorded to a durable local ledger, handoffs between
runtimes, and a workroom where teammates pass findings to each other.
