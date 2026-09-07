// Where a harness is allowed to put a scratch workspace.
//
// Import this FIRST, for its side effect:
//
//   import './scratch-root.mjs'      // before anything calls tmpdir()
//
// MEASURED 2026-09-07. Cursor could not read or edit ANY file in a scratch
// workspace, and said so itself: "Every file-editing path was blocked:
// StrReplace / Write / Delete -> Read permission denied ... The file is
// ignored by `.cursorignore`". Same command, same model, minutes apart:
//
//   C:\Users\<user>\AppData\Local\Temp\...   every path blocked, 102s, no edit
//   C:\Users\<user>\Documents\...            edited correctly, 8.7s
//
// The cause is not Locust and not Cursor. `~/.cursorignore` on this machine
// carries `AppData/`, added deliberately on 2026-09-06 to stop Cursor
// snapshot-indexing multi-GB agent transcripts (~14 GB/hr). Every harness here
// builds its workspace with `mkdtemp(tmpdir())`, and on Windows tmpdir() IS
// inside AppData -- so every Cursor run was being handed a folder its own
// config told it to ignore.
//
// That is worth stating plainly because of what it cost: `diff-smoke` failed
// with ten red checks that all looked like a diff-rendering defect, and the
// runtime had simply never been allowed to open the file. A harness that tests
// the machine's configuration instead of the product reports a defect that
// does not exist -- and the reverse is worse, because a run that cannot touch
// anything also cannot fail the way a real one would.
//
// The fix belongs here rather than in that file: the ignore was added for a
// real reason and should stay. tmpdir() reads TEMP at call time, so pointing
// it somewhere outside AppData fixes every `mkdtemp(tmpdir())` in the tree at
// once, without editing any of them.
//
// Codex, Claude Code and OpenCode all work fine under AppData; only Cursor
// reads `.cursorignore`. This applies to all of them anyway, because a scratch
// root that depends on which runtime you picked is the kind of thing that is
// true until someone changes a route.

import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Outside AppData, and outside the repository.
 *
 * Not inside the repo: several harnesses `git init` their workspace, and a git
 * repository nested inside this one is a trap for anything that walks the
 * tree. `LOCUST_SCRATCH` overrides it for a machine laid out differently.
 */
export const SCRATCH_ROOT = process.env.LOCUST_SCRATCH ?? join(homedir(), 'Documents', 'locust-scratch')

mkdirSync(SCRATCH_ROOT, { recursive: true })

// tmpdir() consults these every call, so this reaches code that was written
// against tmpdir() long before this file existed.
process.env.TEMP = SCRATCH_ROOT
process.env.TMP = SCRATCH_ROOT
process.env.TMPDIR = SCRATCH_ROOT
