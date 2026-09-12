# Live smokes

Scripts that run the product against a **real provider** or a **real build**,
not a fake runner. None is part of `pnpm check`: most need a signed-in CLI and
a desktop session, so they are run by hand and their results reported.

Each exits non-zero on any failed assertion, and each kills the app it started.

## What each one proves

| script | what it proves | what it cannot see | costs quota |
| --- | --- | --- | --- |
| `live-ledger-smoke.mjs` | discovery → transport → normalizer → durable ledger → recovery by a fresh reader, on a real Codex run | the renderer | yes |
| `renderer-smoke.mjs` | the same run driven through the built UI, asserted on what the screen says | nothing above it | yes |
| `write-mode-smoke.mjs` | that the sandbox is real: one prompt refused under `read-only`, the same one writing under `workspace-write` | the UI | yes |
| `app-server-smoke.mjs` | the shipped JSON-RPC client against a real `codex app-server`: handshake, model list, a turn, an approval answered | anything above the transport | yes |
| `handoff-smoke.mjs` | a live Codex mission handed to Claude Code mid-flight, with the checkpoint and divider on screen | whether the second runtime was cheapest | yes, twice |
| `side-by-side-smoke.mjs` | two teammates running at once, thread switching mid-run, and that a busy teammate refuses a second mission | more than two at once | yes, twice |
| `workroom-smoke.mjs` | one teammate's finding reaching another's briefing, asserted on screen, in the channel file, and in both ledgers | delivery to a teammate who never runs | yes, twice |
| `model-choice-smoke.mjs` | each runtime offering its own models, and the picked model being the one that runs and is recorded | models the account cannot run | yes |
| `cursor-smoke.mjs` | Cursor Agent as a route end to end: its own models, its own command, its own normalizer, recorded as Cursor's | the other runtimes | yes (cheap) |
| `follow-up-smoke.mjs` | that a reply CONTINUES the conversation: the model recalls a passphrase, the ledger records a `follow-up`, and both turns share one runtime session | routes other than the one passed | yes (cheap; `--route=`) |
| `avatar-smoke.mjs` | generated faces against the design spec: seeded by id, only the working teammate animates, all still when idle | taste | yes |
| `retention-smoke.mjs` | pruning old missions from Settings: the preview names what it keeps, deletes nothing, and the confirm removes exactly what it named | — | **no** |
| `picker-smoke.mjs` | that one runtime with 217 models cannot bury the others: every group capped, the cap counted, search lifting it | — | **no** |
| `diff-smoke.mjs` | the inline diff against a real edit: file row, unified rows with signs, derived hunk range, intra-line marks, and both design rules checked on screen -- card total equals the sum of its file rows, and the open file ends in a completeness statement | a change too large to record inline | yes (cheap) |
| `relay-smoke.mjs` | two teammates exchanging a question and an answer with nobody typing: the recipient's run starts on its own, owned by them and briefed by the host; the answer starts the sender's follow-up and lands in the thread that asked; it stops at two hops | more than two teammates | yes (three cheap runs) |
| `opencode-smoke.mjs` | OpenCode as a route on a FREE model: picked through the UI, a read-only run that cannot write, a write run whose edit shows in the diff view, ledgers signed by the OpenCode normalizer naming the session | paid providers through OpenCode | **no** |
| `copilot-smoke.mjs` | Copilot CLI as a route (Auto): the same read-only / write pair, session id minted by the host | model choice (Copilot picks) | yes (two premium requests) |
| `antigravity-smoke.mjs` | the experimental route: Antigravity open with a folder, Gemini Flash picked (rows tagged EXPERIMENTAL), a write mission whose file really appears, ledger signed by the Antigravity normalizer naming the conversation | read-only (there is none), follow-ups | yes (one flash conversation) |
| `update-smoke.mjs` | the packaged build asks the real release channel and gets an answer: `Up to date.` when it matches the newest release, or the version it found | that an install actually completes | **no** (network only) |
| `packaged-smoke.mjs` | the built `Locust.exe` from its asar: it boots, discovery finds the CLIs with PATH cut to System32, renderer egress is refused, brand faces load | anything needing a provider run | **no** |

```
node _smoke/relay-smoke.mjs         # three short Cursor runs
node _smoke/update-smoke.mjs        # needs network, no provider
node _smoke/update-smoke.mjs --installed --install   # the INSTALLED copy: clicks Install, asserts the binary changed version
node _smoke/diff-smoke.mjs          # one cheap Cursor edit in a throwaway workspace
node _smoke/picker-smoke.mjs        # no provider run at all
node _smoke/retention-smoke.mjs     # seeds a ledger by hand
node _smoke/packaged-smoke.mjs      # requires a packaged build in apps/desktop/release
node _smoke/cursor-smoke.mjs        # requires apps/desktop to be built
node _smoke/follow-up-smoke.mjs --route=cursor --model="Composer 2.5"
```

## The ones that carry a negative control

A green check that could never go red is worth nothing, so several prove their
own assertions are live:

- **`live-ledger-smoke.mjs`** copies the ledger it just wrote, smuggles a NUL
  into one body record, and requires recovery to come back *short, flagged and
  `interrupted`*. That is the exact production failure the reader/writer parity
  fix exists for: the writer accepted a record the reader refuses, so a
  completed mission recovered truncated with the file fully intact on disk. If
  the corrupted ledger still recovers clean, the assertions above it are inert.
