import { describe, expect, it } from 'vitest'

import { bootView, emptyBoot } from './bootView.js'
import type { BootState } from './bootView.js'
import { teammateStatusView } from './status.js'
import type { PublicRuntimeStatus } from '../../shared/ipc.js'

/**
 * What Locust says to someone who has installed none of the coding CLIs.
 *
 * Every measurement this project had ever taken was on a machine with all
 * six on PATH. Grok's pass 4 was the first drive from the other side — a
 * bare PATH, no coding agents, and no Node either — and it is the condition
 * the next beta tester is actually in.
 *
 * Two things it found were the app talking about a machine other than the
 * one it was running on.
 */

const runtime = (over: Partial<PublicRuntimeStatus>): PublicRuntimeStatus =>
  ({
    id: 'opencode',
    displayName: 'OpenCode',
    installed: false,
    version: null,
    auth: 'unknown',
    ready: false,
    status: 'not-installed',
    ...over
  }) as PublicRuntimeStatus

const view = (input: Parameters<typeof teammateStatusView>[0]) => teammateStatusView(input)

describe('a teammate on a machine with no CLI is not asked to sign in', () => {
  /*
   * Grok, 2026-09-15: Settings said OpenCode **NOT INSTALLED**; the roster
   * row beside it said **Runtime sign-in required**, in red. "There is
   * nothing to sign in to. The CLI is not there."
   *
   * Two facts wore one sentence. The wrong one was on the screen a person
   * stares at right after naming their first teammate, and the screen that
   * knew the truth was two clicks away. An instruction you cannot follow is
   * worse than no instruction.
   */
  const base = { pendingApprovals: 0, hasRunningMission: false, runtime: undefined, roleLabel: 'Code & Migrations' } as const

  it('says nothing is installed when nothing is', () => {
    const said = view({ ...base, anyRuntimeUsable: false, anyRuntimeInstalled: false })
    expect(said.label).toBe('No AI agent installed')
    expect(said.label).not.toContain('sign in')
  })

  it('still says sign in when something IS installed and merely unsigned', () => {
    // The sentence was not wrong, only over-applied. It has to survive.
    expect(view({ ...base, anyRuntimeUsable: false, anyRuntimeInstalled: true }).label)
      .toBe('Sign-in needed')
  })

  it("makes the same distinction for the teammate's own runtime", () => {
    expect(view({ ...base, runtime: runtime({ installed: false, status: 'not-installed' }) }).label)
      .toBe('AI agent not installed')
    expect(view({ ...base, runtime: runtime({ installed: true, status: 'auth-required' }) }).label)
      .toBe('Sign-in needed')
  })

  it('is still blocked and still red either way, because neither can run', () => {
    // The fix is about the WORDS. Both states stop work, and a teammate that
    // looked fine while unable to run would be the worse defect.
    for (const installed of [true, false]) {
      const said = view({ ...base, anyRuntimeUsable: false, anyRuntimeInstalled: installed })
      expect(said.status).toBe('blocked')
      expect(said.tone).toBe('red')
    }
  })

  it('does not reach for either sentence when a runtime is fine', () => {
    expect(view({ ...base, anyRuntimeUsable: true, anyRuntimeInstalled: true }).label)
      .not.toContain('sign in')
  })
})

describe('the loading screen does not do arithmetic about an empty set', () => {
  /*
   * On a bare machine this is the ONLY frame anyone sees. A probe for a
   * binary that is not on PATH answers in about 10ms because nothing is
   * spawned, so the whole ceremony is over in about half a second — Grok
   * measured the splash listed at 340ms and the app up at 636ms — and
   * `checking 0 of 0 runtimes` is the line it flashes.
   *
   * "Empty arithmetic, not reassurance." The welcome behind it already says
   * the true thing; this line just had to stop counting nothing.
   */
  it('says what it is doing when there is nothing to count', () => {
    const said = bootView(emptyBoot, 'probing', Date.now()).progress
    expect(said).not.toContain('0 of 0')
    expect(said).toContain('looking for')
  })

  it('still counts once there is something to count', () => {
    // The count is the right line the moment the number means anything, and
    // removing it would cost the stall case -- five shims sleeping for ever
    // -- its only progress signal.
    const probing: BootState = {
      phase: 'probing',
      probes: [{ id: 'codex', bin: 'codex', product: 'Codex CLI', at: Date.now() }]
    }
    expect(bootView(probing, 'probing', Date.now()).progress).toContain('of 1')
  })
})
