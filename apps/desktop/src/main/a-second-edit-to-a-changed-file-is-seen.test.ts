import { describe, expect, it } from 'vitest'

import { changedPaths, snapshotWorkspace } from './disk-observation.js'

/**
 * A tracked file already modified, then modified again, kept the status
 * ` M` both times and the host saw nothing (drive of check-after-edits,
 * 2026-09-25: "nothing changed on disk" after a teammate rewrote the file).
 */
describe('a tracked file edited again', () => {
  const status = ' M notes.txt\u0000'
  const snapshot = (mtimeMs: number, size = 5) =>
    snapshotWorkspace('C:/work', {
      runGit: async () => status,
      statOf: async () => ({ size, mtimeMs }) as never
    })

  it('is seen as changed when it was written again', async () => {
    const before = await snapshot(1_000)
    const after = await snapshot(2_000, 6)
    expect(changedPaths(before!, after!)).toEqual(['notes.txt'])
  })

  it('is not seen as changed when nothing touched it', async () => {
    const before = await snapshot(1_000)
    const after = await snapshot(1_000)
    expect(changedPaths(before!, after!)).toEqual([])
  })
})
