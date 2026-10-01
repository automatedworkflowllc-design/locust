import { describe, expect, it } from 'vitest'

import type { PublicMissionCheckpoint } from '../../shared/ipc.js'
import { resumeOffer, resumePoint } from './resume.js'

const checkpoint = (over: Partial<PublicMissionCheckpoint> = {}): PublicMissionCheckpoint => ({
  epoch: 1,
  reason: 'shutdown',
  resumeSafety: 'safe',
  safetyReason: 'Every recorded action reported an outcome and the ledger was read to its end.',
  createdAt: '2026-09-05T14:41:00.000Z',
  unsettledActions: [],
  ...over
})

const mission = (over: {
  readonly phase?: 'completed' | 'failed' | 'cancelled' | 'interrupted'
  readonly checkpoints?: readonly PublicMissionCheckpoint[]
  readonly integrityIssueCount?: number
} = {}) => ({
  phase: over.phase ?? ('interrupted' as const),
  checkpoints: over.checkpoints ?? [checkpoint()],
  integrityIssueCount: over.integrityIssueCount ?? 0
})

describe('which checkpoint a resume starts from', () => {
  it('takes the newest, not the first', () => {
    // An earlier epoch describes a state the mission has already moved past;
    // continuing from it would redo work the ledger says was finished.
    const point = resumePoint([checkpoint({ epoch: 1 }), checkpoint({ epoch: 3 }), checkpoint({ epoch: 2 })])
    expect(point?.epoch).toBe(3)
  })

  it('has nothing to offer when none were written', () => {
    expect(resumePoint([])).toBeUndefined()
  })
})

describe('what an interrupted mission is offered', () => {
  it('offers a resume when the record is whole', () => {
    const offer = resumeOffer(mission())
    expect(offer?.kind).toBe('resume')
    expect(offer?.kind === 'resume' && offer.epoch).toBe(1)
  })

  it('offers it WITH the doubt named when an action never reported back', () => {
    // The two failures must not be collapsed: this one says the ledger is
    // trustworthy and an outcome is genuinely unknowable, which a person can
    // check for themselves before saying go.
    const offer = resumeOffer(
      mission({
        checkpoints: [
          checkpoint({
            resumeSafety: 'approval-required',
            safetyReason: 'One action started and never reported an outcome, so whether it took effect is unknown.',
            unsettledActions: [{ itemId: 'i1', name: 'npm publish' }]
          })
        ]
      })
    )
    expect(offer?.kind).toBe('resume-with-doubt')
    expect(offer?.kind === 'resume-with-doubt' && offer.unverified).toEqual(['npm publish'])
  })

  it('refuses when the ledger cannot be trusted to say what happened', () => {
    // Offering a cheerful Resume here would be the app claiming to continue
    // from a record it has already called incomplete.
    const offer = resumeOffer(
      mission({ checkpoints: [checkpoint({ resumeSafety: 'unsafe', safetyReason: 'The ledger stopped short.' })] })
    )
    expect(offer?.kind).toBe('refused')
  })

  it('refuses when recovery reported an issue, whatever the checkpoint concluded', () => {
    // The checkpoint is itself read from the file that could not be read
    // whole, so it does not get to overrule the reader.
    const offer = resumeOffer(mission({ integrityIssueCount: 1 }))
    expect(offer?.kind).toBe('refused')
  })

  it('says so plainly when nothing was written before the stop', () => {
    // A missing button is indistinguishable from a broken one.
    const offer = resumeOffer(mission({ checkpoints: [] }))
    expect(offer?.kind).toBe('refused')
    expect(offer?.kind === 'refused' && offer.note).toContain('no point to pick up from')
  })

  it.each([['completed'], ['failed']] as const)('offers nothing for a %s mission', (phase) => {
    // Completed has nothing to resume; a failed run needs its failure
    // understood rather than papered over. Both already have the composer.
    expect(resumeOffer(mission({ phase }))).toBeUndefined()
  })

  it('offers a resume for a run the app closed underneath', () => {
    // MEASURED, not assumed: closing the app mid-run records the mission
    // `cancelled` -- the host cancels it on the way out -- and writes a
    // `shutdown` checkpoint. Keying on the `interrupted` phase alone made a
    // feature that could never fire.
    const offer = resumeOffer(
      mission({ phase: 'cancelled', checkpoints: [checkpoint({ reason: 'shutdown' })] })
    )
    expect(offer?.kind).toBe('resume')
  })

  it('offers nothing to someone who pressed Stop', () => {
    // Their checkpoint is `manual`, and offering to undo a decision they made
    // on purpose reads as the app arguing with them.
    expect(
      resumeOffer(mission({ phase: 'cancelled', checkpoints: [checkpoint({ reason: 'manual' })] }))
    ).toBeUndefined()
  })

  it('offers nothing for a cancelled run that wrote no checkpoint at all', () => {
    expect(resumeOffer(mission({ phase: 'cancelled', checkpoints: [] }))).toBeUndefined()
  })
})
