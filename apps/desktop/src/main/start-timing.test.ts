import { describe, expect, it } from 'vitest'

import { startTimingNote, startTimingSentence } from './start-timing.js'

/*
 * 0.602. The ledger dated a mission's creation and the runtime's "started"
 * and nothing between: 4.5 to 10.5 s per runtime (10/04) that nobody could
 * split. The start path marks its phases; this is the sentence the run's end
 * writes from them.
 */
describe('where the seconds before "started" went', () => {
  const t0 = 1_000_000
  it('names every phase that ran, in order, and the runtime boot last', () => {
    const sentence = startTimingSentence({
      sentAt: t0,
      phaseAt: { looking: t0 + 50, briefing: t0 + 150, 'reading-folder': t0 + 1_550, 'starting-runtime': t0 + 2_350 },
      firstEventAt: t0 + 6_250
    }, 'Codex')
    expect(sentence).toBe('Started in 6.3 s: looked for Codex 0.1 s, briefed 1.4 s, read the folder 0.8 s; Codex took 3.9 s to say it had started.')
  })

  it('leaves out a phase that did not run (a read-only run reads no folder)', () => {
    const sentence = startTimingSentence({
      sentAt: t0,
      phaseAt: { looking: t0 + 100, briefing: t0 + 200, 'starting-runtime': t0 + 1_200 },
      firstEventAt: t0 + 4_200
    }, 'Claude Code')
    expect(sentence).toBe('Started in 4.2 s: looked for Claude Code 0.1 s, briefed 1.0 s; Claude Code took 3.0 s to say it had started.')
  })

  it('says nothing before the runtime has said anything, and dates a start that marked no phase by its total', () => {
    expect(startTimingSentence({ sentAt: t0, phaseAt: {} }, 'Codex')).toBeUndefined()
    expect(startTimingSentence({ sentAt: t0, phaseAt: {}, firstEventAt: t0 + 2_000 }, 'Codex')).toBe('Started in 2.0 s.')
  })

  it('is written as an info note from the host, after the run, with the next sequence', () => {
    const note = startTimingNote({
      runId: 'run_1', missionId: 'mission_1', sourceAdapter: 'codex', nextSequence: 41, at: '2026-10-04T20:00:00.000Z', runtimeName: 'Codex',
      timing: { sentAt: t0, phaseAt: { 'starting-runtime': t0 + 500 }, firstEventAt: t0 + 3_500 }
    })
    expect(note).toMatchObject({ type: 'adapter.diagnostic', sequence: 41, payload: { level: 'info', code: 'host.start-timing', terminal: false, message: 'Started in 3.5 s: Codex took 3.0 s to say it had started.' } })
    expect(startTimingNote({ runId: 'run_1', missionId: 'mission_1', sourceAdapter: 'codex', nextSequence: 1, at: '2026-10-04T20:00:00.000Z', runtimeName: 'Codex', timing: { sentAt: t0, phaseAt: {} } })).toBeUndefined()
  })
})
