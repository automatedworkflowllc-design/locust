# Changelog

What changed in each build, written for someone using Locust rather than
reading its source. The commit history carries the engineering detail; this
carries what you would notice.

Dates are when the build was cut. Versions are the number Settings shows.

## 0.220.0 - 2026-09-20

- **The orbs are back to one size.** 0.218 drew one of them larger, on the
  wrong row -- and larger turned out to be the wrong idea anyway: these are
  drawings made for their size, so scaling one softens every stroke, which on
  a mark this small reads as broken rather than as big.
- **The plan's step has its rubik sphere back.** It lost it when that shape
  went to every open tool, because the plan and the live line share a screen
  and two identical spheres a few pixels apart read as a glitch. The shape
  belongs to connectors now, which are rare and brief, so the plan can have
  it again.

## 0.219.0 - 2026-09-20

- **A connector call is recognised as one, whatever the runtime calls it.**
  Every MCP name Locust had ever seen carried its server, so a runtime that
  names the tool flatly `mcp` had its connector calls filed as ordinary local
  tools: no connector row, and nothing saying the work had left your machine.
  They are connector calls now. When the name carries no server, the line says
  "using a connector" without naming one, because it does not know.
- **MCP and connectors have their own animation.** The scrambling sphere is
  theirs; ordinary tools and shell commands take the one it used to share with
  them. The rarer event gets the louder mark -- a tool call already has its
  name on the row beside it, and a call leaving your machine is the one worth
  spotting without reading.

## 0.218.0 - 2026-09-20

- **The sweep on the live line is wide enough to see.** It shipped in 0.217
  and read as nothing: the bright band covered a fifth of its travel, so on a
  seven-letter word it was a couple of characters passing in a blink. It is
  twice as wide now and peaks a step brighter — still only lightness moving,
  never a colour of its own. What it is for: the word beside the orb is live,
  not text that got stuck there.
- **The thinking orb is drawn a size up.** It is a wave through latitude
  rings rather than a solid ball, so it used less of its box than the denser
  shapes on the other rows and read smaller at the same size. The line does
  not move when it changes.

## 0.217.0 - 2026-09-20

- **A finished run no longer says things are still running.** A turn that had
  ended could still show rows reading "running" and "still running" — while
  the summary line above them already counted them correctly as "did not
  report". The rows say that now too, in amber: a tool that never reported
  back is not a tool that failed.
- **The live line has a sweep.** A band of lighter ink travels along the word
  for whatever is happening, and along the name of a tool while it is open —
  the thing Claude Code does to its active line.
- **All nine orbs are in use, and the ones you see most are the fullest.**
  Working, thinking and open tools carry the three roundest; reading and web
  search share the globe; a connector and a sub-agent are now told apart;
  writing and the plan's step take the rest.

## 0.216.0 - 2026-09-20

- **Older conversations stop dropping out of their groups.** A conversation
  that began far enough back could appear under a different name and outside
  the group you filed it in — because the sidebar only ever saw the twenty
  most recent turns, and a conversation whose first turn fell outside that
  window was identified by a later turn instead. Its name, and which group it
  is in, both hang off that first turn. Nothing was ever moved, renamed or
  lost; the app was looking under the wrong name.
- **The orbs are spherical where you look most.** The plan's step underway
  has its own orb rather than borrowing the live line's, and the busiest rows
  carry the fuller shapes.

## 0.215.0 - 2026-09-20

- **The send button's halo leaves with your cursor.** It used to stay lit
  after you moved away — still, but still glowing — because stopping the
  effect froze it on the frame it happened to be on, and that frame was the
  bright one. At rest the button is a plain metal ring again; the glow is the
  part that answers you.

## 0.214.0 - 2026-09-20

- **A teammate's message never shows you the plumbing.** Locust reads a few
  tagged blocks out of what a teammate writes — send this to Wren, remember
  this, ask Colin. When one was written slightly wrong, it was both ignored
  AND printed: the reply arrived with `<locust-share>` around it. Now the
  tags come off whatever is still wearing them and the words stay, so a
  message that went nowhere is at least something you can read and pass on
  yourself.

## 0.213.0 - 2026-09-20

- **The cursor actually bends the send button's ring now.** The setting was
  there and did nothing: the numbers were written where the library keeps
  them, but the part that reads them every frame was never switched on. Move
  the pointer across the ring and it dents toward you and springs back.
- **The glow lets go.** Press send with the cursor still on the button and
  the button disables under your pointer — which means it never hears the
  pointer leave, so the metal kept moving over an empty composer. It stops
  now, and it stops for the other ways a cursor can leave without saying so:
  a window losing focus, a pointer leaving the window.
- **Silver at standard is the default metal.** Every option is still in
  Settings; this is just where it starts.
- **The orb on a working conversation is smaller**, so the row still reads as
  a teammate's name first.

## 0.212.0 - 2026-09-20

- **Settings now has every option for the send button's metal.** Which metal
  (off, chromatic, silver, gold), how strong, whether it moves only on hover
  or all the time, and whether the cursor bends the ring as it crosses. Off
  means no shader at all rather than a paused one.
- **The orb sits beside the word it is about.** It was before the teammate's
  name, which read as a property of the teammate — it is a property of what
  they are doing.
- **A running conversation in the sidebar shows an orb instead of a dot**,
  and goes back to a quiet dot when it finishes.
- **The plan's step underway carries the same orb** the line below it does,
  instead of its own pulsing pip.
- **Teammates' faces move again while they work.** They were stilled when the
  orb arrived, on the grounds that two moving things say one thing twice —
  but the face says *this teammate is alive* and the orb says *what kind of
  work*, which are different claims.

## 0.211.0 - 2026-09-20

- **A picture a teammate made opens as a picture.** Charts, diagrams and
  screenshots used to be refused by the file panel with "Locust does not open
  that kind of file here" — about a file your teammate had just made for you.
  PNG, JPEG, GIF, WebP, BMP, AVIF and ICO now draw in the panel. SVG
  deliberately still opens as code: an SVG is a document that can carry
  script, and Locust does not run what a teammate wrote.
- **The send button turns to metal while you are on it.** Only that button,
  only on hover or keyboard focus, and it goes quiet the moment you leave —
  in this app a thing that moves means work is happening, and an invitation
  is not work.

## 0.210.0 - 2026-09-20

- **The orb changes at every word the line changes to.** Starting, thinking,
  working, writing and a connector call each have their own now, instead of
  four of them sharing two. A run you watch actually moves through them.
- **Fixed: the orb said "thinking" while the line said "using a tool".** On
  Codex and Claude Code, which report a step as well as its tools, a step that
  named a tool showed the waiting orb beside it. Seen only by running a real
  turn on each.

## 0.209.0 - 2026-09-20

- **The orb is there for the whole wait now, and it changes when the work
  does.** It used to appear only while a tool was actually open, which meant
  it never appeared at all on runtimes that report their tools once they
  finish — and on every runtime, the long wait before the first tool showed
  nothing. A run that has not answered yet shows a slow ring; once it is
  working the ring becomes moving particles; reading, running a command,
  waiting on a subagent and planning each keep their own. The three dots
  retire wherever an orb appears, so "still going" is said once.

## 0.208.0 - 2026-09-20

- **The running step shows what kind of work is happening, as a small moving
  orb.** Reading a file, running a command and waiting on a subagent each get
  their own; a Plan-mode turn gets the planning one. It is tied to the work
  rather than cycling through shapes, so it can never say "reading" while the
  line beside it says a command is running. Where none of them is true — while
  a file is being written, or while the teammate is just waiting on the model —
  there is no orb and the line keeps its three dots. The teammate's face sits
  still while an orb is moving, so the row says "still going" once instead of
  twice.

## 0.207.0 - 2026-09-20

- **All six coding agents fit on the first screen now, in two columns.** With
  six installed, the list drew five and left a scrollbar whose whole job was
  to reveal the sixth. A machine with nothing installed still sees the one
  row it saw before.
- **A file in the panel is sized to be read.** The panel's width was a
  percentage taken off one screenshot, which meant a different line length at
  every window size. It is now set by counting the characters the column
  actually renders, and stops growing once a line is long enough to read
  comfortably -- past that the panel would only be taking room from the
  conversation.
- **The panel says why it will not open a file.** "Locust does not open files
  -- a teammate chose this file's name and contents. Reveal hands it to
  Windows." A missing button reads as an oversight; this is a decision, and
  now it says so.

## 0.206.0 - 2026-09-20

- **An open file says which turns changed it, and you can look at each one.**
  A strip under the file's name counts the turns of this conversation that
  touched it -- "changed in 2 turns" -- with a numbered button for each and
  "Now" for the file as it stands. Pressing a number shows what that turn
  changed, with the ask that caused it on the button's tooltip. It says
  *changed in*, never *as it looked*: the record is a list of changes, some of
  them cut short by the runtime that reported them, so Locust will show you
  the changes rather than rebuild a document it cannot vouch for.

## 0.205.0 - 2026-09-20

- **The conversation keeps its room when a file is open on a smaller window.**
  In a 1120-wide window the open file panel was squeezing the conversation
  into a column half the panel's width -- replies breaking after three words,
  "Write a message..." on two lines, the model's name cut off. The panel now
  floats over the workroom the way the activity drawer already did, so the
  conversation beside it keeps three times the width it had.

## 0.204.0 - 2026-09-20

- **Any file a teammate touched opens beside the conversation, not just one
  they handed you.** The activity fold lists every file a turn wrote or
  changed, and each row now has a button that opens it in the same panel. The
  diff above it tells you what changed; this tells you what the file says,
  which for a report or a brief is the whole question. As everywhere else in
  Locust, it renders the file itself and never asks Windows to open it.

## 0.203.0 - 2026-09-20

- **Click a file a teammate handed you and it opens beside the conversation.**
  Markdown is rendered the way a reply is; anything else is shown as code. The
  panel has its own buttons to show the file in your file manager or save a
  copy. It never hands the file to Windows to open -- Locust draws it.

- **The plan card has its border back, and its finished steps are filled in.**
  It was drawn without either, which was never what the design called for.

## 0.202.0 - 2026-09-20

- **Check again re-asks everything, including npm.** Whether npm is on your
  machine was decided once per session, so if yours was slow or hung the
  first screen said so and nothing could change its mind until you pressed
  Install. The button that exists to ask again now asks again properly.

- **A failed check no longer stops Locust checking.** If the app could not
  read the machine once, it gave up asking for the rest of the session and
  the screen quietly kept whatever it had.

## 0.201.0 - 2026-09-20

- **A file a teammate hands you has a save button.** The little download icon
  other clients have, for when you want the file somewhere else. It opens the
  ordinary Save dialog and copies it wherever you pick.

- **The note on a handed file is readable when it does not fit.** It shortens
  to fit the row, and the whole of it is in the tooltip now rather than lost.

- **And the card says so when the file is not there.** A teammate can name a
  file it never actually wrote. Pressing it used to do nothing at all, which
  looked exactly like it having worked.

- **The message box counts.** With five coding agents installed and none of
  them answering, it said "A coding agent is installed but not answering" --
  singular, over five rows that each said so.

- **"On this machine" means on this machine.** The count above the agent list
  was counting every agent Locust can drive, including ones you have not
  installed.

## 0.200.0 - 2026-09-20

- **A coding agent that is on your machine is always shown.** Yesterday's
  first screen tidied the list down to one step, and it tidied away installed
  agents too -- so a Codex that was installed and not answering hid behind
  "they each need their own account", which was untrue of it, along with the
  Check again that would have fixed it.

- **"npm did not answer" no longer reads as "Node.js is not installed".** On a
  machine where Node is present and npm hangs, the screen said Node was
  missing. It now says what actually happened. The install works either way.

- **Nothing is left running when you quit during a check.** A coding agent
  probe started in the last moment before Locust closed could outlive it.

- **The install line says what it is doing** while it works out which npm to
  use, instead of claiming npm is starting.

## 0.199.0 - 2026-09-19

- **The reply is back to its old size, and the size is now yours.** 0.198.0
  set it larger on my reading of a measurement, and on a real screen it was
  far too big. It is back to what it was, and **Settings → Appearance → Reply
  text size** offers Standard, Large and Largest if you want it bigger.

- **The line length keeps the fix.** The thing actually worth correcting in
  0.198.0 was that a reply could run 111 characters to a line, well past the
  point where your eye loses its place coming back. Lines are about 74
  characters now, at whichever size you pick.

## 0.198.0 - 2026-09-19

- **A teammate's reply is set bigger, and its lines are shorter.** The reply
  was the smallest thing on screen that you actually read rather than scan,
  and its lines ran to 111 characters -- past the point where the eye loses
  its place coming back to the left. It is now 18px with a shorter line.

- **Emphasis in a reply is real.** The reply's typeface ships no italic, so
  every emphasised word was a slant the browser invented by shearing the
  upright letters. Emphasis is now carried by weight, which the typeface
  really has.

- **Locust tells you when it made a folder for you.** Opening Locust from the
  Start menu gives it nowhere to work, so it makes a folder in Documents
  and works there. It used to say so only if you hovered over the folder
  button. It says so on the first screen now, with the button to point it at
  your own project.

- **The first screen shows one step instead of six.** With nothing installed
  yet, it offers the one coding agent that needs no account, and the other
  five are one line away when you want them. The explanation about Node.js
  waits until you have actually started an install.

## 0.197.0 - 2026-09-19

- **A run that has not answered yet says Starting, not Working.** The moment
  Locust had launched a coding agent, the line under your message said the
  teammate was working -- on the strength of a process having been spawned,
  before the agent had said a word. One measured run showed "working" for over
  two minutes of complete silence. It says Starting until the agent actually
  reports something, which is also when the clock stops being a guess.

## 0.196.0 - 2026-09-19

- **A conversation you started without picking anyone can be saved as a
  routine.** The menu item was there and greyed out, and the reason it gave --
  "nothing here was typed by you" -- was not true: you had typed every word of
  it. What was actually missing is whose turn it replays on, so the dialog now
  asks that once and saves it like any other.

- **The model picker reads as names.** A model whose program reports no name
  for it was listed by its identifier, so one row read
  `muse-spark-1.3-contributor-free` in a list where everything else read as a
  proper name -- and the chip under the message box, an inch away, spelled the
  same model out properly. They match now. A name a program does give is
  printed exactly as it wrote it.

## 0.195.0 - 2026-09-19

- **A teammate can hand you a file.** Ask for one -- "send me an md of your
  report" -- and the file arrives in the conversation as a button under the
  reply, with its name and a line saying what it is. Pressing it shows the
  file in your file manager. Until now you could send files to a teammate
  but they could only tell you where they had put theirs.

- **A teammate stops messaging the others just to keep them posted.** Telling
  a teammate something starts a whole run on their side, and the rule they
  were given -- pass it on if they need to know it -- read as an invitation to
  share anything interesting. They now message a teammate when you asked them
  to, or when the turn made work that is genuinely theirs to do.

## 0.194.0 - 2026-09-19

- **A bullet that wraps stays one bullet.** When a list item's sentence ran
  past one line, everything after the first line was drawn as a separate
  paragraph below the bullet, at the left margin. It showed up wherever a
  list is read: in what a teammate writes back, and in this changelog, which
  is how it was spotted.

## 0.193.0 - 2026-09-19

- **The decision card says one thing once.** When a teammate stops and asks
  you to choose, the card told you twice that you could answer in your own
  words instead — once between the question and the buttons, and again under
  them. It says it once now, under the options, where it reads: here are the
  choices, and you are not bound by them.

## 0.192.0 - 2026-09-19

- **A to-do list looks like a to-do list again.** When a teammate kept a list
  while working and then answered without changing any files, the list was
  drawn as though the plan itself were the answer: a bare numbered line, in
  reading size, with no heading, sitting in the middle of the conversation
  where it read as a glitch. That treatment belongs to Plan mode, where the
  plan *is* what you asked for. Everywhere else the list is headed *PLAN ·
  n of m done* with a mark against each step, which is what it was before.

## 0.191.0 - 2026-09-19

- **A message sent without picking a teammate knows the project.** The home
  screen invites one: write below and assign it to someone later. That run
  used to be told nothing at all, because everything Locust briefs a run
  with hung on there being a teammate. It did not know which folder it was
  standing in, it never read the folder's `LOCUST.md`, and it could not
  answer a question about something you had typed on the Memory screen that
  morning: *"I don't have a secret word for this project in my
  instructions."* It now gets the folder and the project's memory, which
  belong to the project rather than to any teammate. What it still does not
  get is what needs a teammate to exist: a role, the roster, and the ability
  to hand work to someone else.

## 0.190.0 - 2026-09-19

The other half of the three tester reports, from Fable's reading of the code.

- **Nothing left running when you quit mid-check.** Closing Locust while it
  was still asking a hung CLI for its version left that CLI and its child
  behind (ten processes on Linux). Every check still out is ended when the
  app leaves.
- **A hung npm no longer holds the first screen.** One `npm` on PATH that
  never answers kept the screen at *checking the runtimes on this machine*
  for ever, with no rows and no Install. npm gets five seconds; if it does
  not answer, Locust uses the copy it carries.
- **Check again means four checks.** The rows said NOT ANSWERING after two
  real sweeps while the tooltip promised four, and kept checking every
  fifteen seconds after giving up. Sweeps are counted now, Check again
  starts the count over, and nothing is asked again after the fourth until
  you press it.
- **The "what changed" banner keeps its promise.** It is held until a
  runtime connects. It used to mark the version as seen the moment the
  changelog was read, so if nothing was connected at launch you never saw
  it, on that launch or the next. It is marked seen when it is on screen.
- **Installing with a non-ASCII Windows user name.** The small `node` stand-in
  the app writes for an install is read by Windows in the console's own
  code page; a name like José or 张伟 in the path broke it. It switches the
  console to UTF-8 first.

## 0.189.0 - 2026-09-19

Three tester reports landed at once (Grok's passes 13 and 14, Fable's
first). This build is the small half of what they found; the rest is in
`docs/PLAN-2026-09-19-TESTERS.md`.

- **A room's file agrees with its screen.** After everyone in a room had
  answered, the room file still listed the last teammate as waiting. The
  screen was right, the file was wrong, and anything reading the file would
  have started them again. Fixed at the write, with a test on the bytes.
