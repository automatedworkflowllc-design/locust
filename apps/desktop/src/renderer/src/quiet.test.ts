import { describe, expect, it } from 'vitest'

import { hasBeenQuiet, QUIET_SECONDS_BEFORE_SAYING_SO } from './quiet.js'

/*
 * Colin, 2026-09-13: "tool calls took over 2 minutes to appear... is this
 * working as intended or are the tool calls loading late?"
 *
 * MEASURED in that mission's own ledger (`mission_3848a498`): `run.started`
 * at 3.5s, then NOT ONE runtime event until 128.7s, at which point thirty
 * arrived inside three seconds. Nothing was loading late -- Cursor said
 * nothing for over two minutes. What was missing was any way for the app to
 * say that, so "working ..." covered both a run thinking and a run hung.
 *
 * The room has said this since 2026-09-11. This is the same rule, in a module
 * neither surface owns, so the two can never drift apart.
 */
describe('saying that nothing has come back yet', () => {
  const at = (seconds: number): number => Date.parse('2026-09-13T17:56:55.000Z') + seconds * 1_000
  const START = '2026-09-13T17:56:55.000Z'

  it('says nothing while the silence is still ordinary', () => {
    expect(hasBeenQuiet(START, at(0))).toBe(false)
    expect(hasBeenQuiet(START, at(QUIET_SECONDS_BEFORE_SAYING_SO - 1))).toBe(false)
  })

  it('speaks up at the threshold and stays up', () => {
    expect(hasBeenQuiet(START, at(QUIET_SECONDS_BEFORE_SAYING_SO))).toBe(true)
    // The measured case: 128 seconds of nothing.
    expect(hasBeenQuiet(START, at(128.7))).toBe(true)
  })

  it('is the number the room uses, not a second opinion about it', () => {
    // If this ever fails, two surfaces are describing one silence differently.
    expect(QUIET_SECONDS_BEFORE_SAYING_SO).toBe(20)
  })

  it('an unreadable timestamp is never reported as quiet', () => {
    // Inventing a complaint from a bad clock would be worse than saying less.
    expect(hasBeenQuiet('not a date', at(600))).toBe(false)
  })
})
