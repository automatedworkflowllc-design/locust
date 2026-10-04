import { describe, expect, it } from 'vitest'

import { markedCancelling } from './App.js'

// Code review B4, renderer-thread (d): Stop marked a run cancelling whatever
// it was. A run that completed between the render and the click became
// "cancelling"; the host's "nothing is running" answer then put it back to
// running, for good.
type Run = Parameters<typeof markedCancelling>[0]
const run = (phase: string, error?: string): Run =>
  ({ prompt: 'p', phase, events: [], ...(error === undefined ? {} : { error }) }) as unknown as Run

describe('a Stop press on a run', () => {
  it('marks a running run cancelling, clearing its error', () => {
    expect(markedCancelling(run('running', 'old'))).toMatchObject({ phase: 'cancelling', error: undefined })
  }, 10_000)

  it('leaves a run that has already finished exactly as it was', () => {
    for (const phase of ['completed', 'failed', 'cancelled']) {
      const finished = run(phase, 'kept')
      expect(markedCancelling(finished)).toBe(finished)
    }
  }, 10_000)
})