- **No red card after hung CLIs give up.** Five rows already said NOT
  ANSWERING with Check again beside each; a card above the message box said
  to install one. The card now appears only when a runtime wants a sign-in,
  and the message box under not-answering rows says *installed but not
  answering — Check again above* instead of *install*.
- **Save as routine on a follow-up.** A conversation started with nobody
  picked and assigned afterwards could not be saved as a routine from a
  later turn: the menu said nothing had been typed. The owner is found along
  the conversation now.
- **"Plan mode — nothing was changed" only in Plan mode.** It was drawn under
  any reply that answered a question without touching a file, including in
  Accept edits.
- **The rail's flyout closes when you leave it.** Pinning a teammate on the
  narrow sidebar and then opening a room left their card floating over the
  room's answers.
- **The first words no longer blink out.** On a cold start the bold
  *OpenCode needs no account* could be blank for a moment while its weight
  loaded; the fallback face shows instead.
- **Two sentences made true.** The install line under the list now shows the
  command that actually runs with the app's own npm, and a memory file that
  fails to write is now logged, as 0.184.0 said it would be.

## 0.188.0 - 2026-09-19

- **The inspector stays with its conversation.** It used to stay open across
  All missions, Settings and Team, where it inspected nothing on screen and
  squeezed those screens until, at 1120 wide, the mission rows and the
  Settings pane grew sideways scrollbars. It now shows only beside the
  conversation, and comes back when you return to it.
- **Mission rows in a narrow list.** Below about 820px of list the row takes
  two lines instead of cutting off its last three columns.

## 0.187.0 - 2026-09-19

- **The smallest window, with everything open.** At 1120×720 with a long
  conversation, eight teammates and the inspector open, three things were
  cut off and are not now. With the sidebar folded to its rail, the inspector
  slid over the conversation and hid the end of every line, the receipt, the
  banner's Dismiss button and the header's own Activity button; the
  conversation now keeps left of it. The row under the message box (mode,
  folder, route, effort) was cut at its right end whenever the box was
  narrower than about 720px; it takes a second line there instead. And on the
  first screen, when six coding agents and the banner made it taller than the
  window, the Locust lockup was cut off at the top with no way to scroll to
  it; the screen now opens at its end, where Install is, and scrolls up to
  the lockup.

## 0.186.0 - 2026-09-19

- **The first screen, redrawn.** Everything on it now shares one left edge
  with the message box, so it reads as a sequence: which one do I pick, pick
  it, what happens when I click, and then what. The runtime list is one
  column instead of a grid with a hole in its corner, and each row says what
  it costs: *no account needed*, *needs a ChatGPT account*, *needs a Cursor
  account*. While Locust is still checking, the dots pulse and one line says
  *checking 6 on this machine* instead of six rows saying CHECKING. The
  recommendation is the one filled button.

## 0.185.0 - 2026-09-19

- **The first screen says less, and in order.** With nothing installed it
  no longer shows a red card saying no runtime can run; the disabled message
  box already shows that. The "coming soon" line is gone from it too, since
  it named things you cannot install on a screen for installing; Settings
  still lists them. And "here is what changed" waits until a runtime is
  connected, because on a fresh profile there is no previous version to
  compare with.
- **While Locust is still checking a CLI, it says only that.** The red card
  and the note about installing without Node.js no longer appear over rows
  that are still checking.
- **A CLI that never answers offers "Check again", not "Install again".** It
  is already installed; asking again is the repair Locust can perform.

## 0.184.0 - 2026-09-19

- **A hanging CLI leaves nothing behind on Linux and macOS too.** 0.182.0
  said this and it was true only on Windows; a tester counted forty-one
  leftover processes on Linux. Off Windows a version check now runs in its
  own process group and the whole group is ended when it times out.
- **A conversation that could not be read is now said in the sidebar,** not
  only on All missions. Deleting the one visible turn of a chain whose other
  turn was unreadable used to look like the whole conversation was gone.
- **A teammate's own subagents are not teammates.** The brief now says so.
  A Chief of Staff asked to hand work to Booty was spawning its runtime's
  own worker and calling the result Booty's.
- **A Custom role answers with its title** when asked who it is, rather than
  with the name of the program it runs in.
- If the team memory file cannot be written before a run, the failure is now
  recorded in the error log instead of vanishing.
- The first screen's hint no longer says "and sign in to" beside a row that
  needs no account.

## 0.183.0 - 2026-09-18

- **A conversation that left its group keeps its join line.** The thread
  used to mark only where the group's instructions stopped, so the turns
  written under them no longer said so. Both lines are drawn now, and they
  bracket the turns the instructions governed.

## 0.182.0 - 2026-09-18

- **A coding CLI that hangs no longer leaves processes behind.** When one
  did not answer its version check, Locust stopped waiting but the program it
  had started kept running: five more every time it looked again. Locust now
  ends all of it.

## 0.181.0 - 2026-09-18

- **A coding CLI that hangs no longer blocks the first hour.** If something
  on this machine answers to a CLI's name but never replies, its row used to
  read CHECKING forever with no Install anywhere. After Locust has asked
  four times the row now says NOT ANSWERING and offers Install again.
- **The command palette closes on Escape** wherever your focus is, the way
  the plus menu already did.
- The message box no longer asks you to "sign in" when nothing has asked
  for a sign-in.

## 0.180.0 - 2026-09-18

- **Installing a CLI with no Node.js now finishes the job.** 0.178.0 could run
  the install and then not find what it had installed. Three things were
  wrong, and all three were measured on a machine with nothing on it: npm
  put the CLI beside Locust's own program where nothing looked; the npm
  Locust carries refused to run the CLI's own install step; and that step
  needed a program called node, which was not there. Now the CLI lands in a
  folder Locust owns and searches, the install step is allowed for the one
  package you asked for, and a stand-in for node is supplied for the length
  of the install. Press Install on a blank machine and about twenty seconds
  later OpenCode reports its version.
- **Ask mode works on the free model again.** The free OpenCode model had
  begun refusing every run from Ask with "free tier can only be used from
  within OpenCode", because Ask removed the shell tool and the provider no
  longer recognised the client. The shell tool is now offered and every use
  of it is refused by OpenCode itself, so Ask is still read-only and the
  free model answers.
- **Putting back one turn of a conversation puts the conversation back,**
  even if you had opened the other turn to check what was left. Before this
  the sidebar showed two rows for one conversation until you restarted.
- **A single-digit answer is a single digit.** Asking for one used to draw a
  question about whether to answer in complete sentences instead.
- The Install tooltips no longer say the buttons are "below".

## 0.179.0 - 2026-09-18

- **Settings search knows the words you would type.** Searching for *memory*,
  *worktree*, *node* or *ledger* used to say nothing matched, on a screen that
  has all four. They are all found now, and the result names the section they
  live in rather than repeating your word back. *recycle bin* finds the Trash.
- **The page opens where you searched,** instead of at the top. Searching for
  *trash* lands on Trash, not on Updates further up the same page.
- **The note where a group's instructions stop** now sits at the spacing it
  was designed with: clearly separated from the turn above, bound to the turn
  below. It was drifting wider than that in both directions.
- **The first screen no longer points the wrong way.** The line explaining
  why Install is unavailable said the buttons were below it. They are above
  it.

## 0.178.0 - 2026-09-18

- **You no longer need Node.js to install a coding CLI.** Locust carries its
  own copy of npm and runs it with its own binary, so the Install buttons on
  the first screen work on a machine with nothing else on it. Before this
  they were all switched off, on a screen whose entire job is installing
  something -- the app that could not install anything was the app you had
  just downloaded in order to install something.
- **The screen says which npm it used.** When Node is absent Locust says the
  install ran on the copy it carries, and says the part that is still true:
  the CLI works inside Locust, and your own terminal will not see it until
  you install Node.js yourself.
- A CLI installed this way **runs without Node too** -- Locust hands it the
  same runtime it uses itself.

## 0.177.0 - 2026-09-17

- **The app says what changed.** The first time you open a new version, the
  workroom says so and you can read the entry without leaving the screen.
  It says it once: the version is written down as soon as it is shown.
- **Settings carries it permanently**, under **This app → Updates**, so you
  can look up what this build was at any time.
- **The changelog is public.** It is published to the releases repo with
  every ship, and locust.lol links to it. Before this it existed only in the
  private repo -- the one account of what changed that nobody could read.

  The notes ship inside the installer, so what the app tells you was
  packaged with the bytes it is telling you about, and reading it needs no
  network.

## 0.176.0 - 2026-09-17

- **Settings is a list of pages, not one long scroll.** The five areas are
  now pages with a list beside them, the way Claude Code does it: you can
  see the whole map at once and land on any of it in one press. Nothing
  about the settings themselves changed -- same sections, same order, same
  explanations behind **How it works**.
- **Search finds a setting by its own name.** Typing *auto* narrows the list
  to the page that holds Auto mode and says so underneath it.

  The areas arrived on 2026-09-14 and were the right grouping in the wrong
  shape: four of the five sat below the fold, and nothing told you the fifth
  was there.

## 0.175.0 - 2026-09-17

- **Deleting a conversation can be undone.** It still leaves every list the
  moment you delete it, which is what deleting means. What changed is that
  the record itself is kept, byte for byte, until you empty the trash --
  under **Settings → Trash**, where each one can be put back whole, owner
  and name included. Emptying is still two presses and still permanent.
- **Bulk retention is undoable too**, because it goes through the same path:
  deleting missions older than N days now fills the trash rather than the
  disk.

  Why: on 2026-09-17 eighteen conversations went in four seconds through the
  Missions screen's select-and-confirm, and the files were unlinked --
  no Recycle Bin, no shadow copy, nothing to undo. A day of portfolio work
  came back only because those runs happened to be on Cursor, which keeps
  its own transcripts. A product whose claim is a durable local record
  cannot lean on another program's copy for that.

## 0.174.0 - 2026-09-17

- **A long conversation title no longer paints over the window.** A
  conversation with no teammate takes its title from your own first line,
  and that line was drawn in full in a 60px header — 380px of it, across the
  title bar and over the header beneath. It is one ellipsised line now. The
  design agent spotted it in a frame; the cause turned out to be the title,
  not the thread.
- **The plus menu closes.** Escape closes it, clicking anywhere else closes
  it, and changing screen closes it. Before this the only ways out were
  choosing a row or pressing **+** again, so the menu sat over Missions,
  Rooms, Routines and Settings while you tried to read them.
- **A disabled Install looks disabled.** OpenCode's Install — the one button
  the first screen is selling — rendered in full lime while doing nothing,
  because the primary colour was declared after the disabled colour.
- **The route chip does not name a route it has not got.** It reads *No
  runtime*, and hovering it used to say *OpenCode / account-default*.
- **Group settings asks for the right kind of instruction.** Its placeholder
  was a finance example; this is a coding-agent control room.
- **Thread rhythm, to the design agent's numbers:** a boundary note now has
  24px above it and keeps 12px below, so it reads as attached to the turns
  it governs and separated from the ones it does not. A turn still opens
  22px down, now expressed as a named gap rather than a bare 10px.

## 0.173.0 - 2026-09-17

- **A Copilot teammate can be sent a long brief too.** The command-line
  ceiling Locust refused at, 8,191 characters, is cmd.exe’s — and Locust
  has launched Copilot past cmd.exe, through node directly, since 0.21.
  Measured: Copilot under node took a 9,228-character prompt and answered.
  The check now follows the launch: the small ceiling only where a run
  really goes through cmd.exe, Windows’ own 32,767 otherwise.
- **A Cursor teammate can be written to on Windows even when the reply
  would have been read-only.** A teammate on Auto lends *Ask* to a
  teammate that has never run, and Cursor Agent cannot be held read-only on
  Windows — so the reply was refused before it started and the exchange
  died at the first hop, with the reason said only on screen. The relay now
  lends *Accept edits* in that case and the thread says why.
- **Measured on your own models.** The same two exchanges that were measured
  on the free model were run on Cursor Grok 4.6 Low: the request carried
  the context, the purpose and what a good answer looks like; the reply
  quoted its evidence and said what was unverified; the chief of staff
  delegated a newcomer's brief with an end state and "do not invent
  limits", and reported back with Answer, Sources and Still open.
- **Measured on Claude Code, live:** a key a teammate repeats is scrubbed
  from the ledger — the raw value never lands, the answer reads
  *[redacted]*.

## 0.172.0 - 2026-09-17

- **Team memory is a file a teammate can read, not only a list it is
  handed.** The brief pasted up to 24 memories on every turn and told the
  teammate the rest existed; on a folder with 33 memories that was 20 pasted
  and 13 invisible, every time. Now Locust writes the whole list to
  `.locust/memory.md` in the workspace before each run (kept out of git
  through `.git/info/exclude`, rewritten only when it changes), pastes the
  newest eight, and tells the teammate to read the file when the task
  touches something remembered. Measured on the free model: with 30
  memories and the answer only in the oldest, the teammate read the file and
  answered from it, naming the file. The memory block is still the only way
  memory changes; the file says so at the top.

## 0.171.0 - 2026-09-17

- **The thread says where a group’s instructions stopped.** Move a
  conversation out of a group, into another, or remove the group, and a
  line appears at the first turn that was not briefed: *Trading’s
  instructions no longer apply from here* — the mirror of the line that
  says where they began. The name and words are kept as they were, so the
  line stays true after the group is renamed, edited or gone.
- **A reply between teammates opens with what is true, not with a
  negation.** One phrase in the reply brief, from Grok Build’s rule; the
  same exchange measured before and after.

## 0.170.0 - 2026-09-17

- **A Custom role is a brief too.** A teammate you gave your own title
  ("release manager", "finance bro") is now briefed around that title in
  the same shape as the presets: do the work that title describes the way
  a capable colleague with it would, bring what someone in that role would
  know, and say plainly when an ask falls outside it. A Custom teammate
  with no title yet gets the shared part alone.

## 0.169.0 - 2026-09-17

- **An OpenCode teammate can be sent a long brief.** OpenCode took its
  prompt on the command line, and Windows stops a command line at 8,191
  characters — so the first real Chief of Staff exchange lost its last hop:
  the report back into your conversation, carrying the teammate’s reply
  quoted inside the standing brief, was refused as too long and you never
  got it. Measured against the CLI: `opencode run` reads the prompt from
  input when none is given on the line, so that is how it is sent now, the
  same way Codex CLI and Claude Code already are. The ceiling no longer
  applies to OpenCode. (Copilot CLI still takes its prompt as an argument.)

## 0.168.0 - 2026-09-17

- **Teammates brief each other the way you would brief a colleague.** A
  message to a teammate used to be asked for as "one or two sentences"; it
  is now asked for as what you need or found and why, the facts by name,
  and what a good answer looks like. A reply is asked for as the answer
  first, then its evidence, then what is still unverified — and ending the
  exchange is named as the normal good outcome, not something to avoid.
  Measured on the same exchange before and after: the request gained its
  reason and an acceptance line, the reply gained its evidence and its
  caveat, and both exchanges still ended in two hops.
- **A role is a brief now, not a label.** Each preset tells the teammate
  what good work in that role looks like, in a sentence or two. And there
  is a new preset, **Chief of Staff**: a teammate whose job is to route your
  ask to the teammate whose role fits, brief them properly, tell you who it
  went to, and report the reply back as one message that stands on its own.
- **The last message stands alone.** Every teammate is told that its last
  message is what you read if you read nothing else: the answer first, then
  what was done, then what is blocked or unverified, said plainly.
- **Cursor connectors work in every mode.** Outside Auto, Cursor asked
  before every connector call and nobody was there to answer, so each one
  failed as *user rejected*. Locust now writes an allow rule per configured
  server into the workspace’s `.cursor/cli.json` before the run starts;
  nothing is ever removed and the deny list is never touched. Measured:
  the same read-only call was rejected in Accept edits before and answered
  after. The mode menu says so.

## 0.167.0 - 2026-09-17

- **When a run stops because the ledger could not be written, the card says
  why — and the reason is kept.** Wembley’s run stopped this morning with that
  card and nothing on the machine could say what had failed: the error was
  caught and dropped. Three different failures also shared that one card —
  the ledger refusing a write, the runtime adapter choking on a record, and
  a follow-up write — and all three were blamed on the ledger. They are told
  apart now, the card carries the error’s own words, and
  `locust-errors.log` gets a line.

## 0.166.0 - 2026-09-17

- **A thought is one line.** *Thought for 12s*, with a thought-bubble beside
  it, and the words folded underneath until you open them — the shape
  Claude Code used. The thinking is all still kept and still one click away;
  it just stops taking the whole screen to say it happened.

## 0.165.0 - 2026-09-17

- **A key a teammate repeats is scrubbed from what the ledger keeps — in
  its answer and in its thinking, on every runtime.** It was scrubbed from
  the evidence and not from the text: a live Cursor turn given a fake `sk-`
  key wrote `[redacted]` in one field and the key verbatim in the answer.
  Every message text now goes through the same scrub at the point it is
  bounded. (What *you* typed is still recorded as you typed it.)
- **Long Codex answers keep their second half.** Separating the scrub from
  the size limit found that a Codex answer over 8,192 characters was being
  cut in the ledger at the evidence limit after already being bounded at
  the message limit — the thread showed all of it, the record kept half.

## 0.164.0 - 2026-09-17

- **A handoff keeps your effort level too.** The third place the level was
  dropped on the way to disk: handing a run to another runtime remembered the
  teammate’s new runtime, model and mode and not the effort. Found by Grok
  reading source after an unsigned Codex would not start. Fixed.

## 0.163.0 - 2026-09-16

- **A group’s menu is three items again.** *Group settings…*, *Rename*,
  *Remove group* — with a hairline before the destructive one. Its standing
  instructions and default route moved into one **Group settings** dialog,
  because a menu holds actions and a dialog holds what a thing carries. The
  route is named the way the composer names it — *OpenCode / Muse Spark 1.3*,
  not a model id — with *Use current* and a *Clear* that is disabled rather
  than missing when there is nothing to clear. The counter shows only past
  3,600 characters. (The design agent’s ruling on the 0.162.0 frames.)
