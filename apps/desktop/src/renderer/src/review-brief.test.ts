import { describe, expect, it } from 'vitest'

import { reviewBrief } from './reviewBrief.js'
import type { ReviewMaterial } from './reviewBrief.js'

/*
 * Astra's part 2: a reviewer teammate that challenges a change against the
 * original request. Sequenced after part 1a on purpose -- until a turn said
 * what it RAN, a reviewer had nothing to read but the diff, and a second
 * model re-reading a diff is a second opinion about code rather than a check
 * on whether the work was done.
 *
 * The brief computes nothing. Everything in it is already on screen; the
 * point is that a reviewer cannot see another teammate's conversation, so the
 * facts have to travel.
 */

const MATERIAL: ReviewMaterial = {
  request: 'Make the path handler work on Windows.',
  changed: ['src/paths.ts', 'src/paths.test.ts'],
  commands: [
    { name: 'pnpm test', exitCode: 0 },
    { name: 'tsc --noEmit', exitCode: 0 }
  ],
  ranOn: 'Windows · locust-astra',
  author: 'Jimothy'
}

describe('the brief a reviewer is handed', () => {
  it('carries the request in the words the person used', () => {
    expect(reviewBrief(MATERIAL)).toContain('Make the path handler work on Windows.')
  })

  it('carries what changed, what ran with its exit code, and where', () => {
    const brief = reviewBrief(MATERIAL)
    expect(brief).toContain('src/paths.ts')
    expect(brief).toContain('pnpm test — exit 0')
    expect(brief).toContain('Windows · locust-astra')
  })

  it('names who did the work, and that the reviewer did not', () => {
    const brief = reviewBrief(MATERIAL)
    expect(brief).toContain('Jimothy')
    expect(brief).toContain('You did not do this work')
  })

  it('MAKES NO CLAIM THAT THE WORK IS DONE OR CORRECT', () => {
    // Telling a reviewer the work passed and then asking it to check is
    // handing it the answer. Same discipline as the trace line: exit 0 is
    // what the ledger holds, not a verdict.
    const brief = reviewBrief(MATERIAL).toLowerCase()
    for (const claim of ['passed', 'all exit 0', 'verified', 'looks correct', 'successfully', 'working correctly']) {
      expect(brief, claim).not.toContain(claim)
    }
    expect(brief).toContain('not proof that the work is correct')
  })

  it('tells it to report rather than fix', () => {
    // A reviewer that redoes the work is a second builder.
    expect(reviewBrief(MATERIAL)).toContain('Do not redo the work')
    expect(reviewBrief(MATERIAL)).toContain('Report; do not fix.')
  })

  it('says a short answer is right when the work is fine', () => {
    // The other failure mode: a reviewer that must find something.
    expect(reviewBrief(MATERIAL)).toContain('say so plainly and stop')
  })

  it('says plainly when a run changed nothing, rather than leaving a blank', () => {
    const brief = reviewBrief({ ...MATERIAL, changed: [] })
    expect(brief).toContain('Nothing in the workspace.')
  })

  it('says plainly when nothing was run', () => {
    // The most important case for a reviewer to notice, and the one a blank
    // section would hide.
    expect(reviewBrief({ ...MATERIAL, commands: [] })).toContain('No commands were run.')
  })

  it('marks a command whose exit code was never recorded', () => {
    // Not as a zero, which would be a claim nothing supports.
    const brief = reviewBrief({ ...MATERIAL, commands: [{ name: 'pnpm test', exitCode: undefined }] })
    expect(brief).toContain('(no exit code recorded)')
    expect(brief).not.toContain('exit 0')
  })

  it('bounds a long list rather than truncating it silently', () => {
    const many = Array.from({ length: 25 }, (_, index) => `src/file${String(index)}.ts`)
    const brief = reviewBrief({ ...MATERIAL, changed: many })
    expect(brief).toContain('and 5 more')
  })

  it('bounds a very long request, with a mark', () => {
    const brief = reviewBrief({ ...MATERIAL, request: 'x'.repeat(5_000) })
    expect(brief).toContain('…')
    expect(brief.length).toBeLessThan(3_000)
  })
})
