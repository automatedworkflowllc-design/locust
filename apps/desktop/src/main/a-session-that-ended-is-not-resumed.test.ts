import { describe, expect, it } from 'vitest'

import { runtimeThreadIdOf } from './codex-mission.js'

type Recovered = Parameters<typeof runtimeThreadIdOf>[0]

/**
 * M7 (the code review): OpenCode's "could not continue this session ... the
 * next message starts a fresh session" was not true -- the host resumed the
 * same dead session on the next reply, and it failed the same way. A failure
 * marked `sessionEnded` leaves nothing to resume.
 */
const mission = (events: readonly { readonly type: string; readonly payload: Record<string, unknown> }[]): Recovered =>
  ({ metadata: { missionId: 'mission_1' }, events }) as unknown as Recovered

describe('the session a follow-up resumes', () => {
  it('is none after a failure that ended the session', () => {
    expect(runtimeThreadIdOf(mission([
      { type: 'run.started', payload: { runtimeThreadId: 'ses_1' } },
      { type: 'run.failed', payload: { runtimeThreadId: 'ses_1', sessionEnded: true, kind: 'unknown', message: 'x' } }
    ]))).toBeUndefined()
  })

  it('is still the last one named after any other failure', () => {
    expect(runtimeThreadIdOf(mission([
      { type: 'run.started', payload: { runtimeThreadId: 'ses_1' } },
      { type: 'run.failed', payload: { runtimeThreadId: 'ses_1', kind: 'unknown', message: 'x' } }
    ]))).toBe('ses_1')
  })
})
