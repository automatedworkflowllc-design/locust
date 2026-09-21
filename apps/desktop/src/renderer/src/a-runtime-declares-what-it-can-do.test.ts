import { describe, expect, it } from 'vitest'

import type { MissionMode } from '../../shared/ipc.js'
import { RUNTIME_CAPABILITIES, modeRunsOn } from './status.js'

/**
 * A runtime cannot claim a mode by saying nothing.
 *
 * `modeRunsOn` was a chain of `if` clauses ending in `return true`, each
 * clause a war story worth keeping — and the fall-through was the defect.
 *
 * MEASURED 2026-09-21, by accident, while adding Muse: putting `muse` into
 * `MissionRuntimeId` made the app offer **Ask, Accept edits, Auto and Plan**
 * on a runtime with no adapter, no command builder and no event normalizer.
 * Nothing asked; silence meant yes.
 *
 * (A correction worth recording: I first reported that adding the runtime
 * "broke nothing — typecheck clean, 3,689 green". That was a stale package
 * build. Rebuilt, the compiler named two exhaustive records it had to be
 * added to. The tooling was better than my account of it.)
 *
 * The first test below is the CONTROL. This commit is a refactor, so every
 * runtime that existed before must answer exactly as it did before, on both
 * platforms, for all five modes — the table was transcribed from the `if`
 * chain and a transcription error would be silent and awful.
 */
const MODES: readonly MissionMode[] = ['ask', 'accept-edits', 'approve-each', 'plan', 'auto']

/** Exactly what the `if` chain answered on 2026-09-21, before it was replaced. */
const BEFORE: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  win32: {
    codex: ['ask', 'accept-edits', 'approve-each', 'plan', 'auto'],
    claude: ['ask', 'accept-edits', 'plan', 'auto'],
    cursor: ['accept-edits', 'auto'],
    gemini: ['ask', 'accept-edits', 'plan', 'auto'],
    opencode: ['ask', 'accept-edits', 'plan', 'auto'],
    copilot: ['ask', 'accept-edits', 'plan', 'auto'],
    antigravity: ['accept-edits']
  },
  darwin: {
    codex: ['ask', 'accept-edits', 'approve-each', 'plan', 'auto'],
    claude: ['ask', 'accept-edits', 'plan', 'auto'],
    cursor: ['ask', 'accept-edits', 'plan', 'auto'],
    gemini: ['ask', 'accept-edits', 'plan', 'auto'],
    opencode: ['ask', 'accept-edits', 'plan', 'auto'],
    copilot: ['ask', 'accept-edits', 'plan', 'auto'],
    antigravity: ['accept-edits']
  }
}

describe('a runtime declares what it can do', () => {
  it('answers exactly as the if-chain did, for every runtime that already existed', () => {
    for (const [platform, byRuntime] of Object.entries(BEFORE)) {
      for (const [runtime, expected] of Object.entries(byRuntime)) {
        const actual = MODES.filter((mode) => modeRunsOn(mode, runtime as never, platform))
        expect(actual.sort(), `${runtime} on ${platform}`).toEqual([...expected].sort())
      }
    }
  })

  it('offers nothing at all for a runtime whose modes are unproven', () => {
    // Muse. The docs promise an OS sandbox and approval modes; the docs are
    // not a measurement, and a mode offered on a guess is a refusal with
    // extra steps. This is the case the old fall-through got wrong.
    expect(RUNTIME_CAPABILITIES.muse.modes).toEqual([])
    for (const mode of MODES) {
      expect(modeRunsOn(mode, 'muse', 'win32'), `muse must not claim ${mode}`).toBe(false)
    }
  })

  it('keeps plan available exactly where ask is, and never apart from it', () => {
    // Plan is derived from ask rather than declared, so the invariant cannot
    // drift: a plan that could edit the workspace is a promise the app cannot
    // keep. Declaring both would be two places to get it wrong.
    for (const platform of ['win32', 'darwin', undefined]) {
      for (const runtime of Object.keys(RUNTIME_CAPABILITIES)) {
        expect(modeRunsOn('plan', runtime as never, platform), `${runtime} on ${String(platform)}`)
          .toBe(modeRunsOn('ask', runtime as never, platform))
      }
    }
  })

  it('says how it knows, for every runtime', () => {
    // The other half of a conformance claim: an adapter must not advertise
    // what it cannot do, and the row has to say what backs it. `unproven`
    // is a placeholder, not a verdict.
    for (const [runtime, facts] of Object.entries(RUNTIME_CAPABILITIES)) {
      expect(['measured', 'unproven'], `${runtime} has no evidence field`).toContain(facts.evidence)
    }
    // Gemini is listed PLANNED and no mission can run under it, yet it has
    // always claimed three modes through the fall-through. Kept as it was so
    // the control above stays honest about what this change touched — but
    // the claim is now visible instead of implied by silence.
    expect(RUNTIME_CAPABILITIES.gemini.evidence).toBe('unproven')
  })

  it('platform bars only the platform named', () => {
    // Cursor's read-only mode is real on macOS and not on Windows, and the
    // bar must not leak to a platform nobody measured.
    expect(modeRunsOn('ask', 'cursor', 'win32')).toBe(false)
    expect(modeRunsOn('ask', 'cursor', 'darwin')).toBe(true)
    expect(modeRunsOn('ask', 'cursor', undefined)).toBe(true)
  })
})
