import { describe, expect, it } from 'vitest'

import { createAntigravityHostProbe } from './antigravity-host.js'

/**
 * The seam that stands in for an empty laptop has to reach every runtime.
 *
 * `LOCUST_HIDE_RUNTIMES=1` exists so `_tools/drive-first-run.mjs` can see
 * what a person with nothing installed sees, on a machine that has all six
 * agents. It works by handing discovery an executable locator that finds
 * nothing. This probe never used that locator — it looks for Antigravity's
 * install directly — so it went on reporting READY through every drive that
 * believed it was looking at a bare machine.
 *
 * MEASURED 2026-09-21 on 0.244.0: `drive-first-run.mjs` exited with *"the
 * composer is on Antigravity / Account Default"*. Not a bare machine, and not
 * a free route, so the drive refused to send and stopped.
 *
 * Which means the one tool whose entire job is the first-run screen had not
 * been driving the first-run screen since Antigravity shipped — and that
 * screen is where eight of the nine findings in Sol's beta review live. They
 * were found on a separate Linux box because this could not show them here.
 * A test seam that silently stops standing in for the thing is worse than no
 * seam: it produces evidence that looks like evidence.
 */
describe('a bare machine drive sees a bare machine', () => {
  const withEnv = async <T>(value: string | undefined, run: () => Promise<T>): Promise<T> => {
    const held = process.env.LOCUST_HIDE_RUNTIMES
    if (value === undefined) delete process.env.LOCUST_HIDE_RUNTIMES
    else process.env.LOCUST_HIDE_RUNTIMES = value
    try {
      return await run()
    } finally {
      if (held === undefined) delete process.env.LOCUST_HIDE_RUNTIMES
      else process.env.LOCUST_HIDE_RUNTIMES = held
    }
  }

  it('reports Antigravity as absent while the seam is set', async () => {
    const probe = createAntigravityHostProbe({ platform: 'win32' })
    const record = await withEnv('1', () => probe.discoveryRecord())
    expect(record.availability).toBe('unavailable')
    expect(await withEnv('1', () => probe.probe())).toBeUndefined()
  })

  it('leaves an explicit test seam alone, so the unit tests still decide', async () => {
    // `localAppData` passed in means a test is constructing the machine
    // itself. The environment only answers when nothing else has — otherwise
    // this flag would silently blank out every other test in this file.
    const probe = createAntigravityHostProbe({ platform: 'win32', localAppData: 'C:/nowhere-at-all' })
    const record = await withEnv('1', () => probe.discoveryRecord())
    expect(record.id).toBe('antigravity')
  })
})
