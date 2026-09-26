import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Code review B4, renderer-thread (e): Stop pressed while a message was still
 * starting, then answered "a run is already active", still queued the message
 * -- and the queue sent it when the run in front ended. The person had pressed
 * Stop on it.
 *
 * A source guard, like the App's other start-path guards: the busy branch
 * lives inside the component. It must consult the Stop-while-starting record
 * BEFORE it queues, and give the words back instead.
 */
const APP = readFileSync(fileURLToPath(new URL('../renderer/src/App.tsx', import.meta.url)), 'utf8')

describe('a message stopped while it was starting', () => {
  it('is given back, not queued, when the host answers busy', () => {
    const busy = APP.indexOf("if (response.error.code === 'RUN_ALREADY_ACTIVE') {")
    expect(busy).toBeGreaterThan(0)
    const branch = APP.slice(busy, busy + 3_000)
    const stopped = branch.indexOf('if (cancelWhenNamedRef.current.delete(key)) {')
    const queued = branch.indexOf('if (inFront !== undefined) {')

    expect(stopped).toBeGreaterThan(0)
    expect(queued).toBeGreaterThan(stopped)
    expect(branch.slice(stopped, queued)).toContain("startRefusal.current = 'Stopped before it was sent. Your message is back in the box.'")
    expect(branch.slice(stopped, queued)).toContain('return false')
  }, 10_000)
})
