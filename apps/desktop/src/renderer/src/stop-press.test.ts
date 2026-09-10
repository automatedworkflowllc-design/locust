import { describe, expect, it } from 'vitest'

import { isStoppable, stopPress } from './stopPress.js'

/**
 * The stop button, on the turn where it used to do nothing.
 *
 * Driven finding, 2026-09-10: on the SECOND turn of a conversation the press
 * was dropped -- the run was still `starting`, so it had no run id to cancel
 * by -- and the mission ran to completion, 200 of 200 numbers, on Claude Code
 * and on Codex CLI alike. The first turn resolved fast enough to hide it,
 * which is why the button had passed every earlier drive.
 */

const starting = { phase: 'starting' as const }
const running = { phase: 'running' as const, data: { runId: 'run_7' } }

describe('what pressing stop means', () => {
  it('cancels by name when the run has one', () => {
    expect(stopPress(running, 'run_7')).toEqual({ kind: 'cancel', runId: 'run_7' })
  })

  it('remembers the press when the run is still starting, instead of dropping it', () => {
    // The whole defect in one line: this used to be `nothing`.
    expect(stopPress(starting, 'pending:2')).toEqual({ kind: 'cancel-when-named', key: 'pending:2' })
  })

  it('is still remembered on a run that is starting a SECOND turn', () => {
    // The case actually measured: a follow-up sits at `pending:N` for
    // seconds while the runtime is already streaming.
    expect(stopPress({ phase: 'starting' }, 'pending:9')).toEqual({
      kind: 'cancel-when-named',
      key: 'pending:9'
    })
  })

  it('does nothing when nothing is running', () => {
    expect(stopPress(undefined, 'run_7')).toEqual({ kind: 'nothing' })
    expect(stopPress({ phase: 'completed' }, 'run_7')).toEqual({ kind: 'nothing' })
    expect(stopPress({ phase: 'failed' }, 'run_7')).toEqual({ kind: 'nothing' })
    expect(stopPress({ phase: 'cancelled' }, 'run_7')).toEqual({ kind: 'nothing' })
  })

  it('does nothing when a starting run has no key to be remembered by', () => {
    expect(stopPress(starting, undefined)).toEqual({ kind: 'nothing' })
  })

  it('takes a second press on a run already cancelling, because the first may not have landed', () => {
    expect(stopPress({ phase: 'cancelling', data: { runId: 'run_7' } }, 'run_7')).toEqual({
      kind: 'cancel',
      runId: 'run_7'
    })
  })

  it('agrees with the phases the composer draws the button for', () => {
    // The button and the press must read the same set, or the box offers a
    // control that does nothing -- which is exactly what happened.
    for (const phase of ['starting', 'running', 'cancelling']) {
      expect(isStoppable(phase)).toBe(true)
      expect(stopPress({ phase }, 'k').kind).not.toBe('nothing')
    }
    for (const phase of ['completed', 'failed', 'cancelled', undefined]) {
      expect(isStoppable(phase)).toBe(false)
    }
  })
})
