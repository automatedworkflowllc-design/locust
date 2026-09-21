# Muse Code captures

`echo-provider-run.jsonl` is one real `muse exec --provider echo --json`
stream from Muse Code 1.3.0-R3401.1, captured 2026-09-21 on Windows. It is
the only source the `muse-events` adapter was built from, and the full probe
it came out of — `--help`, `exec --help`, `--version`, the stderr, and the
240 KB MSP schema the binary generates for itself — is in
`docs/muse-probe-2026-09-21/`.

Nothing was scrubbed, because there was nothing to scrub: the prompt is
`Reply with exactly PING`, the workspace was a throwaway temp directory whose
path appears only on stderr, and the echo provider contacts no model, so the
stream carries no provider blobs and no system prompt.

**The echo provider is free and needs no account.** Regenerate this file, or
capture a longer one, with:

```
muse exec --provider echo --json --workspace <a temp folder> "<a prompt>"
```

Two artefacts of how it was captured are deliberately left in the bytes: a
UTF-8 byte-order mark on the front and CRLF line endings, both put there by
PowerShell's redirect rather than by Muse. The test strips the carriage
returns the way the process runner's line splitter does and leaves the mark
alone, so the first record the adapter is handed in that suite is the
awkward one.

**What this capture does not contain: a tool call under a paying provider.**
The three tasks in it are Muse's own machinery — a skill reminder, the model
turn, a verify reminder. The adapter's tool rows are therefore exercised by a
synthetic lifecycle built on this envelope, and that test says so where it
stands.
