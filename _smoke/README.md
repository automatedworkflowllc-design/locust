# Live smokes

Two scripts that run the product against a **real provider**, not a fake runner.
Neither is part of `pnpm check`: both need a signed-in Codex CLI and the second
needs a desktop session, so they are run by hand and their results reported.

| script | what it proves | what it cannot see |
| --- | --- | --- |
| `live-ledger-smoke.mjs` | discovery -> transport -> normalizer -> durable ledger -> recovery by a fresh reader, on a real Codex run | the renderer |
| `renderer-smoke.mjs` | the same run driven through the built Electron UI, asserted on what the screen says | nothing above it |
| `write-mode-smoke.mjs` | that the mission sandbox is real: the same prompt is refused under `read-only` and succeeds under `workspace-write` | the UI |
| `app-server-smoke.mjs` | the shipped JSON-RPC client against a real `codex app-server`: handshake, real model list, a turn, and an approval request answered | anything above the transport |

```
node _smoke/live-ledger-smoke.mjs
node _smoke/renderer-smoke.mjs      # requires apps/desktop to be built
node _smoke/write-mode-smoke.mjs    # writes only inside a throwaway temp repo
node _smoke/app-server-smoke.mjs   # refuses every approval it is asked for
```

Each exits non-zero on any failed assertion.

## Both carry their own negative control

A green check that could never go red is worth nothing, so each script proves
its own assertions are live:

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

Two of this file's own checks were wrong before they were right, both in the
same family: one waited for the send button to be *enabled* before typing, when
it is correctly disabled until a prompt exists — a condition that could never go
green; the other passed on a stale receipt restored from a shared profile. Both
are now assertions that mean something.

`write-mode-smoke.mjs` carries its control inline rather than as a separate
step: the read-only run IS the control. Without it, a build that ignored the
sandbox argument entirely -- or always passed `workspace-write` -- would still
produce a green "it wrote the file" result.

`app-server-smoke.mjs` replaces the two throwaway spikes that first proved the
protocol. It answers every approval request with a REFUSAL: a smoke must not be
able to run a command on this machine in order to prove that it could have. It
also asserts that the six models do NOT all report the same supported efforts,
because an effort control that degrades honestly needs per-model data and a
uniform list would let a wrong assumption pass.
