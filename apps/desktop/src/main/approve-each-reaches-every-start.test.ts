import { describe, expect, it } from 'vitest'

import { MAX_LIVE_MISSIONS } from './codex-mission.js'
import { MAX_LIVE_APP_SERVER_MISSIONS } from './app-server-mission.js'
import { MAX_LIVE_ANTIGRAVITY_MISSIONS } from './antigravity-mission.js'

/**
 * Per-action approvals exist on ONE transport, and every other way of starting
 * a mission has to say so rather than quietly run something else.
 *
 * Found by Wren dogfooding on Grok, 2026-09-08, reading the start paths rather
 * than running them. The composer's own start branches `approve-each` to
 * `appServerMissions.start`. Three other callers -- the routine runner, a room
 * post, and a relay -- call `codexMissions.start` directly, and the exec
 * transport maps modes as:
 *
 *     auto -> full-access, accept-edits -> workspace-write, ELSE read-only
 *
 * so `approve-each` fell through to read-only. A teammate saved to "approve
 * each action" therefore ran with no approval cards, no writes, and nothing
 * anywhere saying either, while the composer chip still said approvals. Safer
 * than silent writes, and still a lie about what happened.
 *
 * This file pins the two source-level facts that make the defect possible, so
 * that a fourth start path added later cannot reintroduce it silently. The
 * behaviour of each refusal is pinned in its own module's tests; what is
 * checked here is that no start path reaches exec with the mode still on.
 */

const SOURCE = new URL('./', import.meta.url)
const read = async (file: string): Promise<string> =>
  (await import('node:fs')).readFileSync(new URL(file, SOURCE), 'utf8')

describe('no way of starting a mission lets approve-each fall through to exec', () => {
  it('the exec transport still maps every unnamed mode to read-only', async () => {
    // The control, and the reason the rest of this file exists. If this
    // mapping ever names approve-each explicitly, the refusals below become
    // the wrong fix and should be revisited rather than left in place.
    const codex = await read('codex-mission.ts')
    expect(codex).toContain("mode === 'auto' ? 'full-access' : mode === 'accept-edits' ? 'workspace-write' : 'read-only'")
  })

  it('the routine runner refuses before it persists a dispatch', async () => {
    const runner = await read('routine-runner.ts')
    expect(runner).toContain("routine.route.mode === 'approve-each'")
    expect(runner).toContain('RUN_MODE_UNSUPPORTED')
    /*
     * Before, not after: a refusal that lands below the dispatch write leaves
     * a persisted intent for a run that never happened, which the recovery
     * path then has to reason about.
     *
     * Anchored on the comment above THAT write rather than on `saveProgress`,
     * which appears several times in this file -- a first version compared
     * against the earliest one anywhere in the source and failed on a guard
     * that was correctly placed.
     */
    const persistPoint = runner.indexOf('Persist BEFORE spawn')
    expect(persistPoint).toBeGreaterThan(0)
    expect(runner.indexOf("routine.route.mode === 'approve-each'")).toBeLessThan(persistPoint)
  })

  it('a room post and a relay refuse too', async () => {
    const main = await read('index.ts')
    // Two distinct refusals, one per path -- not one shared check that only
    // covers whichever caller happens to run first.
    const refusals = [...main.matchAll(/route\.mode === 'approve-each'|input\.mode === 'approve-each'/g)]
    expect(refusals).toHaveLength(2)
  })
})

/**
 * And the cap is one pool.
 *
 * Also Wren's, and worse than reported: they found two counters of four, and
 * there are three. Each service counted only its own live runs while every
 * READ in the app -- `teammateBusy`, the sidebar count, the busy list -- had
 * always summed all three into one number, and both refusal messages said
 * "up to 4". Twelve missions could be live under a product wall of four.
 */
describe('the live-mission cap is one pool across the transports', () => {
  it('all three transports carry the same bound', () => {
    expect(MAX_LIVE_APP_SERVER_MISSIONS).toBe(MAX_LIVE_MISSIONS)
    expect(MAX_LIVE_ANTIGRAVITY_MISSIONS).toBe(MAX_LIVE_MISSIONS)
  })

  it('each one counts the others before admitting a start', async () => {
    for (const file of ['codex-mission.ts', 'app-server-mission.ts', 'antigravity-mission.ts']) {
      const source = await read(file)
      expect(source, file).toContain('liveElsewhere')
      // The count must be IN the comparison, not merely declared next to it.
      expect(source, file).toMatch(/\+ \(options\.liveElsewhere \?\? \(\(\) => 0\)\)\(\) >= MAX_LIVE/)
    }
  })

  it('the host wires each service to the other two', async () => {
    const main = await read('index.ts')
    expect([...main.matchAll(/liveElsewhere: \(\) =>/g)]).toHaveLength(3)
  })
})
