import { describe, expect, it } from 'vitest'

import type { PublicRuntimeStatus } from '../../shared/ipc.js'
import { keepWhatWasKnown, routeRowStatus } from './status.js'

/**
 * An agent the sweep went on without (main/sweep-settle.ts) is on screen as
 * installed and being checked -- not as one that failed. The row says what is
 * true, and a re-check that has not heard from it yet does not take away what
 * the last answer established.
 */
const checking: PublicRuntimeStatus = {
  id: 'opencode',
  displayName: 'OpenCode',
  installed: true,
  version: null,
  auth: 'not-applicable',
  ready: false,
  status: 'probe-failed',
  checking: true
}

describe('a row for an agent that is still being checked', () => {
  it('says it is being checked, and that Locust asks again -- not that it did not answer its version probe', () => {
    const row = routeRowStatus(checking, 'live', false)
    expect(row.tag).toBe('CHECKING')
    expect(row.selectable).toBe(false)
    expect(row.detail).toMatch(/OpenCode is still being checked/)
    expect(row.detail).not.toMatch(/version probe|sign|could not be reached/i)
  })

  it('still says what it always did for an agent that really did not answer', () => {
    const row = routeRowStatus({ ...checking, checking: undefined }, 'live', false)
    expect(row.detail).toMatch(/did not answer its version probe in time/)
  })

  it('keeps the last thing the agent said until its answer arrives', () => {
    const ready: PublicRuntimeStatus = { ...checking, status: 'ready', ready: true, version: '1.18.27', checking: undefined }
    expect(keepWhatWasKnown([ready], [checking])).toEqual([ready])
    // And its answer, when it comes, replaces the placeholder.
    const answered: PublicRuntimeStatus = { ...ready, version: '1.18.30' }
    expect(keepWhatWasKnown([checking], [answered])).toEqual([answered])
  })
})
