import { describe, expect, it } from 'vitest'

import { clockOf } from './missionView.js'

/**
 * The Signal Rail's clock, formatted by one kept formatter instead of a new
 * one per event per render (34 ms a render at 500 events, 2026-09-22). The
 * point is that nothing a person reads changes, so it is held to the call it
 * replaced.
 */
describe('the rail clock is made once', () => {
  it('says exactly what toLocaleTimeString said', () => {
    for (const iso of ['2026-09-22T00:00:00.000Z', '2026-09-22T12:34:56.000Z', '2026-12-31T23:59:59.999Z']) {
      expect(clockOf(iso)).toBe(new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    }
  })

  it('says nothing for a time that is not one', () => {
    expect(clockOf('not a time')).toBe('')
  })
})