- **`renderer-smoke.mjs`** asks for a **computed** answer (6137 x 4) rather than
  an instructed token. An instructed token is echoed back inside the prompt the
  UI displays, so matching it on screen would pass with no model in the loop at
  all. It then asserts `24548` is absent *before* the run, and launches with a
  private `--user-data-dir`, because the app restores mission history from the
  ledger on launch and a shared profile would put a previous run's answer on
  screen before this one starts.
- **`write-mode-smoke.mjs`** runs the read-only half FIRST and requires the file
  to be absent. Without that half, a build that ignored the sandbox flag
  entirely would pass.
- **`follow-up-smoke.mjs`** asks for a passphrase the model cannot guess, and
  requires all three of the recall, the ledger's `follow-up` link, and one
  shared runtime session id. Any one alone can be true while replies are
  broken: the transcript can be re-sent without resuming, and a resumed session
  can still be recorded as an unrelated mission.
- **`retention-smoke.mjs`** checks the file count on disk after the PREVIEW and
  requires it unchanged, so a preview that quietly deleted would fail before
  the confirmation step is reached.
- **`packaged-smoke.mjs`** attempts an outbound request from the packaged
  renderer and requires it to be refused, and runs discovery with PATH reduced
  to `C:\Windows\System32` so a CLI found only because the dev shell knew where
  it was would report missing.

## Run a sweep on a quiet machine

`node _smoke/run-all.mjs` runs the smokes one at a time, but they drive a real
Electron and real providers, and several have windows that widen under load:
`cursor` waits on a live `cursor-agent --list-models`, `routine` reconciles a
mission's phase against the ledger. Running the unit suite, a build or a drive
alongside a sweep makes those go red for no product reason. A sweep that
shares the machine reports the machine.

That was worth doing and was NOT enough. Measured 2026-09-11 on a quiet
machine: four of thirty-two red on any given run and not the same four --
three smokes that passed one sweep failed the next.

**Most of that turned out to be ours, and is fixed.** Eleven port numbers were
used by two smokes each; the sweep runs alphabetically, so several collided at
close range (`schedule`/`steering` two apart, `relay`/`raw-conversation` one
apart). Each smoke launches an Electron app as its own child and the sweep
waits only for the node process that spawned it, so an app still shutting down
still held its debugging port -- and the next smoke could attach its CDP client
to the PREVIOUS app, drive a window on the wrong screen, and report "no row".
See `ports.mjs` below. A later sweep went **31 of 32**, with the one failure a
stale assertion rather than a defect.

Re-run anything red before believing it anyway: the habit is cheap and a single
run still proves less than it looks. See
`docs/FINDING-smoke-sweep-2026-09-11.md`.

Keep the previous `smoke-results.json` before starting: the runner overwrites
it, and the old one is the only baseline for "was this already red". Its rows
are keyed `code`, `failed`, `outOfQuota`, `seconds`, `tail` -- there is no
`ok` or `pass`, and a parse that assumes one reports every row as failing.

## Adding a smoke: take a port from `ports.mjs`

Every smoke that launches the app gets its debugging port from
`_smoke/ports.mjs`, and `portFor(import.meta.url)` reads it from the FILENAME
-- a smoke naming somebody else's port is the bug that file exists to stop. Add
an entry for a new smoke rather than borrowing one; `run-all.mjs` calls
`assertPortsAreUnique()` before it runs anything, so a duplicate fails the
sweep immediately instead of producing a red smoke somewhere else an hour
later.

The `_tools` drives use 9490-9599 and must stay out of that range.

## Assert what the PRODUCT owes, never what a model chooses

Two smokes were caught asserting things Locust does not control, and both had
been red for weeks while saying nothing true:

- `relay` asserted an exchange "ended on its own rather than running into the
  hop cap" -- a claim about how terse two models choose to be. It flaked
  forever AND hid a real defect, because an exchange stopping AT the budget
  and one stopping PAST it read as the same red line. Rewritten to the three
  things the app owes -- it ends, it stays inside the budget, and if the
  budget stopped it the person is told -- it immediately found both a leak in
  the cap and a notice that reached nobody.
- `exchange` pinned the literal `6` as the default budget, so changing a
  setting reported a broken exchange strip.

If an assertion can be falsified by a model being polite, or by somebody
changing a default, it is testing the wrong thing. Fix it by making it say
what it means, not by loosening it.

**The whole suite was audited for this on 2026-09-12** -- delegated to Grok
on Cursor's free quota, read-only, reported rather than applied, because
rewriting an assertion needs judgement about what the app promises. Nine more
were found and fixed; the report is `docs/GROK-RESULT-2026-09-12-SMOKE-ASSERTIONS.md`.
Every finding was re-checked against the source before it was applied, and one
of its suggestions was NOT taken: it proposed asserting that the composed
brief in the ledger carries the seeded memory, and the ledger's
`mission.created` turns out to hold the person's words only, so there is
nothing there to assert. Read the file before trusting a fix written for it.

The nine, as a list of the shapes to watch for:

- a hop cap the smoke asserted but never seeded (`relay`)
- a model quoting a code word back (`memory`, `folder-brief`, `follow-up`)
- a model repeating an instructed phrase (`room`, `side-by-side`, `workroom`)
- a model producing reasoning at all (`cursor`)
- a default interval the smoke never chose (`schedule`, in four places)
