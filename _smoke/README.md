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
| `update-smoke.mjs` | the packaged build asks the real release channel and gets an answer: `Up to date.` when it matches the newest release, or the version it found | that an install actually completes | **no** (network only) |
| `packaged-smoke.mjs` | the built `Locust.exe` from its asar: it boots, discovery finds the CLIs with PATH cut to System32, renderer egress is refused, brand faces load | anything needing a provider run | **no** |

```
node _smoke/relay-smoke.mjs         # three short Cursor runs
node _smoke/update-smoke.mjs        # needs network, no provider
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
