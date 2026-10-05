import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Fable's probing review, 2026-09-21, #2 -- measured on a healthy machine:
 * "t+15.35 s: a second full sweep (3 s) started by the renderer's
 * unconditional first re-check timer. Nothing was still checking; the sweep
 * learned nothing." And "every return to the window after 10 s away is the
 * same full sweep." On Colin's machine that sweep is 6 s (12 s before 0.235).
 *
 * The rule: a sweep runs on its own only when it could learn something --
 * an installed runtime that is not ready. Check again still sweeps everything.
 */
const APP = readFileSync(fileURLToPath(new URL('../renderer/src/App.tsx', import.meta.url)), 'utf8')

describe('a sweep that cannot learn is not run', () => {
  it('asks again at 15 s only when something installed is not ready', () => {
    expect(APP).toContain('if (unanswered) askAgain()')
    expect(APP).not.toContain('const firstRecheck = setTimeout(askAgain, RUNTIME_RECHECK_MS)')
  })

  it('sweeps on focus only when something installed is not ready', () => {
    expect(APP).toContain('if (unanswered && Date.now() - lastAsked >= RUNTIME_RECHECK_MIN_GAP_MS) askAgain()')
  })

  it('learns whether it is worth asking from every answer, and assumes yes until the first', () => {
    expect(APP).toContain('let unanswered = true')
    // Installed, runnable here, and not ready -- since 2026-09-22 a runtime
    // Locust only lists (`planned`) is never waited on.
    expect(APP).toContain("entry.installed && entry.status !== 'ready' && integrationOf(entry.id) !== 'planned'")
    expect(APP).toContain('return unreadyRuntimes(runtimes).length > 0')
    // Once from the launch answer, once from every re-check, and once from
    // the held answer read again when a late check crossed the list (0.639).
    expect(APP.split('unanswered = worthAskingAgain(response.data.runtimes)').length - 1).toBe(3)
  })

  it('names the runtimes it is waiting on, so only those are asked', () => {
    // One signed-out CLI used to mean a full sweep (~16 processes) on every
    // return to the window (main-process audit, 2026-09-22).
    expect(APP).toContain('.getLocalRuntimes(everything, everything || waitingOn.length === 0 ? undefined : waitingOn)')
  })

  it('leaves Check again sweeping everything', () => {
    // The install path and the button both reach the same function with no
    // gate in front of it.
    expect(APP).toContain('askDiscoveryAgain.current = askAgain')
  })
})
