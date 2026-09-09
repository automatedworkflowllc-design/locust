import { describe, expect, it } from 'vitest'

import { unreadableFileCount } from './mission-history.js'

/**
 * How many ledger files could not be read at all.
 *
 * The number the Missions header is handed so it can stop claiming
 * verification for a ledger the reader refused. What the header then SAYS with
 * it is pinned in `renderer/src/unreadable-ledger-is-said.test.tsx`, by
 * rendering the real component -- the two halves are tested on their own sides
 * of the process boundary, because a renderer test that imports this module
 * pulls the whole main tree into the web tsconfig and breaks its typecheck
 * while every test still passes.
 *
 * Found by Astra, 2026-09-08. A file damaged in its body recovers a mission
 * that carries `integrityIssueCount`; a file damaged in its HEADER, or over
 * MAX_LEDGER_BYTES, recovers nothing, so there was no mission to carry the
 * damage and the screen read "ledger verified".
 */

const recovered = (missionId: string): { readonly metadata: { readonly missionId: string } } => ({
  metadata: { missionId }
})

describe('counting the ledger files that yielded no mission', () => {
  it('adds nothing when the mission is present to carry its own issue', () => {
    // The control. Body damage is ALREADY reported through the mission's own
    // count; adding it here again would double-report the same file.
    expect(
      unreadableFileCount({ missions: [recovered('m_1')] as never, issues: [{ missionId: 'm_1' }] })
    ).toBe(0)
    expect(unreadableFileCount({ missions: [recovered('m_1')] as never, issues: [] })).toBe(0)
  })

  it('counts a file whose issue names a mission that could not be recovered', () => {
    expect(
      unreadableFileCount({
        missions: [recovered('m_1')] as never,
        issues: [{ missionId: 'm_1' }, { missionId: 'm_broken' }]
      })
    ).toBe(1)
  })

  it('counts FILES, not issues, so one bad header is not reported as two', () => {
    /*
     * A truncated header raises both `truncated-tail` and `invalid-record` --
     * Astra observed exactly that pair. Counting issues would turn one damaged
     * file into "2 files could not be read", replacing a false reassurance
     * with a false count rather than fixing anything.
     */
    expect(
      unreadableFileCount({ missions: [] as never, issues: [{ missionId: 'm_torn' }, { missionId: 'm_torn' }] })
    ).toBe(1)
  })

  it('still counts an issue that names no mission at all, exactly once', () => {
    // An unreadable header may yield no id to blame. It is still a file that
    // could not be read, and silence about it is the whole defect.
    expect(unreadableFileCount({ missions: [] as never, issues: [{}] })).toBe(1)
    expect(unreadableFileCount({ missions: [] as never, issues: [{}, {}] })).toBe(1)
  })

  it('counts several distinct broken files separately', () => {
    expect(
      unreadableFileCount({ missions: [] as never, issues: [{ missionId: 'm_a' }, { missionId: 'm_b' }] })
    ).toBe(2)
  })
})
