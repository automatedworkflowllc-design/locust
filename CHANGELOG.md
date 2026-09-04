# Changelog

What changed in each build, written for someone using Locust rather than
reading its source. The commit history carries the engineering detail; this
carries what you would notice.

Dates are when the build was cut. Versions are the number Settings shows.

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
