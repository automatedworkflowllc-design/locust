import { describe, expect, it } from 'vitest'

import { MAX_KEPT_FILES, TOO_BIG_REMEMBERED_MS, createCheckpoints } from './checkpoints.js'

/**
 * A FOLDER TOO BIG TO KEEP IS NOT RE-LISTED EVERY TURN (0.695).
 *
 * Finding that a folder is past Undo's limits lists and stats every file in
 * it: 0.35 s a turn in Colin's 300 MB folder (measured 2026-10-07), paid on
 * every turn to say the same thing. The answer is believed for ten minutes;
 * a folder that shrinks has Undo back within that.
 */
describe('a folder too big to keep', () => {
  it('is listed once, believed for ten minutes, then listed again', async () => {
    let clock = 1_000
    let listings = 0
    const many = Array.from({ length: MAX_KEPT_FILES + 1 }, (_, at) => `file-${String(at)}.txt`).join('\0')
    const checkpoints = createCheckpoints({
      root: 'C:/profile/checkpoints',
      now: () => clock,
      runGit: async (args) => {
        if (args.includes('ls-files')) {
          listings += 1
          return many
        }
        return ''
      }
    })
    const first = await checkpoints.take('C:/work/huge')
    expect(first).toMatchObject({ ok: false, why: expect.stringMatching(/too many to keep/) })
    clock += 60_000
    expect(await checkpoints.take('C:/work/huge')).toEqual(first)
    expect(listings).toBe(1)
    clock += TOO_BIG_REMEMBERED_MS
    await checkpoints.take('C:/work/huge')
    expect(listings).toBe(2)
  })

  it('is remembered for that folder only', async () => {
    let listings = 0
    const checkpoints = createCheckpoints({
      root: 'C:/profile/checkpoints',
      now: () => 0,
      runGit: async (args) => {
        if (args.includes('ls-files')) {
          listings += 1
          return args.some((arg) => arg.includes('huge')) ? Array.from({ length: MAX_KEPT_FILES + 1 }, (_, at) => `f${String(at)}`).join('\0') : ''
        }
        return ''
      }
    })
    await checkpoints.take('C:/work/huge')
    await checkpoints.take('C:/work/small')
    await checkpoints.take('C:/work/small')
    expect(listings).toBe(3)
  })
})