- **Two shorter sentences.** The thread’s line reads *Trading’s instructions
  brief every turn from here*, and its edit pointer names the dialog. The
  sidebar’s unreadable-file notice is now the fact, then the reassurance
  underneath in small type, behind an amber rule — so it stops reading as a
  row you could click.

## 0.162.0 - 2026-09-16

- **Your effort level stays put.** The level you chose was dropped twice on
  the way to disk — the app remembered a teammate’s runtime, model and mode
  and not the fourth field — so selecting the teammate restored three and
  reset the effort every time. Both places keep it now.
- **Opening a conversation puts the composer back on its mode.** A
  conversation you last ran on Auto reopened on whatever mode the previous
  screen left — so the stocks conversation that needs Auto for its
  connectors quietly came back on Accept edits, and the next connector call
  failed. The conversation’s last turn recorded its mode; the composer now
  starts there. And the guard that knocks Auto down when Auto is switched
  off waits until it actually knows, instead of firing in the second before
  settings load.
- **The mode menu says what Cursor does with connectors outside Auto.**
  Cursor asks before each connector call, and in a Locust run nobody is
  there to answer, so each one fails as “user rejected” — 17 in one
  Accept-edits run, 0 on Auto, same teammate, same connector. The menu says
  so before the run does: use Auto for connector work.

## 0.161.0 - 2026-09-16

- **A group can carry a default route.** Right-click a group · *Use
  current route as default* records the runtime, model, mode and effort
  the composer is set to right now, and says so on the control. When you
  move the conversation on screen into that group, the composer switches
  to the group’s route for the next turn — and only the next turn: nothing
  about a turn already run changes, and a conversation you are not looking
  at is never touched. *Clear default route* takes it away.

## 0.160.0 - 2026-09-16

- **The thread says where a group’s instructions began.** A conversation
  in a group with standing instructions now carries one line at the point
  it joined — *“Trading’s standing instructions brief every turn from here
  · view”* — after the last turn that ran without them, never at the top,
  because the turns above genuinely were not briefed. *view* shows the
  group’s words read-only; editing goes through the group’s own header, so
  nobody changes shared text believing it is their own. Conversations filed
  before the app recorded join times get no line rather than a guessed one.

## 0.159.0 - 2026-09-16

- **Groups carry standing instructions.** Right-click a group · *Add
  instructions…* and write what every conversation in it should be told —
  "quote sizes in shares", "analysis only, never propose a trade". Every
  turn started from then on in a conversation in that group is briefed with
  them, after the folder’s own LOCUST.md and before memory. Turns already
  run were not briefed, and nothing claims they were. Clear the text and the
  group is a plain folder again. A group is no longer only a place to file
  things: filing a conversation into one buys something.

## 0.158.0 - 2026-09-16

- **When a teammate’s reply lands back in your conversation, the teammate
  you asked now tells you what it means.** Ask Jimothy to get a brief from
  Wembley and get back to you: the brief came back, and Jimothy — briefed
  that nobody was watching — ended with a note to itself and not one word
  to you. The reply that lands in the conversation you started is now told
  that you read it, and to say in a line or two what the answer was, where
  it is, and what is still open. Replies between two teammates are still
  told to end quietly, so exchanges do not run to the budget.

## 0.157.0 - 2026-09-16

- **A local file that cannot be read is never treated as empty — and never
  written over.** This morning’s groups fix turned out to be one of four:
  your teammates, rooms and routines files had the same habit. The worst
  was the teammate roster: if it could not be read for a moment (a lock, a
  scan, a torn byte), the app showed you a fresh install, and the next
  mission start would have saved that empty roster over the real one. Now
  every one of those files is either read or refused, nothing is saved over
  a refused one, and the sidebar names the files that would not read.

## 0.156.0 - 2026-09-16

- **Thinking is not counted as a tool call — on the line you actually read.**
  0.153.0 fixed the count in one place and missed the header of the fold,
  so two reads and a thought still said `3 tool calls`, and a run that only
  thought said `1 tool call`. Found by Grok on 0.154.0.
- **The filter count is the pile you are standing in.** With a teammate’s
  face selected and a search typed, the line said `1 of 20` — the whole
  folder — next to a list of that teammate’s one match. It now says `1 of
  5` when five is what that teammate has. Search alone still counts against
  the whole folder. Found by Grok.
- **On a machine with nothing installed, the message box no longer tells
  you to sign in.** There is nothing to sign in to; it says install a coding
  agent, and keeps “and sign in” for a runtime that is present and signed
  out. Found by Grok on the original bare-machine route.

## 0.155.0 - 2026-09-16

- **A file summary counts each file once.** When a teammate changed one
  file in several steps, the run’s card added the steps together and then
  added the file’s final change on top — two lines changed in two edits read
  as `+3 −3`, over a file git reported as two and two. Now the final change
  to a file is the count, and the steps that led to it are inside it. Found
  by Astra on 0.154.0.
- **If your groups file cannot be read, the sidebar says so.** It used to
  look exactly like having no groups: every conversation listed ungrouped
  and not a word about why. Nothing is lost when this happens — nothing is
  saved over the file until it reads again — and now the sidebar tells you,
  instead of leaving you to wonder where your groups went. A file cut off
  part-way now counts as unreadable too — it used to read as empty, and the
  next save would have made it so. Found by Astra, who replaced the file with
  a directory, a truncated copy and an oversize one, and got the same silent
  sidebar all three times.

## 0.154.0 - 2026-09-16

- **A conversation keeps the name you gave it, and stays in the group you put
  it in.** If you renamed one or moved it into a group while it was still
  running, both could come undone on their own a little later — the name
  reverting to your first sentence and the conversation quietly leaving its
  group. Names and groups you set before this will come back; nothing was
  lost, it was being filed under the turn that was live at the time instead of
  under the conversation.

## 0.153.0 - 2026-09-16

- **Thinking no longer breaks up the list of tool calls.** Yesterday's change
  put a teammate's reasoning in the run's fold, and it landed in the middle of
  the tool calls — so it was counted as one, listed among their names, and
  split a single run of calls into several. A turn that made five calls said
  six, and a fold that should have been one line became three. Thinking has
  its own row now, and the count is of tool calls again.

## 0.152.0 - 2026-09-16

- **You can read what a teammate was thinking.** Reasoning was thrown away
  before it was recorded — Cursor's was replaced with "[redacted]" and
  Codex's was stripped alongside API keys and passwords — so a run that
  thought for a minute could tell you how long and nothing about what. It is
  kept now, and appears in the run's fold beside the tool calls. Secrets are
  still removed from it.
- A note on what that means: your mission records will be larger, and a
  record you send to someone now carries the model's working-out as well as
  its answer.
- **Telling a teammate something need not start a paid run.** A share marked
  `when="later"` waits for their next mission instead of starting one. (The
  models are not told about it yet — see below.)

## 0.151.0 - 2026-09-15

- **A mission is no longer stopped by a file that was busy for a moment.**
  "The mission ledger could not be written" could fire because something else
  on the machine — a virus scanner, an indexer, a backup agent — held the
  file for a few milliseconds while it was being written to. Locust waits and
  tries again now. A real failure, like a full disk, still stops the run at
  once, and a failure part-way through a write still stops it, because there
  the record really is uncertain.

## 0.150.0 - 2026-09-15

- **Move a conversation into a group from its own menu.** Right-click it and
  **Move to group** opens the list, with a tick on the one it is already in,
  **Ungrouped** to take it out, and **New group…** at the bottom — which makes
  the group and puts that conversation in it.
- **A teammate is told which folder it is working in.** That was only ever
  said inside a folder's `LOCUST.md`, so on a machine without one — every new
  install — a coding teammate was told its name, its role and its colleagues,
  and nothing about which folder it was about to edit.
- The teammate faces show five when the team is five or fewer, and four plus
  a count when it is larger, so the count never crowds the row.

## 0.149.0 - 2026-09-15

- **A plan now shows what happened to it.** Every plan was drawn as a plain
  numbered list — no ticks, no `2 of 3 done` — which is right for a turn that
  only planned and wrong for one that carried the plan out. So a finished
  plan looked exactly like an untouched one, while the fold underneath said
  "3 of 3 steps".

## 0.148.0 - 2026-09-15

- **The `+` menu opens properly in a normal window.** It was being cut off at
  the edge of the sidebar, and its three items could not be clicked at all.
- **The sidebar says what it is filtering, in one line.** Picking a teammate
  and typing in the search box are two filters, and only one of them was
  mentioned — so a short list had an unexplained reason. It now reads
  `Atlas · "invoice" — 1 of 5`, with one **Clear** that undoes both.

## 0.147.0 - 2026-09-15

- **The teammate faces stay inside the sidebar.** With a big team the row
  ran off the edge of the column — at twelve teammates the last face was
  drawn well outside it. It shows the five you have worked with most
  recently and counts the rest, and the count opens the roster.

## 0.146.0 - 2026-09-15

- **Groups.** Make one from the `+` beside the logo, then right-click any
  conversation and choose **Move to** it. Groups sit at the top of the
  sidebar, folded, with everything else under **Ungrouped**, newest first.
- The `+` now offers the same three things in any window size — New teammate,
  New room, New group.
- **Removing a group never removes conversations.** They go back to
  Ungrouped. Rename or remove one from the `⋯` on its header.

## 0.145.0 - 2026-09-15

- **A conversation you renamed keeps its name.** Renaming saved it correctly
  and then never read it back when the app started, so the name lasted until
  you next opened Locust and the row went back to your first sentence. It
  loads now, and names you set before this will reappear — they were on disk
  the whole time.

## 0.144.0 - 2026-09-15

- **You can delete more than one mission at a time.** Tick the box beside any
  row on the Missions screen and a bar appears: how many are selected, Clear,
  Select all, and Delete. It asks once more before the records go.
- A mission that is still running has no box to tick, and says why — deleting
  one would take away the control that stops it.

## 0.143.0 - 2026-09-15

- **If a deleted conversation ever comes back, Locust now says so.** It
  remembers what you deleted while the app is open and writes a line to the
  log if one is read back out of the record. Nothing found so far — deleting
  a conversation does remove every one of its turns from the ledger, checked
  by driving it — so this is here to settle it the next time it happens, in
  either direction: a line means a record really returned, and no line means
  the row you are looking at is a different conversation that reads the same.
  Settings · This app · Report a problem shows the log.

## 0.142.0 - 2026-09-15

- **Hovering a teammate shows their card again, not a sentence.** Pointing at
  a face in the sidebar drew one long tooltip — name, role, runtime and an
  instruction, all on a single line. It opens the profile card instead, which
  already existed for the narrow window and says the same things laid out,
  with their conversations under them.
- **Their faces move again.** The new roster row was drawn without the state
  that animates them, so the whole team sat still.
- **The dot beside a conversation means something now.** It showed the run's
  outcome, and *completed* was blue — so nearly every row carried a permanent
  coloured dot that reads like an unread mark and never clears. A finished
  conversation has no dot; one that is running, failed or left an incomplete
  record still does.
- **The sidebar footer stopped cutting its own labels.** It said "Teamma…"
  and "6 connect…". Teammates has left the footer — the faces row is the way
  to the roster — and the runtimes line now says its whole sentence.
- **A running step names the command, not the shell.** It read
  `cmd /c "dir /s /b …"`, spending the front of every row on the same nine
  characters and pushing the actual command off the end.

## 0.141.0 - 2026-09-15

- **You can name a conversation.** Right-click one in the sidebar and choose
  **Rename**. Until now its title was whatever your first sentence happened to
  be, which is fine to type and hard to find a week later — and since the
  sidebar flattened, that title is the only thing on the row.
- **Clearing the name gives you the original back.** Empty the box and press
  Enter. Nothing was overwritten to lose: the words you typed are in the
  mission's own record and renaming never touches it.

## 0.140.0 - 2026-09-15

- **Rooms and Routines are back.** Flattening the sidebar in 0.139.0 left
  them with nowhere to be: in a normal window there was no button, no
  heading, and a room you had already made was drawn nowhere at all. They are
  in the footer now, beside Missions, Teammates and Settings — and in the
  narrow window too, where Rooms had never been reachable.
- **The roster button says Teammates again.** It was shortened to "Team"
  because three labelled buttons could not share 266px without the word
  breaking. The footer is two rows now, so it fits.

## 0.139.0 - 2026-09-15

- **The sidebar lists your conversations, newest first.** They used to sit
  folded under whichever teammate owned them, so finding one meant first
  remembering who you gave it to. On a light week — fourteen conversations
  over four days — that layout spent **330px before the first conversation**,
  nearly half the column, and showed **7 of 14**. It now spends 4px and shows
  all fourteen.
- **Conversation titles are no longer cut short before they reach the
  screen.** The title was trimmed to 44 characters in code and then trimmed
  again by the column, so widening it could never have helped. The column
  does the trimming now, and rows say `2m` / `4h` / `3d` so the order you are
  looking at is one you can check.
- **Your teammates are a row of faces under the search box.** Click one to
  see only their conversations; **Team** opens the full roster, which is where
  the runtime and model belong — that line used to be repeated, and truncated,
  once per teammate.
- **The newest conversation is now actually at the top.** The one the app
  reopens for you had no timestamp of its own, so it sorted to the bottom of
  a list that says it is newest-first.
- The narrow window is unchanged: at 64px the avatars and their flyout are
  still the way to a conversation.

## 0.138.0 - 2026-09-15

- **There is a way to say "this broke".** Settings · This app now has
  **Report a problem**: it names the log, says how big it is, says what is in
  it, and shows it in your file manager. The log records what happened, never
  what was said — crashes, a window that stopped answering, and the version
  you were on. No messages, no file contents, nothing from a mission.
- **A crash that takes the window now leaves a record.** Locust has always
  logged an error it threw itself, but the window dying is a different thing
  and it wrote nothing at all — the app would vanish and leave no trace of
  why. It writes a line now, as does a helper process that dies and a window
  that stops answering. The log is capped and rolls over once.
- **A teammate on a machine with no coding agent stopped asking you to sign
  in.** It said *Runtime sign-in required*, in red, about software that was
  not installed — an instruction you could not follow, on the first screen
  you see after naming a teammate. It now says what is actually true.
- **The loading screen stopped counting nothing.** With no coding agents
  installed it flashed "checking 0 of 0 runtimes", which is arithmetic about
  an empty set. It says what it is doing instead.

## 0.137.0 - 2026-09-14

- **The narrow sidebar works now.** Both of yesterday's complaints are
  closed, this time after driving the built app and measuring the controls
  rather than shipping and hoping. The locust mark at the top is the way
  home again — it had been rendering two pixels wide and no pixels tall, so
  there was nothing to click. And the single `+` opens: it was drawing two
  pixels tall, then, once it had height, getting clipped at the edge of the
  64px rail, which left half of "New teammate" and "New room" unpressable.

## 0.136.0 - 2026-09-14

- **A plan no longer claims nothing changed when something did.** Showing the
  plan on every turn brought its "Plan mode — nothing was changed" line with
  it, over runs that had just made thirty tool calls. The plan stays visible;
  that sentence appears only on a turn that really did nothing but plan.
- **Clicking the message box no longer tints it.** It lightens, the way
  Claude Code's does — the border comes up a step and the ground barely
  lifts. It still says where the keyboard is.
- **The narrow sidebar is back to how it was.** Yesterday's attempt at it
  stretched the mark across the top and stopped the `+` working. Both of the
  original complaints — no way home, and two pluses you cannot tell apart —
  are still open and will be done with a way to see them first.

## 0.135.0 - 2026-09-14

- **Settings is organised.** It was thirteen subjects in one unbroken scroll,
  in the order they happened to get built — Updates third, the two appearance
  settings at opposite ends, and the boot screen sharing a block with Swarm
  and Auto mode because they were added the same day. Five areas now, each
  named for what is in it: **Your workspace**, **Runtimes**, **How teammates
  work**, **Appearance**, **This app**.
  - The explanations have not moved or grown. The problem was never that a
    setting explained itself; it was that you could not find the setting.

## 0.134.0 - 2026-09-14

- **The loading screen is quick on a machine without the runtimes.** Checking
  spaced each runtime a beat apart so the log could be read, and that beat
  was being paid by the people with nothing to check — a runtime that is not
  installed answers in about ten milliseconds, so the spacing *was* the whole
  wait. Each check now waits for the one before it or for the beat, whichever
  comes first: slow runtimes still arrive one at a time, and an empty machine
  goes straight through.
- **The narrow sidebar keeps the Locust mark**, and it is still the way home.
  Both it and the wordmark were hidden, so the app lost its own name at
  exactly the width where the window is smallest.
- **The plan is visible without opening anything.** It used to ride inside
  the tool-call fold whenever a turn had one — so on exactly the turns worth
  watching, the plan was the thing you had to go looking for. The fold hides
  *how* a turn was carried out; a plan is *what* it is doing and how far
  along, which is the question you actually have while it runs.
- **Clicking the message box glows instead of outlining.** The hard edge was
  too loud for the biggest control in the app. Same colour, a fraction of the
  weight — it still says where the keyboard is, which is the part that
  matters.
- **One `+` in the narrow sidebar, and it says what it adds.** There were two
  stacked, unlabelled and indistinguishable; it is now a single control
  offering New teammate or New room.

## 0.133.0 - 2026-09-14

- **The black square behind the loading screen is gone.** Making the window
  transparent was not enough: the page drawn on it painted its own
  background, so the window was see-through and its contents were not. The
  loading screen is now the monitor and its own edge, on your desktop.
- **A conversation's turn count keeps clear of its menu.** The `…` that
  appears on hover sits over the right edge of the row, and the count was
  underneath it — so the number and the dots shared the same spot. The row
  reserves that space now, rather than the count trying to dodge it.

## 0.132.0 - 2026-09-14

- **The loading screen is just the monitor now.** It had a black slab behind
  it and around its corners; the window is transparent, so the only thing on
  screen is the bezel and its own edge.
- **The app comes forward when it opens.** Held behind the loading screen, it
  could arrive minimised behind whatever you were last looking at. It is
  restored, shown and focused — and the loading screen raises itself too,
  since one that opens behind another window is one nobody sees.

## 0.131.0 - 2026-09-14

