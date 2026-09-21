import { describe, expect, it } from 'vitest'

import { createOpenCodeEventNormalizer } from './opencode-events.js'
import type { NormalizedRuntimeEvent } from './index.js'

/**
 * A run stopped by Locust's OWN policy must not read as a broken runtime.
 *
 * Sol's beta review of 0.225.0, ranked embarrassing. In Ask mode a run was
 * asked to create a file. No file was written — the boundary held exactly as
 * designed — and the card said *"OpenCode ended without a step that reported
 * it had stopped"* above the runtime's own `auto-rejecting` line. Sol's
 * conclusion: *"A new user is likely to conclude Ask mode or OpenCode is
 * broken."*
 *
 * The mechanism is ours and it is deliberate: Ask mode sets `bash: "ask"`,
 * `opencode run` is non-interactive, so the shell call is auto-rejected and
 * the process ends before its own stop step. Knowing all of that, printing
 * the vaguest sentence available was the wrong choice.
 */

const completion = (stderr: string) => ({
  exitCode: 1,
  stderr,
  stdout: '',
  cancelled: false,
  outputLimitExceeded: false
})

const failureFrom = (stderr: string): NormalizedRuntimeEvent | undefined => {
  const normalizer = createOpenCodeEventNormalizer({ runId: 'r', missionId: 'm' } as never)
  return normalizer.finish(completion(stderr) as never).find((event) => event.type === 'run.failed')
}

const said = (event: NormalizedRuntimeEvent | undefined): string =>
  String((event?.payload as { message?: unknown } | undefined)?.message ?? '')

describe('a refusal is not a crash', () => {
  it('names the tool the mode refused, not the missing stop step', () => {
    const message = said(failureFrom('! permission requested: bash (Test-Path forbidden-ask.txt); auto-rejecting\n'))
    expect(message).toContain('does not allow bash')
    expect(message).toContain('Nothing was changed')
    expect(message).not.toContain('ended without a step')
  })

  it('covers the other three tools a mode can deny', () => {
    for (const tool of ['edit', 'write', 'patch']) {
      expect(said(failureFrom(`permission requested: ${tool} (a.txt); auto-rejecting`))).toContain(
        `does not allow ${tool}`
      )
    }
  })

  it('leaves the folder refusal saying which folder', () => {
    // That one tells the person something about their own mission, so it
    // stays ahead of this and keeps its own words.
    const message = said(failureFrom('permission requested: external_directory (C:/other/*); auto-rejecting'))
    expect(message).toContain('outside the folder this run may use')
  })

  it('still says the vague thing when there is nothing better to say', () => {
    expect(said(failureFrom(''))).toContain('ended without a step that reported it had stopped')
  })
})
