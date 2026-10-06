import { describe, expect, it } from 'vitest'

import { composeRuntimePrompt, composeSoloPrompt, narrateSection, runtimeNarratesWhenAsked } from './workroom-briefing.js'

/**
 * A QUIET RUNTIME IS ASKED TO SAY WHAT IT DOES (0.668). Antigravity's Flash
 * worked 23 minutes with nothing on screen but "Working..." (Colin, 10/05).
 * Measured 10/06, the same read-only task twice each way: no words between its
 * steps when nothing was asked, a sentence before each step with this line.
 */
describe('the line that asks a runtime to narrate', () => {
  it('goes to Antigravity, and not to runtimes that narrate on their own', () => {
    expect(runtimeNarratesWhenAsked('antigravity')).toBe(true)
    for (const runtime of ['claude', 'codex', 'cursor', 'opencode', 'copilot']) expect(runtimeNarratesWhenAsked(runtime)).toBe(false)
  })

  it('is in a run nobody owns when asked for, and not when not', () => {
    expect(composeSoloPrompt({ prompt: 'Review it.', keepATodoList: false, narrate: true }).prompt).toContain(narrateSection())
    expect(composeSoloPrompt({ prompt: 'Review it.', keepATodoList: false }).prompt).not.toContain(narrateSection())
  })

  it('is in a teammate run when asked for', () => {
    const peer = { self: { teammateId: 'tm_flash', name: 'Flash', role: 'Code & Migrations' }, others: [] } as never
    const asked = composeRuntimePrompt({ prompt: 'Review it.', peer, inbound: [], remaining: 0, narrate: true, now: new Date('2026-10-06T00:00:00Z') })
    expect(asked.prompt).toContain(narrateSection())
    const not = composeRuntimePrompt({ prompt: 'Review it.', peer, inbound: [], remaining: 0, now: new Date('2026-10-06T00:00:00Z') })
    expect(not.prompt).not.toContain(narrateSection())
  })
})