- **Locust opens on a loading screen.** The monitor is its own window now: it
  comes up first, shows each runtime being checked, and closes when they have
  answered — and the workspace behind it is already built and already knows
  what it found. It is not drawn inside the app any more, which is why it
  used to flash and vanish.
  - If a runtime never answers, the app opens anyway after twelve seconds
    rather than leaving you on a loading screen forever. Clicking the screen
    also ends it early.
  - **Settings → The boot screen → Off** skips it entirely.
- **Teammates keep a plan by default.** It was off unless you found the
  setting, and a settings file written before the setting existed counted as
  "off" rather than "never asked".
- **"New conversation with…" starts one.** It re-selected a teammate who was
  already selected and opened the conversation that was already open, so it
  did nothing at all.
- **The turn count beside a conversation is legible**, instead of running
  into the title's ellipsis.

## 0.130.0 - 2026-09-14

- **The app stops going backwards while it is running.** Locust re-checks
  your runtimes every so often and whenever you focus the window, and each
  check was throwing away what it already knew — so a runtime that had
  reported its version dropped back to "checking" with no version, and the
  welcome panel flickered. A check that has not answered yet now keeps what
  the last one established. Signing out, or uninstalling, still shows at
  once: those are answers, not silence.
- **The boot screen belongs to the launch.** A re-check could bring it back
  over your work half a minute into a session. It appears once.

## 0.129.0 - 2026-09-14

Three from a design pass over the screenshots — each one visible in a frame
and invisible in the source.

- **The elapsed counter no longer runs backwards.** A turn showed `starting ·
  3s` and then `working · 0s`, because the clock restarted whenever the phase
  changed. It runs from the start of the turn now and the phase is a label on
  it. That number is how you tell a slow runtime from a stuck one, so it must
  only ever climb.
- **The command palette prints each heading once.** `GO TO` appeared twice,
  because Workroom sat in that group with an unrelated row between it and the
  rest. Workroom now has its own heading at the top — it is first because it
  is the likeliest thing you want, and now it looks deliberate.
- **You can actually watch the boot screen now.** It was starting before the
  window appeared and running faster than the window takes to open, so by the
  time you could see it the log had already happened. The runtimes are not
  checked until there is a window to watch it in, and they start far enough
  apart to read.
- **The Skip button is gone.** There was nothing to skip; clicking anywhere
  still puts the screen away.
- **The boot screen counts what it shows.** It said "8 so far" above six
  rows, because it was counting runtimes that are not built yet and so are
  not listed.
- **Settings lists what you can use first.** Two runtimes that are not built
  yet were sitting in the middle of six that are, so the list had to be read
  tag by tag. Ready, then experimental, then needs-sign-in, then not
  installed, then roadmap — alphabetical inside each, so it does not shuffle
  between launches.

## 0.128.0 - 2026-09-14

Four fixes to yesterday's boot screen, all from watching it run.

- **A slow runtime no longer looks like a broken one.** Cursor's command is
  `cursor-agent` but its name inside Locust is `cursor`, and the screen was
  filing the answer under the wrong one — so it sat on "still waiting" for a
  runtime that had already replied, and then showed it connected in the table
  underneath. The wording is calmer too: a slow answer is not a refusal.
- **The log and the table are the same list now.** Gemini was in the log
  saying "sign-in required" while Settings called it not built yet; it is
  roadmap, so it is out. Antigravity was in the table having never appeared
  in the log, because it is checked differently; it is in.
- **Starting up is quick again.** Checking one runtime at a time made the
  wait the sum of all of them, and on a machine where they are all installed
  that is many seconds. They now start a beat apart and run alongside each
  other: the log still reads in order, without the slowest one holding up
  everybody else.
- **A teammate's message reads in their voice wherever it is quoted.** A
  message from one teammate shown inside another's conversation was set in
  the interface font while their replies were not.
- **The jump-to-bottom button sits where it should**, instead of wherever the
  layout happened to put it, and now reads as floating above the text rather
  than punched into it.

## 0.127.0 - 2026-09-14

- **Finding your runtimes is something you can watch now.** Locust opens on a
  terminal that shows what it is actually doing: the version and folder it
  opened, then each runtime as its command is issued, with a counter running
  while that one is out. When they have all answered it settles into the
  table of what you have. Nothing on it is invented — every line is something
  the app read.
  - It only ever fills the empty middle of the window. The sidebar, the
    folder and the message box stay put, so you can pick a teammate or start
    typing without waiting for it, and clicking anywhere on it puts it away.
  - If discovery is quick you get a flash and you are straight in. If a
    runtime takes more than six seconds the counter stops pretending and says
    it has not answered, and a Skip appears.
  - **Settings → The boot screen** turns it down to Subtle or off entirely.
- **Runtimes are now checked one at a time** instead of all at once, so the
  log reads in the order things happened.
- **A queued message is no longer drawn like an error.** It was a bordered
  card with two heavy buttons for the most ordinary thing in the app —
  something you typed that will send by itself in a moment.

## 0.126.0 - 2026-09-14

