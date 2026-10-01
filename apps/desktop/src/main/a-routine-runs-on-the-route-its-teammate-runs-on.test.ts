import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Colin, 2026-09-21, on a routine that could never run: *"bug?"*
 *
 * Read from his own files before anything was changed:
 *
 * - The routine stored `mode: 'ask'` on `runtime: cursor`.
 * - Its teammate, Jimothy, has `mode: 'auto'` on the same runtime.
 * - The mission it was learned from recorded `mode: auto`,
 *   `sandbox: full-access`.
 * - The mission had **no owner** -- it is the Ungrouped conversation.
 *
 * That last line is the cause. `openSaveRoutine` reads the route from the
 * conversation's owner, and an ownerless conversation has none, so it fell
 * back to a hardcoded `mode: 'ask'`. The dialog then asks *"which teammate
 * runs this?"* -- and the route was never revisited once he answered. The
 * routine was stored on a mode its own teammate had never run in.
 *
 * On Windows that mode is not merely wrong, it is impossible: Cursor cannot
 * be held read-only there, so the mission service refuses `ask` outright and
 * every attempt was dead on arrival.
 *
 * Two fixes, both here: the fallback takes the mode the conversation ACTUALLY
 * RAN IN, and the saved route follows whoever the person named.
 */
const APP = readFileSync(fileURLToPath(new URL('../renderer/src/App.tsx', import.meta.url)), 'utf8')

describe('a routine runs on the route its teammate runs on', () => {
  it('takes the mode the conversation actually ran in, not a guess', () => {
    expect(APP).toContain("mode: mission.mode ?? ('ask' as const)")
    // The guess is gone as the FIRST answer; it survives only where the
    // record itself cannot say (a mission written before v15 has no mode).
    expect(APP).not.toContain("model: mission.model ?? 'account-default',\n          mode: 'ask' as const")
  })

  it('saves the route of the teammate the person named in the dialog', () => {
    expect(APP).toContain("const named = teammates.find((entry) => entry.teammateId === owner)?.route")
    expect(APP).toContain('const inherited = named ?? dialog.route ??')
    // And that is what is sent, rather than the route decided before the
    // question was asked.
    expect(APP).not.toContain("route: dialog.route ?? { runtime: 'codex', model: 'account-default', mode: 'ask' },")
  })
})