- **Text no longer bleeds across the composer's controls.** The `effort ·
  fixed` label and the swarm mark were drawn on top of each other — measured
  at 44px of overlap in a default window and 83px in a small one. That row is
  capped and deliberately does not wrap, and the rule that lets the folder
  and model names truncate was letting everything else shrink below its own
  text too. Only those two names give now.
- **The conversation's running total is out of that row.** 0.125.0 put it
  there for runtimes that draw no context ring, and that row was already at
  capacity. It stays in the ring's hover where a ring exists; where to put it
  otherwise is back with the design review rather than answered in the
  tightest row in the app.

## 0.125.0 - 2026-09-14

From a static sweep of the whole renderer.

- **Tabbing into a text box now shows you where you are.** The search field,
  the composer, the command palette and the route picker each hid their own
  focus ring and put nothing back, so moving between them by keyboard
  changed nothing on screen. The palette is keyboard-only by nature, which
  made it the worst of the four.
- **A one-step plan no longer reads "0 of 1 steps".**
- **The count beside TEAMMATES and ROOMS is readable.** It was using the tone
  reserved for things that carry no information, at about 3.2:1.
- Violet and clay teammate names now come from the colour system like every
  other hue, and no colour in the stylesheet can quietly fall back to a value
  that was never checked.

## 0.124.0 - 2026-09-14

Two findings from the first acceptance pass to reach routines.

- **A routine held for a question now says what running it again would do.**
  It said "Answer it, then run the routine again when you are ready", which
  reads as *carry on from here*. It isn't: the attempt is held and cannot be
  continued, and a later Run starts from step 1. If your steps are not safe
  to repeat, that is the sentence you needed before you pressed anything.
- **The sidebar search says it searches conversations**, because that is
  what the sidebar holds. It said "Search missions" while the screen actually
  titled Missions carried on showing everything — so from that screen, search
  looked broken.

## 0.123.0 - 2026-09-14

Three placements, from a design review of yesterday's fixes. Each fix was
right and each left some surface saying one thing too many.

- **The mission line fits again.** It had grown to seven facts and was
  truncating mid-word. Off it: the word `Mission`, which labelled the line
  once and cost eight characters on every render after; the permission
  sentence, which the composer already states where you can actually change
  it; and the conversation's running total, which is not a fact about one
  mission. What is left is the mission, its model, its state and what it
  cost.
- **The conversation's total moved to the route chip**, where the context
  ring already tracks what this conversation has spent — in its hover where
  a ring is drawn, and stated outright where there is none.
- **"Started without the earlier messages" now reads as a note**, not a
  divider — left-ruled beside the turn it describes rather than centred like
  a boundary between turns.
- **A message from a teammate says who *sent* it**, and offers to open the
  conversation it was written in. What arrives is what a teammate chose to
  send; their own reply may be fuller, and now you can go and read it.

## 0.122.0 - 2026-09-14

- **A run that never started offers to run again.** When a runtime dies
  before it opens a session — nothing started, no tool called, nothing
  touched — the card now offers one press instead of leaving you to retype
  the message you already wrote. It is offered *only* in that case: a run
  that got as far as doing something is deliberately not offered it, because
  whether the half it did matters is your call and not the app's.

## 0.121.0 - 2026-09-14

- **"Started without the earlier messages" now sits where the turn starts.**
  It was drawn at the very bottom of the thread, after the approvals and hard
  against the composer — which is where live and pending things live, so a
  permanent note about the past read as an alert that would not go away. It
  is neither an alert nor dismissable: it says this turn began without the
  model carrying the conversation, because the turn before it left no session
  to resume. Beside the time marker that opens the turn, it reads as what it
  is.

## 0.120.0 - 2026-09-14

- **A runtime that cannot save its own settings file now says so in English.**
  Asking one Cursor teammate to ask another could end the run with two
  absolute paths, a uuid and "EPERM: operation not permitted" — which reads
  like Locust was refused something in your project. It wasn't: `cursor-agent`
  rewrites its own config in your home folder each time it starts, and on
  Windows that fails while a second copy of it still has the file open, which
  is exactly what a message between two Cursor teammates causes. The card now
  says whose file it was, that nothing in your workspace was denied, and that
  running it again usually works. It deliberately does not claim your
  workspace is untouched — the run died somewhere, and nothing here knows
  where.

## 0.119.0 - 2026-09-14

A second outside audit drove the same build again and re-ran every original
repro rather than the new happy path. Seven of the eight earlier findings held
up. These are the three that did not.

- **The teammate you named claims the row you named.** A post like "Wren,
  start Write the release notes" recorded Wren's run without ever reaching the
  claim, so the board said unassigned for the whole time she was visibly
  working it — and the claim only landed when her reply came back, which is
  what the previous build already did. The claim now happens where the run
  actually starts. It goes to the teammate the sentence names, not to whoever
  starts first: on a post that also says "Booty, reply OK and do not touch the
  board", first-past-the-post would have handed Booty the row. A post that
  names no row still claims nothing.
- **A cancelled or failed run no longer wears the previous turn's tokens.** A
  run stopped before anything started showed "1.8k in · 189 out" beside its
  own id — the counts from the turn before it, which its own record does not
  contain. The number beside a mission is now that mission's, or nothing at
  all when it never reached a model. The conversation's running total is still
  there and now says the word "conversation".
- **A link the app refuses to open says so.** Locust declines addresses it
  won't hand to your browser, and it had a sentence ready for each one — which
  the window threw away. A refused link and a link that opened looked
  identical: nothing happened either way. The reason now appears beside the
  link you pressed.

## 0.118.0 - 2026-09-14

Seven findings from an outside audit that drove the built app, all of them on
screen rather than read out of the source.

- **A rename that cannot be saved no longer says the room does not exist.** If
  the rooms file could not be read, the app read zero rooms, decided your room
  was not among them, and said so — under a window that was showing it. It now
  says nothing was changed and every room is as it was.
- **An Ask-mode answer with a code block is not a failed write.** Asking for an
  example put a banner under the reply saying the run could not write to your
  workspace. Nothing had tried to.
- **A room task is claimed when the work starts**, where your own words named
  the row, instead of only once a reply comes back. A post that doesn't name a
  row still claims nothing — the app doesn't guess which one you meant.
- **A stopped run that never started drops the warning about a command still
  running.** One card said nothing had started and that something may still be
  finishing.
- **The Team roster shows the same presence as the sidebar.** One of them
  counted a starting mission as working and the other didn't.
- **With nothing installed, the composer says "No runtime"** instead of naming
  one that isn't there.
- **A room menu closes when you leave the room**, instead of floating over the
  next screen still offering to remove it.
- **OpenCode's session error reads as a sentence**, not as the provider's raw
  `encrypted_content` line.

## 0.117.0 - 2026-09-14

- **A Cursor teammate knows which connectors it can call, by name.** You should
  not have to tell it. If a machine has a working connector and a broken one
  with a similar name, a teammate asked about it would find the obvious name,
  read "0 tools", and report the whole thing dead — which was true of the one
  it checked and false of the one beside it. Only connectors that are actually
  ready are named.
- **Two amber lines are gone.** A teammate addressing a message to its own role
  said so in amber; nothing was lost, nobody was waiting, and there was nothing
  to do about it. A memory a teammate successfully forgot was quoted in full
  above the card that already said it. Amber here means a person may need to
  act, and neither of those did. A message to a name that is not on the roster
  still speaks, and so does a forget that failed — those are things somebody
  has to settle.

## 0.116.0 - 2026-09-14

- **A teammate claims the task it starts.** Ask one to do something a row on
  the board describes and it now claims that row in the same reply. Every
  instruction it had was a limit — *claim only what you are actually doing* —
  and a model reading only limits errs toward doing nothing, so the board said
  "unassigned" while someone was actively working it. That is not untidiness:
  the rule beside it sends other teammates at unassigned rows.
- **One control per task, not four.** Open, Assign, Done and Remove were four
  boxed buttons on every row, so a five-task board drew twenty of them and the
  tasks were the quietest thing in their own list. They are all one press away
  now, in the same menu the room header uses.

## 0.115.0 - 2026-09-14

- **A room's header is a conversation's header.** It was a boxed Rooms button,
  the title, a list of names and a boxed Remove room, all competing across the
  top. It is now the room's name with its members under it, and one dropdown on
  the right holding All rooms, Rename and Remove — the same shape a teammate
  conversation has.
- **The plan step underway pulses.** It already had the colour and the border,
  and it was the only motionless thing in a view where motion means "happening
  now", so on a six-step plan nothing drew your eye to the row that was
  actually moving. It uses the same pulse the sidebar uses for a working
  teammate, and it stops entirely if your system asks for reduced motion.

## 0.114.0 - 2026-09-14

- **Links in a reply are clickable, and they say where they go.** They were
  shown but never linked. A web address now opens in your own browser, with
  the site's host printed quietly after the label — because the label is the
  model's words and the destination is the fact, and you should see the second
  one before you click. A local file path is still not clickable: a reply must
  not become a way to reach this machine.
- **An italicised link renders as a link.** `*[Title](https://…)*` — which
  models write constantly for an article title — used to render with the
  brackets and the whole URL sitting in the middle of the sentence.
- **The Cursor connector notice is gone from the conversation.** It said to run
  `cursor-agent mcp login`, and that command does not work: it persists no
  credential anywhere. An app that prescribes a command which cannot work
  spends your evening for you.

## 0.113.0 - 2026-09-14

- **A teammate whose runtime is signed out no longer says "idle".** If you made
  a Claude teammate on a machine where Claude is not signed in, the sidebar
  said "idle" while Settings said, correctly and in red, that Claude is not
  signed in. It now says "Runtime sign-in required" everywhere, with the red
  dot, on the sidebar, the Team roster and the workroom header.
- **Their welcome screen says it too, with the command.** It used to offer
  starter buttons that could not work. It now says which runtime is signed out
  and what to run, and the buttons are disabled rather than misleading.
- **A mission waiting on your approval is still its own thing.** Amber, and
  worded as a decision waiting for you — not folded in with a sign-in wall,
  which is the app's problem rather than yours.

## 0.112.0 - 2026-09-14

- **A review sees the whole conversation, not just the last turn.** If a
  teammate created a file on turn two and adjusted it on turn four, a review of
  turn four was shown one path and told that was the work — so a reviewer doing
  its job properly reported the work as incomplete. Files changed earlier now
  travel with the brief, listed separately so the reviewer can still tell which
  turn it is judging.
- **This matters most for a turn that only answered.** In a conversation that
  had already built something, the brief used to say "it changed no files and
  ran no commands" and stop, which is exactly where a reviewer concludes the
  work was never done.

## 0.111.0 - 2026-09-14

- **A teammate that fails to forget something says so.** When a teammate
  corrected itself, it quoted the memory it was replacing -- and if the quote
  was not word-for-word, nothing was removed and nobody was told. The wrong
  memory stayed in every brief, the correction landed beside it, and both were
  read by every mission afterwards. It now says what it could not forget, and
  that the memory is still there.
- **Quoting a memory no longer has to be exact.** Dropping a trailing clause or
  quoting half the line finds it. What it will not do is guess: if the quote
  could mean two different memories, it removes neither and names both, so you
  can see what it was reaching for.
- **Memories say how old they are.** A note from three weeks ago read exactly
  like one written an hour ago. Each line in a teammate's brief now carries its
  age, and teammates are told that when two notes disagree the newer one is
  usually the correction.

## 0.110.0 - 2026-09-14

- **Ask your teammates to keep a plan.** New in Settings, under Plans, off by
  default. Switch it on and a Codex, Cursor or OpenCode teammate is asked to
  keep a todo list as it works, so the board in a room fills in while the
  mission runs instead of after it. It costs tokens and changes how a teammate
  narrates itself, which is why it is a choice rather than the default.
- **Claude Code is never asked.** It has no todo tool at all, so the request
  would be an instruction it cannot follow and the board would sit empty with
  nothing to explain it. The switch does nothing for a Claude Code teammate in
  either position, and says so.

## 0.109.0 - 2026-09-14

- **The Cursor connector notice actually appears now.** It shipped yesterday
  and had never once run on Windows: Cursor installs `cursor-agent` as a `.cmd`
  shim, and the way Locust was starting it cannot start a `.cmd` at all. The
  reading failed instantly every time and the app treated that as "nothing to
  report". It now finds the launcher the same way it finds every other runtime.
- **A Cursor mission no longer waits on that reading.** The same call sat in
  the middle of the event stream, so with it fixed every event behind it would
  have queued up behind a question asked of another program. It answers in its
  own time now.
- **Settings tells you how to sign a runtime in.** A red SIGN IN tag there said
  nothing else at all, while the first-run panel had been printing the exact
  command since it was built. The screen you open when something is wrong knew
  less than the one you see once.
- **The teammate dot means the same thing everywhere.** The workroom header
  drew its own and had no "blocked" state at all, so a teammate stuck on a
  sign-in looked identical to one with nothing to do — inches from a sidebar
  row drawing it correctly. The Team roster had no dot at all.
- **A mode says one thing.** The five modes were described by four separate
  tables in four files, already disagreeing on capitalisation and on whether
  Ask is read-only, which is the most important fact about it. One table now.
- **Every failure says what is still true.** "That room could not be renamed."
  tells you about the request and nothing about the room, and the reading
  people assume is the one that would hurt. Twenty-three of these now name what
  did not change: the room kept its name, the mission is still running, your
  message is untouched.

## 0.108.0 - 2026-09-14

- **The room's plan sits with the conversation, not above it.** It was pinned
  at the top, which meant that in any room with a conversation in it the board
  was scrolled off screen exactly when you would act on it. It now sits under
  the newest messages, where you already are.
- **Adding a task is a line, not a bar.** A bordered full-width input used to
  be the loudest thing in an empty room, for the least important thing in it.
  A plan has steps and a quiet way to add one.
- **Locust says when a Cursor connector has no credential.** If you have a
  connector set up but a Cursor teammate never calls it, this is almost always
  why: `cursor-agent mcp list` reports `requires_authentication`, and signing
  in inside the Cursor app does not sign the CLI in. The app now says so, with
  the exact command that fixes it, once per run.

## 0.107.0 - 2026-09-14

- **"no word back yet" is gone from the conversation.** Added yesterday for a
  Cursor run that sat silent for two minutes, it fired on almost every Cursor
  run instead — noise where it was meant to be signal. Rooms still say it,
  where it has always been on a card rather than under a working line.
- **A waiting message says when it was sent.** A teammate's message waits for
  its recipient's next turn, and that turn can be a conversation about
  something else — so a paragraph about a database schema can open a
  conversation you started to ask about something unrelated. Nothing was wrong,
  and the card never said the one fact that made it make sense. It does now.
- **One route, one spelling.** The Missions row and the Team roster printed raw
  ids, so `opencode / muse-spark-1.3-contributor-free` on one screen was
  `OpenCode / Muse Spark 1.3 Contributor Free` on another.
- **One missing cost, one sentence.** Four surfaces each answered "the runtime
  reported no cost" differently — `—`, `not reported`, and two longer versions
  — with three of them in view at once.

## 0.106.0 - 2026-09-14

- **A 41-second run says 41s everywhere.** The Missions row rounded to whole
  minutes and read `0m` while the fold two inches below said `41s` — one
  mission, timed twice, disagreeing.
- **A completed run whose record is incomplete is amber wherever it is drawn.**
  The Team screen's recent list had no way to know, so it stayed blue while the
  same mission went amber on every other surface.

## 0.105.0 - 2026-09-14

- **Stopping a run now stops what the run started.** Measured on the installed
  app: a teammate was asked for one command that writes a file, waits ninety
  seconds, then writes another — and stopped after eighteen. Both files were
  there afterwards. The command had kept running and written into the workspace
  a minute and a half after the person stopped it. The stop reached the CLI and
  never the command underneath it. It does now, and the case is a test that
  costs nothing to run.

## 0.104.0 - 2026-09-14

- **Nested lists are nested.** Every item became a top-level row whatever its
  indent, so a three-level answer came out as one column of equal-weight lines
  — and in a list, the structure *is* the content. Depth now comes from the
  indent itself, so two spaces, four spaces and tabs all draw the same shape,
  and a numbered list written under a bullet is a child of it rather than a new
  list.
- A leading `/` is a command only where a person typed it — pinned as a guard,
  so a teammate's message or a routine step beginning with `/model` can never
  become one.

## 0.103.0 - 2026-09-14

- **A run of plain tool calls is one row.** A turn that read eleven files drew
  eleven rows of equal weight, and the one edit among them looked exactly like
  the ten reads. Reads, searches and lists that happen in a row now fold into a
  single quiet line. A command, a file change, anything still running and
  anything that **failed** always keeps its own row — the fold can only ever
  quieten what was already quiet.
- **That row says what it is not showing.** It names the first few and then
  counts the rest (`… 8 more`), rather than stopping without saying it stopped.
- **Conversations are ordered by what is happening, not by what started last.**
  A conversation working for an hour sat below one that opened five minutes ago
  and had been idle since.

## 0.102.0 - 2026-09-14

- **A stopped run no longer claims nothing was in flight.** It said "Nothing
  was mid-flight" from a list that only holds tool calls the runtime had
  reported as open — while, measured on a real run, the command it had launched
  kept going and wrote a file into the workspace ninety seconds after the stop.
  It now says what it actually knows, and says out loud that a command which
  had already started may still finish on its own. The stop itself not reaching
  that command is a separate fault and is not fixed yet.
- **A review is asked about the turn you are reviewing.** In a conversation
  that had moved on, the reviewer was handed the request the conversation
  *opened* with — so a turn asked to create two files was judged against an
  earlier instruction not to change any files, and correct work read as a
  violation. The request is now this turn's own, with the opening ask kept
  beside it and labelled as context.

## 0.101.0 - 2026-09-13

- **Everything you type while a teammate works is kept, and arrives as one
  instruction.** There was one queue slot, so a second thought *replaced* the
  first and you watched your own words disappear. The queue is a list now, and
  the run of plain follow-ups at the front is folded into a single turn when it
  goes — so a teammate answers all of them knowing they exist, instead of
  answering the first without knowing the other two were coming. The strip says
  how many are waiting and shows the instruction that will actually be sent.
- Anything the app queued for you — a routine's next step, a decision reply, a
  hand-off — never merges into your words, and keeps its own turn.

## 0.100.0 - 2026-09-13

- **A teammate's words can no longer act as another teammate's instructions.**
  Locust reads four blocks out of a reply and each makes the app *do*
  something — send a message, write to the team's memory, raise a decision,
  move a room's board. Text one teammate said gets quoted into another's
  prompt in several places, and a model asked to review or reply to quoted
  text often reproduces it verbatim — at which point the block is parsed out
  of the *second* teammate's reply and acted on under their name. Peer
  messages have been defended against this since they existed, but only for
  the share block; the reviewer brief added in 0.96.0 defended against none.
  All four tags are now defanged by one rule, everywhere model text is
  re-quoted, and the words still read normally.

## 0.99.1 - 2026-09-13

- **A finished task is muted, not crossed out.** Checked against the design
  artifact itself: its done steps are quieter and nothing more, and the app's
  own plan agrees. The board was the only one of the three drawing a line
  through them.

## 0.99.0 - 2026-09-13

- **The room's task board is a plan.** Its rows already borrowed the plan's
  shape; everything around them did not — a bordered panel with a titled head,
  above every room, drawn at full size even with nothing on it. The card is
  gone. What is left is the plan's own quiet counter, `TASKS · 1 of 3 done`,
  steps with room to breathe, and no rules between them. A board with no tasks
  now draws **nothing at all** except one faint line to add the first one, so a
  new room opens on the room rather than on an empty panel.
- **Adding a task stopped shouting.** With the rows quiet, a full-strength
  input box became the loudest thing on the board — the bar rebuilt one element
  down. It sits back until you hover or focus it.
- **A teammate a post never reached is no longer called a failure.** The line
  above a post read "2 asked · 1 answered · Booty failed" directly above "Booty
  was not asked." Nothing ran, so nothing failed; they are counted as not
  asked, which the line underneath already explains.

## 0.98.0 - 2026-09-13

- **Cursor's plan is drawn.** Cursor keeps a to-do list and Locust threw every
  update away — on the runtime that accounts for 90 of the 147 missions
  recorded here. It now shows as the same live step list every other runtime
  gets. Cursor sends only the items that *changed* after the first update, so
  the plan is merged by item rather than replaced; without that, a three-step
  plan would shrink to one as it finished.
- **Antigravity's commands are counted as commands.** It calls them
  `run_command`, which nothing recognised, so an Antigravity run that ran
  seventy-six commands reported that it ran none — in the activity fold, in the
  trace line, and in what a reviewer is handed.
- **Reading a file no longer counts as changing one.** Antigravity's
  `view_file` was read as an edit because it contains the word "file", so runs
  reported changed files they had only looked at. A verb like *view* or *read*
  now beats the noun.
- Every tool name five runtimes have actually produced is now pinned in a test
  built from the recorded ledgers, so the next runtime's spelling has to be
  measured before it is trusted.

## 0.97.0 - 2026-09-13

- **A run that has not said anything now says so.** A Cursor turn showed
  "working ···" and nothing else for over two minutes. That was the truth —
  measured in its own ledger, the runtime sent nothing for 128 seconds and then
  thirty events inside three — but "working" reads the same whether a run is
  thinking or hung. Past twenty seconds of silence the line adds **no word back
  yet**, which is the sentence rooms have carried since 0.89 and the
  conversation never did.
- **A memory is announced once.** Keeping one drew an amber line quoting it in
  full *and*, directly underneath, the card holding the same sentence. The card
  is the only surface for it now, and it carries the "keep or forget it on the
  Memory screen" action on its face. A memory that was **forgotten** still gets
  a line, because a card read from the memories that exist cannot draw one that
  is gone.

## 0.96.0 - 2026-09-13

- **A reviewer is shown what the teammate SAID.** Asking for a review of a
  piece of research got back "That did not happen… the work is missing
  entirely" — about a full page of analysis that was on screen the whole time.
  The brief carried the files a turn changed and the commands it ran and never
  its reply, so work whose deliverable is an answer looked like nothing at all.
  The reply now leads the brief, a turn that changed nothing says so as a fact
  about the kind of work rather than as two absences, and the reviewer is asked
  about the work rather than about "the change".
- **OpenCode's plan shows its progress.** It keeps a three-step plan and
  updates it as it goes; every update was drawn as one more `todowrite done`
  row, so the plan advanced four times and no surface moved. It is now the same
  live step list every other runtime gets. A run with no plan still gets none.
- **Every chat follows the newest line, and offers a way back down.** The
  conversation already followed; rooms did not, so a post to several teammates
  grew under you. And nothing anywhere offered the way back once you had
  scrolled up to read — there is now a small control for it, for exactly as
  long as you are away from the bottom.
- **A room says who is still working.** It could read "2 asked · all answered"
  while both teammates were still running, because they had spoken. Speaking is
  not finishing, and the line now says so.
- **A file in a room reads the same as it does in the conversation** —
  `README.md`, not its whole absolute path.
- **The permissions panel stops explaining Codex to other runtimes.** The
  footer describing `codex exec` approvals appeared under every runtime's
  allow-list, including runs it had nothing to do with.

## 0.95.0 - 2026-09-13

- **Tables are drawn as columns.** Teammates write them constantly — a quarter
  against a quarter, one name against another — and the thread printed the
  pipes. They now come out as a real table, with the figures lined up under
  each other and its own sideways scroll when it is wider than the
  conversation.
- **`---` is a divider and `>` is a quote**, rather than three hyphens and a
  chevron.
- **A reply is set in Anthropic Serif.** Anthropic publish the family and its
  own guidance is that the serif carries body copy while the sans is for
  chrome — so the teammate's voice is the serif, and the app keeps Geist and
  Geist Mono for everything that is the app talking. The whole of a reply
  wears it now, not only its paragraphs: lists, headings, tables and quotes
  had been falling back to the app's own face mid-answer.

## 0.94.0 - 2026-09-13

- **The ".cursorignore hides this folder" warning only appears when a read is
  actually refused.** It used to greet every Cursor run in such a folder,
  whether or not that run ever opened a file — true, inapplicable, and
  unavoidable, an amber line above every exchange. It now waits for the
  refusal it explains and arrives beside it, once per conversation. A teammate
  that only searches the web never sees it at all.

## 0.93.0 - 2026-09-13

- **The permissions panel told you the opposite of the truth on an Auto run.**
  It called a full-access run "workspace-write" and listed "deny: anything
  outside the workspace" — which is exactly what Auto allows — while the
  conversation header two inches away said "may edit anything on this
  machine". It now has three states instead of two, takes its wording from the
  same function the header uses, and says plainly that an Auto run may write
  anywhere and run any command your account can.
- **Six internal checks were measuring nothing.** They looked for parts of the
  screen that had been removed, and passed because the old styling was still
  in the stylesheet. The check that was meant to prevent that counted a
  leftover style rule as proof the app could still draw it; it now only counts
  what a component actually renders.

## 0.92.0 - 2026-09-13

- **A teammate's whole turn stays in the room.** Their progress appeared as
  they wrote it and then vanished the moment they finished — the room kept
  only the last message, so three quarters of what was said disappeared at the
  end. Opening the same conversation showed all of it. Everything they said is
  now in the room, in order.
- **The task board is a plan, not a dashboard.** Every row carried a state
  tag, the text, an owner, and four buttons — six things competing on one line
  for a list of two. It reads like the plan card now: a tick or a dot for the
  state, the text struck through when it is done, the owner as one quiet note,
  and the same "1 of 2 done" the plan uses. Assign, Done and Remove are still
  there and appear when you reach for a row.

## 0.91.2 - 2026-09-13

- **The ".cursorignore hides this folder" warning is said once per folder, not
  on every run.** It is a standing fact about your machine — as true on the
  tenth mission as the first, and it cannot change while the app is open
  without you editing the file it names. Repeated, it became one amber line
  per teammate per post and the loudest thing in a room, about something you
  had already read. It still says the rule, the file and the fix, the first
  time a folder needs it.

## 0.91.1 - 2026-09-13

- **A room no longer fills with "Unhandled Cursor record" lines.** Cursor
  announces a web search or a web fetch on two channels, and Locust already
  draws one of them as a proper tool row — the other was being reported, once
  per record, as something it did not understand. Two dozen identical amber
  lines could bury a conversation and made a working teammate look broken.
  The duplicate is ignored; the search still shows up where it belongs, in the
  turn's work.
- And when Locust really does meet a record it does not know, it says so
  **once** for that run rather than once per record. That a version sends a
  kind we do not read is a fact about the stream, and repeating it does not
  make it truer.

## 0.91.0 - 2026-09-13

- **A teammate now reads your question last, not first.** The brief was built
  the wrong way round: your words at the top, then the roster, the memory and
  the block formats — so the last thing a teammate read before answering was
  boilerplate rather than what you asked. It now leads with the standing
  things and ends with the question.
- **That should also make missions cheaper.** Providers reuse a cached copy of
  a prompt's opening when it does not change; ours changed at the front on
  every turn, so none of it could be reused. The opening is now identical from
  turn to turn — about 1,700 characters of it, more when memory is fuller.
- Plan mode is the one exception and stays as it was: its "change nothing this
  turn" instruction is still the last thing read, because a promise the app has
  to keep outranks a general rule about ordering.

## 0.90.0 - 2026-09-13

- **Your team's memory no longer takes over every brief.** Every memory the
  app had was sent to every teammate on every turn. Measured on a real store:
  56 memories came to about 3,700 tokens, against 900 characters for
  everything else — so most of what a teammate read before your actual
  question was old notes, and you paid for it on every turn of every mission.
  It grows, too: the app keeps up to 400.
- A brief now carries the most useful two dozen — this folder's before
  everywhere's, newest first — and **says how many it left out**, so a
  teammate that needs an older one can ask rather than quietly working from a
  shortened list. The same conversation went from ~3,700 tokens of preamble to
  ~1,500.
- Nothing is forgotten. Every memory is still kept, still on the Memory
  screen, still editable.

## 0.89.0 - 2026-09-13

- **A room shows the whole of what a teammate did, in the chat.** Each
  teammate's answer was a little card in a grid showing their LAST message and
  nothing else — so a teammate who said three things showed one, and their
  thinking, tool calls and plan were not drawn at all. That is the "missing"
  part you could glimpse while it loaded. A room now renders the same thing
  the conversation does, one per teammate: every message, the work fold with
  its commands and files, the plan and how far through it is, and the live
  line while it is still going.
- **No boxes.** A teammate talking is not a card anywhere else in the app, and
  it is not one here. They stack down the page in the order they replied —
  whoever answered first is first — under a quiet rule that groups each
  teammate's turn.
- Side by side was also what forced the summary: a 280px column cannot hold a
  work fold and four messages. Stacked, each teammate gets the width the
  conversation has.

## 0.88.1 - 2026-09-12

- **The receipt says what it verified.** It ended with a green `verified`
  beside `COMPLETED`, which reads as an endorsement of the work. It has never
  meant that — it means the record of the mission is whole and recovers — so
  it now says `ledger verified`, the same words the Missions screen has always
  used for the same fact. A finished turn that did the wrong thing can have a
  perfectly intact record, and nothing on this screen should suggest otherwise.

## 0.88.0 - 2026-09-12

- **Conversations recorded before the doubling was fixed now read correctly
  too.** 0.85.0 stopped a Cursor reply saying itself twice, but every
  conversation already on disk still held the doubled text — and a record is
  only ever added to, never rewritten. So the reader repairs it instead: a
  passage that restates exactly what the message has already said is that
  message ending, not twice as much of it, and whatever follows is the next
  reply rather than more of the same one.
- Measured on a real conversation: one 2,872-character block that began by
  saying its first sentence twice becomes the 88-character note it started
  with and the 2,696-character answer that had been stuck to the end of it.
  Nothing on disk changed.

## 0.87.1 - 2026-09-12

- **Fixes a serious bug in 0.87.0: a Cursor run in a folder `.cursorignore`
  hides recorded nothing at all.** The warning 0.87.0 added was written into
  the mission's record, and the record requires its events to be numbered
  without gaps — so the warning took a number the run was going to use, and
  everything the run did afterwards was refused. Two teammates would do real
  work and be reported as having written nothing back, and the conversation
  ended with "the mission ledger could not be written". The warning is now
  shown without being recorded, which is also the truer place for it: it is a
  fact about this machine right now, not about what the mission did.
- **And the warning's advice made sense.** It could tell you to change a rule
  into itself. When the rule is already narrowed it now says to add the one
  line that lets the folder back in.

## 0.87.0 - 2026-09-12

- **A Cursor teammate now says when it has been told not to read the folder.**
  Cursor obeys `.cursorignore`, and its tools refuse an ignored file with
  "permission denied" and no reason — so the teammate invents a reason, and
  the invention is what you read. It happened three times on one machine, the
  last of them to a screenshot Locust itself had just written into the
  workspace it then handed over. Locust reads the rule first and names it:
  which file, which line, and what to change it to.
- Nothing is changed on your behalf — the rule is yours, and the folders these
  rules cover are usually excluded for a good reason.

## 0.86.0 - 2026-09-12

- **The app tells you where your connectors live.** Locust reads your
  connectors from Claude Code, and only a teammate on a Claude Code route gets
  them — which it had never said anywhere. On any other route the mode menu
  now names that plainly. It does not claim the other route has none: Cursor
  has its own, signed in separately. That silence cost a whole evening of
  chasing a Robinhood connector that was signed in on Claude Code and could
  never have worked on Cursor.
- **A room's task board says whose each task is, from your teammate's side.**
  A row read `(Yurt)`, which left every teammate to work out whether that name
  was their own — so both members of a two-person room started the same task.
  Rows now read `(yours)`, `(Yurt's)` or `(unassigned)`, and a teammate is
  told plainly that somebody else's row is not theirs to take.

## 0.85.0 - 2026-09-11

- **A Cursor reply no longer says itself twice.** Cursor streams a reply word
  by word and then sends the whole message again to mark it complete. Locust
  recognised that closing message by a field Cursor has stopped always
  sending — so it was appended as if it were new text, and the reply read
  "…hand the numbers to Yurt for his take.Looking up NVIDIA forward
  earnings…". It is now recognised by what it says, which is not something a
  version can stop sending.
- **And a teammate who wrote a reply is no longer reported as having written
  nothing.** That was the same bug, and the worse half of it: the message was
  never marked finished, and everything the app reads out of a reply — a
  message to another teammate, something remembered, a task claimed, a post
  to the room — reads the finished one. So a reply that was plainly on screen
  could be announced as "the runtime finished and wrote nothing back".
- Separate replies in one turn are also kept apart again, instead of being
  run together into a single block of text.
- **The line under a room's message box is quiet now.** It narrated the task
  board back at you — "Jimothy took on X. Jimothy finished X." — directly
  under a board already showing exactly that, and when it had no news it fell
  back to a standing sentence. It now speaks only when a post is in flight or
  something was refused.

## 0.84.0 - 2026-09-11

- **Your Cursor connectors work in Locust.** A connector configured in
  `~/.cursor/mcp.json` is approved in Cursor by answering a prompt — and a
  Locust run has nobody to answer it, so the prompt was resolving to "no" and
  every connector call failed. Measured against a real configured server:
  `Failed: user rejected MCP`. That is a rejection, not a sign-in problem,
  which is why the same connector worked in Cursor's own app and not here.
- Locust adds no connector of its own and reads no credential. What a
  teammate can reach is exactly what their CLI was already set up to reach.

## 0.83.0 - 2026-09-11

- **Text is no longer eaten from the beginning while a teammate is writing.**
  0.82.0 fixed this for a conversation you reopen; this fixes it as it
  happens. The same limit existed in two places, and the second one is the
  one you watch: a long reply pushed its own beginning out of view while it
  was still being written, then snapped back to the whole thing when the run
  finished. Both places now join a reply back together as it arrives.
- **Room posts are shown whole.** The fold past twelve lines and its
  "Show the rest" are gone — a room is where teammates argue in front of you,
  and the argument is the content.
- **Routes read like names.** `Cursor Agent / cursor-grok-4.6` is now
  `Cursor / Grok 4.6`, in the composer, the sidebar and the conversation
  header. The exact model id is still in the receipt and in every tooltip,
  which is where you go for a string to copy.
- **One control at the top of a conversation instead of four.** Ask for a
  review, Save as routine and Delete moved into a `⋯` menu; Activity stayed
  out of it, because it toggles a panel. Delete still asks before it acts,
  in the menu, exactly as it did as a button.

## 0.82.0 - 2026-09-11

- **A long reply is no longer cut off at the front.** Reopening a conversation
  could show an answer that began mid-sentence and looked complete — no
  ellipsis, nothing to say anything was missing. Measured on one real
  conversation: the record held 4,853 characters and 1,954 reached the screen.
  Every character is there now.
- Why it happened, because it is worth knowing: a reply arrives in hundreds of
  small pieces, and the limit on how much of a conversation gets loaded was
  counting those pieces as if each were a separate thing that happened. It kept
  the most recent few hundred, which is the END of the reply. The pieces are
  joined back into the message before that limit is applied.
- Long conversations also open faster, because one reply is now one thing to
  load instead of a thousand.

## 0.81.0 - 2026-09-11

- **You find out an exchange stopped, even if you were looking elsewhere.**
  "Stopped after 12 automatic replies" reached the window and nowhere else, so
  anyone watching a different conversation when it fired never learned — and
  reopening the thread later showed nothing, so the exchange simply appeared
  to stop for no reason. Endings are written into the mission's own record
  now, and are there when you come back.
- Only **endings**. "Still waiting on Booty" is true for a moment and false
  after it, and a record of it would be a record of something that is no
  longer so.

## 0.80.0 - 2026-09-11

- **The reply budget counts what it always claimed to.** It counted the depth
  of one chain, and an exchange is not one chain — a reply held for a busy
  teammate starts later on its own branch, so every decision could be inside
  the budget while the total was outside it. Measured: seven automatic runs
  against a budget of six. It counts the whole exchange now, and never less
  than the chain already proves.
- **And the budget is a backstop again, not a timer.** It was six, and six was
  firing as the ordinary way an exchange ended — five runs of a one-word
  question went 6, 6, 3, 6, 7. Now that teammates actually stop when they are
  done, it is twelve by default and up to twenty-four, which you should never
  meet while the work is real.
- A meeting's reply-back also respected a built-in number rather than the one
  you chose in Settings. It respects yours.

## 0.79.0 - 2026-09-11

- **Teammates stop thanking each other.** An exchange is meant to end when a
  reply has nothing more to say; measured across five runs of a question whose
  answer is one word, it ran to the budget four times out of five. The brief
  told a replying teammate "write back only if that helps finish the work",
  which a polite model reads as permission. It now says the plain fact: the
  other end is a **model, not a person**, every reply starts another whole
  billed mission, and thanking, confirming receipt or summarising what you
  both agreed reaches nobody and costs a run each.
- A relayed brief also says where in the budget it is — *"This is automatic
  reply 3 of 6"* — and on the last one, that anything sent back waits for a
  person rather than reaching them, which is what actually happens.

## 0.78.0 - 2026-09-11

- **Ask another teammate to review a finished mission.** A new action on any
  completed conversation hands it to a teammate of your choosing, with what
  you asked for, what changed, what ran and its exit codes, and where it ran.
  A teammate cannot see another's conversation, so the facts have to travel.
- The brief **makes no claim that the work is done or correct** — telling a
  reviewer it passed and then asking it to check is handing it the answer. It
  also says plainly: report, do not fix; and if the work is fine, say so
  and stop.
- Tested with the answer hidden: a builder was asked for two files, then told
  in a follow-up to delete one and not mention it. The reviewer is shown only
  the original request, and found it — *"notes.test.md was never created, the
  only recorded action was deleting it."*

## 0.77.0 - 2026-09-11

- **The context ring is back, beside the route it belongs to.** It had moved
  to the mission header, where a run whose runtime reports no context window
  left nothing at all — so it read as gone. It sits immediately left of the
  model picker now, and in one place only.
- **The attach `+` is a `+` again, not a chip.** The other controls on that
  row are modes — permission, folder, route, effort — and a chip is the right
  shape for something that shows what is currently set. Attaching a file sets
  nothing.
- **A turn no longer grades its own commands.** `ran 4 commands · all exit 0`
  shipped yesterday and was the one place on that line where the app
  aggregated four facts into a verdict — "all" plus "0" is about as close to
  *passed* as you get without typing it, and a reader who took it that way was
  not misreading. It names them instead: `ran pnpm check, tsc and 2 more`. A
  command that failed is unchanged: that one is news, and it stays amber.
- **The receipt says what a run ran ON.** `Ran on Windows · locust-astra`,
  beside the runtime it already names. It is the one thing in this space
  knowable with certainty — a run happens on one machine, in one environment —
  and it tells a person who changed a path handler everything a "this did not
  test macOS" warning would have, while telling someone who changed a copy
  string nothing, which is correct.

## 0.76.0 - 2026-09-11

- **"Build this plan" no longer sometimes starts a stranger.** Clicking it
  while the plan run was still settling recorded the build turn with no link
  back, so it began a fresh conversation instead of following the plan it was
  offered from. Intermittent by construction — a run's last event lands on the
  next frame, so for a few tens of milliseconds the window had not heard that
  the mission was over. The host settles it now, and settles it stricter.

## 0.75.0 - 2026-09-11

- **A finished turn says what it ran, not only what it changed.** The line
  read `3 files` or `no files changed` and never mentioned the commands — so a
  run that edited three files and a run that edited three files and proved
  them looked identical. It now reads `ran 3 commands · all exit 0`, or names
  the one command when there was only one. A command that exited non-zero, or
  that never reported at all, is said in amber.
- Deliberately **no guess about what a command means**. Nothing here decides
  that `pnpm test` is a test and `ls` is not; it says what ran and what came
  back, and you decide whether that is evidence. An app guessing at proof
  would be worse than one staying quiet.

## 0.74.0 - 2026-09-11

- **The effort slider agreed with nothing.** It read `EFFORT high`, put the
  knob hard left against "Faster", and said "slower, costlier" underneath —
  three statements about one value. Cursor does not list its models low to
  high (`cursor-grok-4.6-high-fast` comes before `cursor-grok-4.6-low`), and
  the scale was built in listing order, so `high` landed at position one. The
  scale is sorted now, and a level this build has never seen still keeps the
  runtime's own order.
- **A Cursor route stated the wrong effort, and ran at it.** A teammate saved
  on `cursor-grok-4.6-high` read as `medium` — the effort in the model name
  was dropped and a default put in its place. The name says which level it is;
  the app now reads it.
- **"Already has a mission running" no longer eats your message.** Sending a
  moment too early marked the turn failed, drew a red "The run could not
  continue", and threw away what you typed. It is not a failure — it is "not
  yet" — so the message waits behind the run in front of it and goes when that
  one finishes, which is what sending it meant.
- **Changing the folder no longer looks like a crash.** It reopens Locust —
  every service binds its folder at start-up — and that sentence was behind a
  fold nobody opens, with the window vanishing before the "Reopening in …"
  notice could be read. Both fixed.

## 0.73.0 - 2026-09-11

- **A reply comes down the thread instead of lurching.** Measured on a real
  400-word answer: the thread used to move on 26 of 1361 frames, with 47% of
  the whole journey in five of them and one single jump of 221px — a third of
  a screen at once. It now walks: 123 moving frames, a biggest jump of 17px,
  and 9% in the worst five. The text is on screen the moment it arrives; the
  page just takes a few frames to walk to it. Opening a conversation still
  jumps, and "reduce motion" still snaps.
- **A room shows what a teammate is doing, not just that they are.** A live
  turn in a room drew a flat "Gem is replying…" while the thread two clicks
  away animated and named the tool. It is the same line now, in both places —
  the register, the animated dots, the tool or connector, and the clock.

## 0.72.1 - 2026-09-11

- **A connector call is named as one even without the `mcp__` prefix.** A
  Google Drive call read as `using a tool · Google_Drive__create_file` — an
  ordinary tool with a strange name. Every connector name this app had been
  shown carried the prefix, so the split required one; this one does not.
  Ordinary tools are untouched: none of Read, Write, Bash, Grep, Task or
  WebFetch carries a double underscore, which is the whole safety of the rule.

## 0.72.0 - 2026-09-11

- **The Missions screen shows what is happening now.** It listed only recorded
  missions, and a mission reaches the record when it finishes — so the one
  screen whose job is "what is going on" was the last place to hear about it.
  Measured: for 49 straight samples a teammate was visibly working in the
  sidebar and this screen was empty. Live runs are listed as they run.
- **A live mission says RUNNING.** It wore INTERRUPTED, which is the right
  reading of a record with no ending and the wrong word for a run still going.
  The screen knew; the row never asked.
- **Each row says what it is doing, or what it wants.** Under the title:
  `using a tool · Read` while it works, `Pending: …` when it stopped to ask
  you something, and nothing at all once it has settled — so a list of twelve
  tells you which one to open without opening them.

## 0.71.0 - 2026-09-11

- **A teammate can ask to be taken now.** A message that arrives while its
  recipient is working normally waits for their run to end — usually right,
  sometimes far too late, because the message worth interrupting for is "stop,
  I'm editing that file". A sender can now mark one urgent, and with the new
  Settings switch on, that stops the recipient part-way so the message is
  their next one. Off until you turn it on: it throws away whatever they had
  in flight, and their unfinished work stays in their own conversation. The
  budget and the replies switch still bound everything — an interruption only
  ever shortens a wait, it is never a second way to start work.
- **A long tool step no longer swamps the live line.** Claude Code packs a
  subagent's type, its description and its last tool into one message, and a
  search pattern in the description wrapped the line onto two rows. It is one
  line again, and the runtime's word for the kind of step is gone — the
  register already says it, in words you'd use.

## 0.70.0 - 2026-09-11

- **You can tell your teammate talking from the app narrating.** Every live
  line now says whose it is and which register it is — `Jimothy · thinking`,
  `Jimothy · using a tool`, `Jimothy · using a connector · Robinhood` — and
  that word is derived from what the run is actually doing, never from what
  the runtime called it. A connector is named as one, because it is the one
  kind of call that reaches off this machine.
- **A tool call shows while it is happening, not only after.** Claude Code
  reports no step for a tool call, so a run that spent thirty seconds reading
  files just said "working"; the open tool is now what the line says, and it
  names the file or the connector it is working on.
- **A room stops going quiet mid-argument.** A reply the host is starting is
  drawn as the turn it is, and so is a turn that is running but has not spoken
  yet. Before, both were invisible for as long as a cold runtime takes to
  boot, which reads as the conversation being over — and the budget line no
  longer says "post again to continue" while a reply is on its way.
- **Posting to a room is immediate.** The box empties when you press Post and
  the post appears at once, instead of holding your words under a "Posting…"
  until every teammate has been asked. If the post genuinely fails, your words
  come back.
- **The room's top bar has a shape.** Back on the left, the room's name with
  its members on a line under it, Remove room alone on the right — instead of
  three unrelated things clumped together in the middle.

## 0.69.0 - 2026-09-11

- **Two teammates can now actually argue.** If you post to a room and both
  answer at once, each one's message used to arrive while the other was still
  working — and a teammate takes one mission at a time, so the relay gave up
  and the argument died before it started. A message that lands mid-run is now
  held and delivered the moment that run ends. The room says so while it
  waits: *is part-way through another mission. Their reply starts when it
  ends.*
- **The room shows the whole argument, not half of it.** A post starts one
  mission per member, and a reply is a new conversation of its own, so an
  argument that began on both sides at once was two halves — and the room drew
  whichever half was bigger, silently dropping somebody's opening. It now
  draws every turn, in the order they were said.
- **A teammate reads the same in a room as in a thread.** A room drew literal
  `**asterisks**` and hyphens where the mission thread drew bold text and a
  list; it now uses the thread's own reader. And a turn no longer opens with a
  gap where a stripped share block used to be.
- **Posting to a room uses the same box as everywhere else.** The wide filled
  *Post* button under the field is gone; the field and the round send control
  are the ones you already know from a mission.

## 0.68.0 - 2026-09-11

- **A teammate runs on the route you gave it, even in the first seconds after
  launch.** While Locust was still finding your runtimes, a message sent
  straight away could start on whichever one happened to be ready first -- a
  teammate set to Codex CLI running on OpenCode, and failing. Its own saved
  route decides now. Changing the model in the bar still wins, and a
  conversation with no teammate is unchanged.

## 0.67.0 - 2026-09-11

- **A conversation in "approve each action" continues.** A reply used to
  start over with no memory of the turn before it -- ask a teammate to
  remember a word and it could not tell you the word. It keeps the thread now,
  like every other mode.
- **Routines, room posts and relayed messages can use "approve each action".**
  All three used to refuse it outright, because the cards could not be shown
  from those paths. They run it, and the cards appear.
- Under the hood the mode stopped being a separate machine and became an
  ordinary mode of the one that runs everything else, which is what made both
  of the above possible.

## 0.66.1 - 2026-09-10

- **Approve-each conversations continue.** A second message to a teammate in
  Approve-each was refused with "The approval-capable runtime could not be
  started" while the sidebar showed the teammate idle: a finished turn was
  never let go. Four of them would have filled the pool and refused every
  mission until a restart. A finished turn releases its run now. The reply
  still starts without the earlier turn's memory on this mode; that is next.
- **What a runtime says about itself is no longer dressed as a command's
  output.** Notices like "Skill descriptions were shortened" sit in the fold's
  footer behind a hairline, labelled with who said it, and in the quiet tone:
  amber is for things you can act on, and there is nothing to act on there.
- Reply prose is capped at 90 characters of its own face with a little more
  leading; the receipt's value column and tool rows no longer stretch across
  a wide window.
- In the sidebar, the role never takes the state's colour, and a conversation
  row inside a selected card no longer gets a second highlight.

## 0.66.0 - 2026-09-10

- **Replies fit the window they are read in.** A reply used to sit at a fixed
  width in the app's smallest type, using a little over half the column it
  already had. It now fills that column, at a larger size meant for reading
  rather than scanning, and on windows wider than about 1650px the column
  itself grows with the window.
- **Stop works on the second turn of a conversation.** Pressing stop while a
  turn was still starting did nothing at all, silently, and the mission ran to
  completion. It is now remembered and takes effect the moment the run can be
  named. A first turn always worked, which is why this went unnoticed.

## 0.65.1 - 2026-09-10

- **The home screen is addressed to nobody again.** The row of teammate
  chips is gone from the composer, and with it the teammate it used to tick
  for you before you had picked anyone. Write and send from the home screen
  and you get a plain conversation on the model the bar shows; hand it to a
  teammate afterwards with "Assign to ..." on its row, or pick a teammate in
  the sidebar first and message them directly.
- Picking several teammates at once lives in rooms, where it always did:
  "New room" in the sidebar, and the room's form picks its members.

## 0.65.0 - 2026-09-10

- **Codex replies stream now, in every mode.** A Codex teammate used to
  think in silence and then drop the whole reply in one paint; only
  Approve-each streamed. Ask, Accept edits, Plan and Auto now run over the
  same transport Approve-each always used, and the reply arrives as it is
  written -- measured 2 paints before, 33 after, on the same prompt.
- A Codex run's header shows what it cost again (`40k in · 275 out`), and
  counts up while it runs. Approve-each never showed this and does now.
- Follow-ups on Codex keep the earlier turns, as before.

## 0.64.0 - 2026-09-10

- **A teammate can be limited to some of your connectors.** Open a teammate
  and under "Works in" there is now a row of your connectors, all on. Untick
  one and that teammate is limited to the rest: a Finance Bro gets Robinhood
  and not Gmail. A call to anything outside its list stops and asks you, the
  same card as before. Nothing ticked means everything, as it always did.
- The refusal a teammate reads after you deny a connector no longer claims
  there was no way to ask you.

## 0.63.1 - 2026-09-10

- **Settings → Connectors: "ask before every connector call".** Off, a
  teammate uses any connector your Claude Code can reach without asking, as
  before. On, every connector call stops the run and shows you the exact
  input first, with Approve once, Always allow this session, and Deny. Takes
  effect on the next mission; Auto never asks either way.

## 0.63.0 - 2026-09-10

- **A Claude Code teammate asks before using a connector nothing has
  pre-approved.** The same approval card as Codex — *Use get_watchlists on
  Robinhood*, what is sent, whether it can be undone — with Approve once,
  Always allow this session, and Deny. "Always" lasts for that connector until
  the mission ends. A denial reaches the teammate with your reason.
- Your own connectors still never ask, as before. This is for the call that
  no rule covered.
- The approval card names the runtime that is asking instead of assuming
  Codex.

## 0.62.2 - 2026-09-10

- **The message-box row is one family of controls.** The `+` and the swarm
  mark are boxed like their neighbours, and the context ring moved to the
  mission line in the header, beside the cost it belongs with.
- **Lime means one thing again.** A selected teammate's card and its open
  conversation sit on the neutral selected ground; lime is kept for what is
  happening right now. In the sidebar, only the state word — *thinking*,
  *done* — takes the colour; the role stays quiet.
- The header no longer says `Starting…` while the thread says it too.
- The Rooms section folds and counts like Teammates and Routines, and its
  door just says `New room` instead of a sentence the rail cut mid-word.

## 0.62.1 - 2026-09-10

- **Replies stream smoothly.** Text used to arrive in jolts and, worse, change
  shape after you had read it - a sentence turning bold, a paragraph becoming
  a code block - because every token re-rendered and re-parsed the whole
  reply. Now tokens land once per frame, and formatting is applied only to
  what has finished arriving; the part still being written is plain until it
  settles, the way Claude Code does it. Measured: zero changes to already-shown
  text across a whole streamed reply.
- The plan for what comes next is written down in `docs/PLAN-2026-09-10-NEXT.md`.

## 0.62.0 - 2026-09-10

- **Ask several teammates at once, from the message box.** Tick a second name
  and the post fans out; the room is where the answers land. Nobody has to
  know rooms exist to make their first one. The box says what sending will do
  before you press it.
- **A room made that way starts as "Untitled room" and is renamed from the
  room** — click its title. Naming it up front was most of why nobody made
  one.
- **Replies are easier to read.** A teammate's reply now runs about 73
  characters a line instead of 111, with more space between lines. Past
  about 85 the eye loses its place on the way back, and it felt "clunky"
  without anything looking wrong.
- **Replies are set in IBM Plex Sans.** Only the reply — every label, chip
  and control stays as it was. The teammate's prose was borrowing the app's
  own typeface, which is built for 13px chips, not nine-line paragraphs.
  Bundled with the app; nothing is fetched.
- The scratch project the testing drives use no longer tells teammates to
  keep answers to one paragraph.

## 0.61.1 - 2026-09-10

- **The Automations screen is now Routines, and it shows you how to make one.**
  It used to describe a right-click. It now lists your most recent finished
  conversations with a Save on each — the actual thing a routine is made from.
- **Save as routine is on the mission header**, beside Activity, on a finished
  conversation. It was only ever in a right-click menu, which is where you look
  once you know an action exists rather than how you find out.
- **What you set up inside a CLI moved to Settings, under that runtime.** Your
  agents, commands and MCP servers are facts about Codex or Claude Code, and
  under them they need no apology — sitting on a screen that otherwise means
  "things you can run" made them read as broken.
- **Ctrl+V a file or a screenshot into the message.** A pasted screenshot has
  no file behind it, so Locust writes it into the same attachments folder the
  + button uses.
- **A teammate's memories stay visible after you reply.** Each reply is its own
  run, and the card was only showing what the latest one learned.
- **A refused command no longer prints itself into the warning.** One line, not
  a whole program; the full command is in the activity row where it belongs.
- **Cursor file rows lose their long paths again.** A Windows path was being
  flattened with one separator left in, so Locust stopped recognising its own
  mirror folder.

## 0.61.0 - 2026-09-10

- **Your teammates can now use your connectors, in every mode.** Whatever your
  Claude Code can reach, they can reach — no list to set up. Driven and
  verified in Accept edits: the row reads `get_watchlists · Robinhood · done`
  and the teammate answers with the number.
- **Worth knowing, and the permission chip now says it:** a connector is not
  on this machine. "Ask · every write is refused" is a promise about *files*.
  A teammate in Ask can still send mail or place an order through a connector,
  because no sandbox here reaches the far end of one.
- **A refused tool is named the way you would say it.** It read
  `mcp__claude_ai_Robinhood__get_accounts`; it now reads `get_accounts on
  Robinhood`, and the reason it gives is one you can act on rather than a
  sentence about running commands.
- A connector you sign into after Locust is open reaches the next mission
  without restarting anything.

## 0.60.1 - 2026-09-09

- **Correction to what 0.60.0 told you about connectors.** It said they were
  off in every mode but Auto because those modes ignore your Claude settings.
  That reason was wrong — those modes never blocked your MCP servers — and
  Locust was blocking them itself. That block is gone.
- **What is actually true, measured:** Claude Code asks before using a
  connector, and a mission has no way to put that question to you outside
  Auto, so the call is refused there. The difference is that you now see the
  refusal — `get_watchlists · Robinhood · failed` — instead of the teammate
  improvising "I have no connection to that", which read as a broken
  connector. The permission chip says which mode can and which cannot.
- Per-connector permission, so a teammate can use one connector without being
  given the whole machine, is next.

## 0.60.0 - 2026-09-09

- **A teammate can work in its own folder.** Open a teammate, and under Own
  branch there is now a "Works in" row. Its missions run there instead of the
  project folder, and nothing else moves: the app does not reopen, your
  history and what the team remembers stay with the project. This is also how
  a teammate reaches an MCP server you registered to one folder — Claude Code
  keeps those per project, so a connector set up in `C:\Users\you\claude`
  exists in that folder and nowhere else.
- **The mode now tells you when it has taken your connectors away.** Only Auto
  runs a Claude Code teammate with your own settings, so only Auto can reach
  an MCP server. Every other mode now says so on the permission chip instead
  of leaving the teammate to answer "I have no connection to that", which
  reads as the connector being broken.
- **Changing the project folder no longer closes Locust.** It reopens there,
  as it always meant to. A runtime whose process ignored the shutdown could
  leave the app with no window and nothing to come back to; the quit now has
  a time limit and leaves anyway.
- **A teammate no longer reports a message to itself as a missing teammate.**
  "Jimothy addressed a message to Finance Bro, who is not on the roster" —
  where Finance Bro was Jimothy's own role. A teammate can now be addressed by
  their role as well as their name, and a message addressed home says that.
- **The teammate dialog said "Ask · every write refused" while the composer
  was in Auto.** It now names the mode the next mission will really run in.
- **The Automations screen has its header back.** Its title had been sitting
  flush against the window edge, with none of the bar every other screen has.

## 0.59.0 - 2026-09-09

- **Your connectors now reach your teammates.** In Auto mode a Claude Code
  teammate can use the MCP tools you have connected — Locust was blocking all
  of them, so a teammate would say the connector was not available and there
  was no way to tell that we had refused it rather than that it was broken.
  The other modes cannot reach connectors at all, because they deliberately
  ignore your Claude settings.
- **A connector call reads as one.** It appeared as a single machine name like
  `mcp__claude_ai_Robinhood__get_watchlists`; it now shows the tool and the
  connector it belongs to, the same way every other tool row does.

## 0.58.0 - 2026-09-09

- **A room post now has one line at the top telling you where it stands.**
  "8 asked · all answered", or "8 asked · 6 answered · Otto running · Sable
  failed" — names when one or two are in a state, a number when more are.
- **And the members as a row of faces beside it.** Click one to jump straight
  to that teammate's answer instead of scrolling for their name. Anyone still
  waiting for a slot appears there too, dimmed.
- **A long answer folds by how tall it is, not by how many line breaks it
  has.** A three-paragraph reply has two line breaks, so it was never folding
  — it just looked right against answers that were one line per number. The
  control now reads "Show the rest".

## 0.57.1 - 2026-09-09

- **Shift+Tab cycles the permission mode.** The mode is the difference between
  a teammate that only explains and one that edits your files, and reaching it
  meant opening a menu every time. It steps only through the modes the
  selected route can actually run.

## 0.57.0 - 2026-09-09

- **The up arrow brings back what you last sent.** Press it on an empty
  message box to get your previous message, again to go further back, and
  down to return to the empty box. Handy for sending the same thing with one
  word changed.
- **Escape stops a running mission.** From the message box, when no menu is
  open.

## 0.56.2 - 2026-09-09

- **Commands your teammate ran now show as commands.** Only one of the
  runtimes was recognised as running a shell, so on Claude Code and OpenCode
  every command appeared as a plain tool row — no result badge, nothing to
  open, and left out of the "commands" count in the turn summary.
- **Correction to 0.56.0.** That release said command rows read as what the
  teammate was doing "where the runtime reports it — Claude Code and OpenCode
  do". The row it appears on did not exist on either of those runtimes, so
  nothing changed on screen; it should work on Claude Code now. On OpenCode it
  is still unconfirmed — we have not seen it send that description at all.

## 0.56.1 - 2026-09-09

- **A room shows its work as it starts.** Posting to a room started everyone
  in turn and only then drew any of it, so you watched an empty room while
  teammates were already working — up to 45 seconds of it. Cards now appear as
  each one begins, with the rest shown waiting for a slot underneath.
- **A teammate in a room is now told its own name.** The briefing listed
  everyone else in the room and never named the recipient, so a teammate asked
  to write to its own file could not tell which name was its own — and wrote
  nothing.

## 0.56.0 - 2026-09-09

- **A room now asks everyone, even when it cannot run them all at once.** Only
  eight missions run at a time, so posting to a full room while other work was
  going left some members simply never asked — no answer, no record, nothing
  the next day to show they had been included. They now wait in line, shown as
  "Waiting for a slot", and start on their own as slots free.
- **"Everyone has answered" waits for them.** It used to be true of whoever
  happened to start.
- **A long answer no longer takes the whole room.** Twelve lines, then "28 more
  lines" to open the rest. One teammate writing at length was pushing every
  other answer off the screen.
- **Past six answers, a room lays them out one per line.** In a grid every row
  is as tall as its longest answer, so two short replies beside a long one were
  paid for in blank space.
- **Command rows say what the teammate was doing, not just what it ran.** Where
  the runtime reports it — Claude Code and OpenCode do — the row reads "Checked
  what the app says about the free route" rather than a shell pipeline. The
  command is still there, one press away.
- **Ticking a ninth teammate into a room says so.** The picker offered everyone
  and then refused the room when you pressed Create room.

## 0.55.3 - 2026-09-09

- **Right-click menus work again.** Pressing any item in a right-click menu
  closed the menu before the press registered, so nothing in it ever ran —
  Delete, Assign to, Copy mission id and Save as routine were all dead. The
  Delete button at the top of a conversation was unaffected, which is what
  made this look like a delete problem rather than a menu one.

## 0.55.2 - 2026-09-09

- **Menus close when you click anywhere else.** The permission mode menu, the
  effort panel and the model picker all stayed open until you pressed the
  button that opened them a second time. Clicking away now closes them, and
  Escape still does too.

## 0.55.1 - 2026-09-09

- **The "Get it" links now open.** Cursor, Antigravity and Node.js each offered
  a link to where you get them, and none of them did anything — in every build
  that had them. They looked like links, and clicking one was silent. Found by
  the first person outside this machine to install Locust.
- **A greyed-out Install button now says why on the screen.** With no Node.js
  installed, four of the five runtimes cannot be installed at all, and the
  sentence explaining that disappeared the moment any one runtime connected —
  which Codex often does by itself. What was left was a panel of buttons that
  did nothing, with the reason only visible if you hovered over one.

## 0.55.0 - 2026-09-09

- **Eight missions can run at once, not four.** The old limit of four was a
  guess: it was written as "a resource bound" and never measured. It has now
  been measured — eight teammates answering at once, each producing a long
  steady stream of output, finished in under twice the time one takes and used
  4.2 GB of memory, with nothing dropped and no run cut short. Nothing the old
  number was protecting against happened. What has not been measured, and may
  change this again, is a machine with much less memory than the one it was
  measured on.
- **A room can no longer be built that it cannot answer.** A room holds up to
  eight teammates, so with the new limit every member of a full room runs. This
  was the cause of the next three fixes.
- **A room no longer says "Everyone has answered" when some of them never
  started.** Posting to six teammates while only four could run started four,
  drew the other two as empty cards, and then told you everyone had answered.
  It now says "4 of 6 in Standup answered; 2 never started."
- **Someone the post could not reach gets a line, not an empty card.** They
  used to get an answer card with no answer in it — a name, "did not start",
  and a blank space where the reply belongs — and the reason was said in the
  smallest text on the screen, far below, repeated once per person. It is now
  one line under the answers: "Pike, Dell and Ember were not asked — up to 8
  missions can run at once."
- **And that reason no longer disappears.** It lived only in the moment of
  posting, so waiting for the room to finish, or reopening it later, left the
  absence unexplained. It is now kept with the post.
- **Ticking a ninth teammate into a room now says so instead of failing.** The
  picker offered every teammate and then refused the room when you pressed
  Create room. It now says "A room holds 8 teammates. Untick 1 to make this
  one." and does not offer the button until it would work.
- **Long answers in a room stop squashing short ones.** Past six answers the
  room lays them out one per line, so a teammate who writes twelve lines no
  longer forces everyone beside them to be twelve lines tall.
- **Warnings and errors that were meant to be amber or red were grey.** Text
  asked to be coloured lost to whatever the surrounding component had already
  set, so several notices — including a room form's own error messages — had
  been rendering as ordinary grey text.

## 0.54.1 - 2026-09-09

- **Two buttons on every teammate card were drawn on top of each other.** In a
  teammate's Routines list, "Run" and "Edit" occupied the same box and read as
  one unusable control, and the line under them was squeezed until the routine's
  next run time was cut off. The name and schedule now have their own line and
  the three buttons sit under them.
- **Locust now finds a runtime you installed into a moved npm folder.** If npm
  has been pointed somewhere other than its default — common on work machines,
  with any Node version manager, and the exact fix Locust itself suggests when
  an install fails on permissions — then the install worked and Locust reported
  the runtime as missing anyway, sending you to install something you had just
  installed.
- **The model list no longer says a model does not exist while it is still
  loading.** Opening the runtime picker and typing in the first seconds after
  launch answered "Nothing matches that", which is a claim about your search
  rather than about the list. It now says it is still reading the list.

## 0.54.0 - 2026-09-09

- **When Codex asks you a question, your answer now reaches it.** In
  "Approve each action", a question from the runtime was drawn with the same
  Approve / Always / Deny buttons as a command — and all three were the wrong
  kind of reply. Codex could not read any of them as an answer, so it recorded
  an empty one and told the model you had said nothing, whichever button you
  pressed. Questions now show what was actually asked, with the options the
  runtime offered, a box for anything else where it allows one, and a hidden
  field where the answer is sensitive. "Always allow this session" is gone from
  questions: there is no such thing for a question, so the button could never
  have meant what it said.
  This is built to Codex's published description of the exchange and tested
  against it, but **it has not yet been seen working against a live question.**
- **A plan is now the answer it is, rather than a card about a run that never
  happened.** In Plan mode the steps are the whole reply, and they were drawn
  in a bordered box with a PLAN label, a "0 of 5 done" counter and one grey dot
  per step — which read as a run stalled at step one. They are now numbered and
  set at reading size, where your teammate's replies appear, with one line
  saying that Plan mode changed nothing and how to have it done for real. The
  plan shown inside a finished run's activity is unchanged, because there the
  steps really do have outcomes.
- **Locust no longer warns that a healthy ledger is damaged.** 0.53.0 added a
  warning for records that could not be read; it counted any older mission that
  had scrolled out of the recent list as unreadable, so a perfectly good ledger
  could report "20 local · 1 file could not be read". A warning is only worth
  having if it is rare enough to believe.
- **And that warning now stays right after you delete missions.** Three places
  re-read your history and only one of them updated the damage state, so
  clearing out old missions could leave a warning on screen that no longer
  matched anything.
- **A command that printed nothing says so.** The case was added in 0.53.0 and
  could not actually be reached: "the runtime reported no output" and "the
  runtime reports output but there was none" had been collapsed into the same
  thing.
- **A failed command's last lines are easier to find.** When a command exits
  non-zero, the end of its output — where the error almost always is — is drawn
  brighter than the rest.
- **The one-line summary of a turn names the command it ran**, so `ran seq 1
  300` is on screen without opening anything, instead of "1 tool call".
- **Several borders were heavier than intended** — the attachment tile, the
  "copied in" mark, the file chip on a sent message and plain notices — because
  they named a colour that does not exist and quietly fell back to the text
  colour.

## 0.53.0 - 2026-09-08

- **Pressing `/` then down then enter no longer switches you into Auto.** The
  command menu listed `/auto` second, so the two most ordinary keystrokes after
  opening it landed on the one mode that lets a run change anything on this
  machine. It is now last, in its own marked section, and arrow-down lands on
  `/edit`. The menu is also attached to the message box instead of floating
  above it, because it is completing what you are typing.
- **A command's output no longer shouts over what your teammate said.** A
  300-line output used to draw a tall scrolling box, inside the scrolling
  conversation, above the two lines the teammate actually wrote. It now shows
  the first eight lines and the last eight, with a button between them that
  prints the rest, and one that copies all of it. The exit code moved to the
  front of the command, because it is what tells you whether the output is
  worth reading. A command that printed nothing says so on one line instead of
  opening an empty box. And the fold's summary now names the command, so
  `ran seq 1 300` is on screen without opening anything.
- **The app no longer says a ledger is verified when it could not read it.**
  Three separate ways it did. A mission whose record was damaged part-way
  through was reported correctly; a record damaged in its header, or too large
  to open, produced no mission at all, so nothing carried the damage and the
  Missions screen said "ledger verified". Worse: if the ledger folder itself
  could not be opened, the screen still said "verified" about a ledger it had
  never read. It now says how many files could not be read, or that the ledger
  could not be read at all.
- **And the card shown when a record cannot be written no longer contradicts
  itself.** It said the mission could not be created, then offered to reopen
  it. Nothing had been written. Because the record is always written before a
  runtime starts, that failure means nothing ran at all — which the card now
  says, rather than warning you to go and check work that never happened.
- **Attaching a file from outside the folder shows one thing, not three.** The
  full-width notice above the message box is gone; the file's own tile now
  carries "copied in", with the whole sentence on hover.
- **A teammate set to "approve each action" no longer runs silently without
  approvals.** Routines, room posts and relayed messages could not show the
  approval cards, so they quietly ran read-only while the composer still said
  approvals were on. All three now refuse and say why, before anything starts.
- **"Up to 4 missions at once" is now actually 4.** Three separate limits of
  four were counted separately, so twelve could run while every count on screen
  said otherwise.
- **A denied action says it was denied.** In per-action approvals, a request
  Locust did not recognise — or one arriving while sixteen approvals were
  already waiting — was refused with nothing said, so the run carried on as if
  you had pressed Deny.

## 0.52.0 - 2026-09-08

- **You can see what a command printed.** A teammate would run something, tell
  you it had printed 1,200 lines, and the row showed the command, the word
  "done", and nothing else - the output had been captured and then thrown away
  before it reached the screen. Command rows open now, showing the start and
  the end of the output with a note saying how much of the middle was left out.
  The end matters as much as the start: an error is usually the last line.
- Rows still stay closed where the runtime reported no output, rather than
  offering to open onto nothing.

## 0.51.1 - 2026-09-08

- **The same receipt failure on Antigravity missions.** Fixing this in "Approve
  each action" prompted a sweep for the same shape, and the Antigravity path
  had it too - a failed write to the durable record was treated as a passing
  read error, so the run kept going unrecorded. It was worse in one way: the
  place it had reached in the agent's transcript moved forward before the write
  succeeded, so those events were skipped for good rather than retried. Both
  fixed.

## 0.51.0 - 2026-09-08

- **"Approve each action" could lose its record of what happened and keep
  going.** If Locust could not write a mission receipt to disk in that mode,
  the failure was discarded: nothing was written, nothing appeared on screen,
  no error was shown, and the run carried on doing work nobody could later
  prove happened. That is the exact failure the durable record exists to
  prevent, and it was in the one mode built for careful, auditable control.
  The run now stops and says so, the same way every other mode already did.

## 0.50.2 - 2026-09-08

- **A rate-limit warning now says which limit, and when it lifts.** It read
  "primary limit 93% used" - the provider's own internal word - when what it
  meant was the five-hour window, which refills within the hour. The weekly
  budget was barely touched. It now reads "5-hour limit 93% used, resets
  14:39", because waiting an hour and stopping for the week are different
  decisions and a percentage cannot tell them apart.
- **And a limit could go unmentioned entirely.** The reader understood only one
  of the two spellings the runtime uses for these numbers, so on the other it
  said nothing at all.

## 0.50.1 - 2026-09-08

- **Picking a teammate now keeps the effort they were set to.** It restored
  their runtime, model and mode and quietly reset the reasoning effort to the
  model default - so a teammate you had set to a low, cheap effort ran at
  medium every time you selected them, and cost more than you asked for.
- **"effort · fixed" is no longer shown before the model list has loaded.** It
  means "this runtime chooses its own effort", and it was also what an empty
  list looked like while the catalog was still arriving - so the composer
  briefly stated something about the runtime that it had no information about.

## 0.50.0 - 2026-09-08

- **When an Antigravity teammate asks you something, you can now read the
  question.** It used to show as "Prompting user with options" and a spinner
  while the run sat blocked - the question and its options were in the record
  the whole time and nothing displayed them. The row now shows what is being
  asked, every option, and that the answer has to be given in Antigravity
  itself. Locust genuinely cannot answer it: Antigravity resolves that question
  by completing the tool inside its own window, and the only channel Locust has
  arrives as a message that starts a new turn instead.

## 0.49.1 - 2026-09-08

- **A routine step that is too long to send now says so while you type it.** A
  step could be saved at up to 20,000 characters when the message carrying it
  holds 12,000 - the step, what the teammate is told about the workspace, and
  anything waiting from other teammates, together. It said nothing until the
  step ran and failed. The warning gives you the number to cut, and saving
  still works: nothing you already have becomes unreadable.

## 0.49.0 - 2026-09-08

- **A multi-step routine no longer disappears when Locust closes.** Quitting
  during step 2 meant the remaining steps simply never ran, with nothing on
  screen to say so - and because the run was counted the moment step 1
  *started*, a half-finished hourly routine then waited out its whole interval
  before trying again. Progress is now written down as it goes, and a run only
  counts when its last step genuinely finished.
- **After an interruption, the routine waits for you rather than guessing.**
  Its card says which step it stopped on, when, and whether that step actually
  completed - and if Locust closed before it could tell, it says that too and
  replays nothing. You choose to continue or abandon. Nothing restarts by
  itself, because a step that has already sent an email or opened a PR should
  not quietly do it twice.
- **Work you have already read stays on screen.** Sending a follow-up used to
  fold away the previous turn's thinking and tool calls, closing something you
  were looking at. Finished turns keep their work now; closing one yourself
  still sticks.
- Every routine card said its step count twice.

## 0.48.0 - 2026-09-08

- **An attached image now looks like the image.** Attaching a screenshot showed
  you the word `screenshot.png` and nothing else, so telling two screenshots
  apart meant leaving the app. Images are drawn as themselves - in the message
  box before you send, and on the message afterwards - beside the name, never
  instead of it. Everything else still shows as a file, and an image that
  cannot be drawn quietly stays a file row rather than leaving a broken picture
  behind.
- Teammates could already read the images you point them at - Claude Code,
  Cursor and Copilot were each measured opening a screenshot and describing it.
  This is the half you could not see.

## 0.47.0 - 2026-09-08

- **You can attach a file from anywhere on your machine now.** Picking one
  outside your project folder used to be refused outright - which was true of
  most runtimes but not a good answer. Locust copies it into
  `.locust/attachments` inside your folder so any teammate can read it, tells
  you it did, and keeps that folder out of git.
- **Attached files sit above the message box, not on the button row.** They
  were a chip beside the mode and folder controls, on a row that does not wrap
  - so attaching something pushed the effort chip off the edge and into the
  swarm mark. Each file is its own tile now, and each one can be removed on its
  own instead of all or nothing.
- **Your own message no longer opens with instructions you did not write.**
  Sending with a file attached put "Read this file in the workspace before you
  answer:" at the top of your own bubble, and used it as the mission's name in
  the sidebar and in search. Your words are the message; the files are shown
  underneath it, and clicking one opens where it lives.

## 0.46.0 - 2026-09-08

- **Type `/` in the message box to reach the controls without the mouse.** A
  menu opens listing what you can do from here - `/edit`, `/auto`, `/model`,
  `/swarm`, `/stop` - with a sentence under each saying what it does. Arrows
  pick, Enter runs it. Only what is genuinely available is listed: `/stop`
  appears while something is running, and a mode the chosen model cannot honour
  is not offered at all, so nothing in the menu can be chosen and then refused.
  A slash inside a sentence is left alone - "run /plan on this file" is still a
  message, not a command.
- **Auto's warning is finally the colour it was meant to be.** The line saying
  Auto "may change anything on this machine" was written to stand out in amber
  and had been rendering in the same grey as everything else since it was
  added.

## 0.45.4 - 2026-09-08

- **A teammate writing a lot no longer gets stopped for it.** A long report on
  Cursor Agent died with "sent more output than Locust could take in" partway
  through - not because anything was wrong, but because Locust would only hold
  64 lines of output while it wrote the previous batch to disk, and a fast
  model writes more than that in the time one save takes. It holds far more
  now.

## 0.45.3 - 2026-09-08

- **A routine that asks you something now waits for the answer.** A step that
  ended by asking a question counted as finished, so the next step started
  immediately - and your answer was then refused because the teammate was
  already busy with it. The routine stops at that step and says so.
- **A busy workspace no longer looks like a broken one.** When four missions
  were already running, a scheduled routine treated the refusal like a
  signed-out CLI and waited an hour for a slot that often frees in a minute.
  It now waits for the next minute, like it does when the teammate is busy.
- **A long routine step no longer throws away waiting messages for nothing.**
  A step long enough to exceed what can be sent would drop every message
  waiting for that teammate trying to make room, then send anyway - losing the
  messages and fixing nothing.

## 0.45.2 - 2026-09-08

- **What a teammate did stays on screen after it finishes.** While a run is
  going you watch it think and call tools; the moment it ended, all of that
  collapsed into a single line. The newest finished turn now keeps its work
  open - the tools it called, the files it changed, the diffs - so you can read
  it afterwards, or catch what you missed. Earlier turns stay collapsed, and if
  you close one by hand it stays closed.

## 0.45.1 - 2026-09-08

- **Copilot CLI's effort levels work.** It accepts seven of them - none,
  minimal, low, medium, high, xhigh, max - and Locust both failed to read them
  and refused to send one, so the composer said the effort was fixed when it
  was not. Locust now reads the levels a runtime names in its own help,
  whichever way it writes them, and passes your choice through.
- **The Fast variant is a switch**, not a button that fills with colour.

## 0.45.0 - 2026-09-08

- **Attachments.** The `+` is back on the composer and it does something: it
  opens a picker limited to the folder your teammates work in, and the files
  you choose are named at the top of your message so the teammate reads them
  before answering. It works on every runtime, because reading a file in the
  workspace is the one thing all six can already do - and the read shows up in
  the activity fold, so you can see it happened rather than take Locust's word
  for it. Files outside the folder are refused, and a file's contents are
  never pasted into the message.
  The chip says "2 files" rather than "attached", because on most runtimes
  nothing is attached in the technical sense. Three of the six take a file
  natively and a later build will use that, and say so when it does.

## 0.44.1 - 2026-09-08

- **Your conversations are reachable from the narrow layout.** In the 64px
  avatar rail, hovering a teammate opens their conversations beside it - name,
  role, what they are doing, and each conversation with how many turns and how
  long ago. Click the avatar to pin it open; Esc or a click elsewhere closes
  it. A small count on the avatar says how many conversations are behind it.
  Right-click a conversation there for the same menu as the full sidebar,
  including Save as routine.

## 0.44.0 - 2026-09-08

- **Teammates stop losing what they said.** A long reply had its ending cut
  off, and everything a teammate uses to reach you or another teammate - a
  message to a colleague, something learned worth remembering, a question, a
  room task - is written at the end. So the longest, most substantial turns
  looked perfect in the thread and quietly delivered nothing. Long replies now
  keep both ends, and on Cursor Agent a long answer is properly closed instead
  of being left half-finished.
- **Three instructions that contradicted each other.** Memory, questions and
  room tasks each told a teammate its block had to be the last thing in the
  reply. A turn that needed two of them had to disobey one, and dropped it.
  They now say what was always true: put them at the end, in any order.
- **Sending to a teammate is harder to get wrong.** Writing `to='Gem'` with
  single quotes silently sent nothing, and copying a teammate's name from the
  roster exactly as shown - `Gem (Custom)` - was refused as not on the roster.
  Both work now.
- **A numbered list of choices is a question again.** If a teammate offered
  "1. Rewrite it  2. Patch it", no card appeared and the run simply ended.
- **A leftover effort can no longer fail a run.** Switching to a runtime that
  takes no effort level - OpenCode, say - while one was still set from the
  previous model failed the run outright: "OpenCode takes no effort level.
  Nothing was recorded." The effort chip also stayed on screen showing a level
  with nothing behind it, so there was no way to clear it. Locust no longer
  sends an effort to a model that has none, and no longer offers one.
- **A stalled Antigravity run says what it is stuck on** instead of reporting
  that the agent wrote nothing. If it is waiting on its own question, Locust
  now says so and tells you to answer it in Antigravity's window.

## 0.43.9 - 2026-09-08

- **Effort is a slider now, not a list.** Cursor Agent offers eight levels and
  the old menu listed all eight with a sentence under each, which ran off the
  bottom of the window and off its right edge. Those eight are really four,
  each with a faster variant - so it is a Faster-to-Smarter slider with a
  "Fast variant" switch, using whatever levels the chosen model actually
  offers.
- **A runtime's models turn up without a restart.** Locust calls a runtime
  ready as soon as it is installed and signed in, which happens before it has
  finished asking that runtime what models it has - and nothing asked again.
  If you caught it at the wrong moment, a runtime offered only
  "account-default" until you restarted the app.
- **Assigning a conversation says so.** It moved a row in a list you may not
  have been looking at, so a successful assign and a failed one looked
  identical. It now confirms which teammate it went to.

## 0.43.8 - 2026-09-08

- **You can choose the sidebar layout.** Settings now offers Auto, Full and
  Rail. Auto still follows the window - the compact avatar rail on a small
  window, the full sidebar on a large one - but you can pin either, at any
  size. The rail also stopped drawing conversation rows squeezed into four
  pixels, which is what was causing the stray dots, the sideways scrollbar and
  the tall empty box around the selected teammate.
- **An approval no longer yanks the screen.** The approval card used to scroll
  itself into view whenever it appeared, which was right the first time and
  wrong every time after - a second approval, or one arriving while you were
  scrolled up reading an earlier diff, took the page away mid-sentence. The
  thread now decides, and it only follows if you were already at the bottom.
- **The effort chip stopped disappearing on Cursor Agent.** After a run
  resolved the route to a specific model, Locust stopped recognising its own
  model and the chip vanished. A runtime that does not let you choose an
  effort now says so, rather than leaving a gap.
- **Amber means something again.** It marks a card that is waiting on you to
  press something. The stopped-run summary and the "cannot be resumed" note
  were wearing it while asking for nothing, so they now sit quietly with the
  other notes.
- **A stopped run lists what it finished properly.** It was showing the same
  file twice - once with its full path, once without - and the folder itself
  as a long absolute path above three short filenames.

## 0.43.7 - 2026-09-08

- **Locust works properly in a small window.** The layout meant to appear on a
  laptop-sized window had been unreachable for days: it was written for windows
  narrower than the smallest one Locust will open. Now, at the minimum size,
  the sidebar becomes an avatar rail and the inspector slides over the
  conversation instead of vanishing - it used to disappear entirely at that
  width, taking the signal rail, the receipt and the artifacts list with it.
- **Hovering a teammate says who they are.** Name, role and the model they run
  on. In the narrow layout that hover is the only way to tell one avatar from
  another.
- **The effort menu says what each level costs you.** Fast, medium, high and
  the rest each explain themselves in terms of speed and money rather than a
  promise about the answer. On Cursor Agent it also says that the effort is
  part of the model name, which is why choosing one changes the model shown.
- **A ledger Locust cannot write is now a proper screen.** It says what is
  safe, what is at risk, and that stopping the run did not undo files it had
  already changed - and it will open the folder for you. It used to say the
  mission was "held" and, in the next sentence, that it had been stopped.

## 0.43.6 — 2026-09-07

- **A long run is no longer killed by one big piece of output.** A mission on
  Cursor Agent was stopped a minute and a half in, after 1,596 pieces of a
  perfectly normal answer, because the 1,597th was larger than Locust would
  take in one go - and everything already on screen was thrown away with it.
  That one piece is now skipped and the run carries on. If a run later ends
  with nothing to close it, Locust says a piece was skipped rather than
  blaming the runtime for a silence Locust caused.
- **Cursor Agent works again with an effort chosen.** After one turn, a
  follow-up on the same conversation failed at once with "Cursor Agent takes
  no effort level. Nothing was recorded." Cursor carries the effort inside the
  model name, and Locust had stopped recognising its own model once that name
  included one.
- **You can open the file your teammate just wrote.** Every changed file in
  the activity fold now has a control that shows it in File Explorer, and the
  inspector's Artifacts tab lists what the mission produced instead of always
  saying there is nothing. Locust shows the file rather than opening it: a
  script a model wrote should not be one click from running. Anything outside
  the folder your teammates work in is refused.
- **OpenCode says why it stopped.** Running out of the free model's usage
  read as "OpenCode ended without a step that reported it had stopped". It now
  says the free model has no usage left and to pick another one or come back
  later.
- **The thread follows the newest line.** It stays at the bottom while you are
  at the bottom, and stops the moment you scroll up to read something - it
  will not yank you back mid-answer. The scrollbar is thin now, with no
  trough.
- **The composer stopped explaining Shift+Enter.** It was taking up room in
  the box to say something everybody knows.
- One written file no longer draws two identical rows in the activity fold.

## 0.43.5 — 2026-09-07

- **An approval now says what would leave your machine.** The card told you
  what would happen, where, and whether it could be undone — never what data
  it sends, which is the one question you cannot work out for yourself. A file
  change says "Nothing. The change is written to this machine and sent
  nowhere", because that is provable. A command that names a network tool says
  it *can* reach the network and that Locust cannot see what it would send.
  Any other command says plainly that this is unknown — Locust will never tell
  you a command sends nothing, because `./deploy.sh` is two words and can do
  anything.
- **A question says you can just answer it.** The decision card offered two
  buttons and looked like it took nothing else. It now says the composer works
  too, so a third answer does not have to be squeezed into the closest wrong
  option.

## 0.43.4 — 2026-09-07

- **A card no longer says "no files changed" when it cannot know.** With two
  teammates working in one folder, the app already says so plainly — "what
  changed on disk cannot be told apart ... it is not counted as this run's
  work" — and then, on a run whose own runtime reported no edit, put "no files
  changed" directly above that sentence. Measured with one teammate on
  OpenCode and one on Cursor at once: the card said nothing had changed while
  the file that run had just written sat on disk beside it. Knowing nothing is
  not the same as knowing nothing happened. A run that genuinely changed
  nothing still says so.

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
