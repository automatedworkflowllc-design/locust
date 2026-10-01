import { describe, expect, it } from 'vitest'

import { facePresenceFor, runtimeOfTeammate, teammateStatusView } from './status.js'

/**
 * A teammate whose runtime is signed out does not say "idle".
 *
 * Astra's Finding 1, 2026-09-14, measured on 0.110.0 with a private profile
 * whose `CLAUDE_CONFIG_DIR` pointed at an empty directory. A brand-new Claude
 * teammate, Wisp:
 *
 *   Settings -- "Installed, but Claude Code is not signed in", red SIGN IN,
 *               `run claude` beside it. Correct.
 *   Sidebar  -- "Docs & QA - idle".
 *
 * Idle is the word for a teammate with nothing to do. This one COULD NOT DO
 * ANYTHING, the app knew, and the surface a person looks at first said the
 * wrong word. Her note on why it matters is the right one: the user is left to
 * reconcile two surfaces that disagree, on their first five minutes with the
 * product.
 *
 * The cause was not the dot -- 0.109.0 had already made three surfaces draw
 * one dot from one function. It was the STATE behind the dot. A teammate's
 * runtime was read from its MISSIONS, and a teammate that has never run has
 * none, so the sign-in check was skipped for exactly the teammates a person
 * is most likely to be looking at: the ones they just made.
 *
 * Her Action also asks that a mission blocked on an APPROVAL keep its own
 * state and not be conflated with this. The last test here holds that line.
 */

const claudeSignedOut = {
  id: 'claude',
  ready: false,
  installed: true,
  status: 'signed-out'
} as unknown as Parameters<typeof teammateStatusView>[0]['runtime']

const codexReady = {
  id: 'codex',
  ready: true,
  installed: true,
  status: 'ready'
} as unknown as Parameters<typeof teammateStatusView>[0]['runtime']

describe('a teammate that has never run', () => {
  it('is judged by the route it is set to use', () => {
    // Wisp: made on Claude, no missions at all. THE case.
    expect(runtimeOfTeammate({ route: { runtime: 'claude' } }, [])).toBe('claude')
  })

  it('still prefers a running mission, then a past one, over the route', () => {
    const onClaude = { route: { runtime: 'claude' } }
    expect(runtimeOfTeammate(onClaude, [{ phase: 'running', runtime: 'codex' }])).toBe('codex')
    expect(runtimeOfTeammate(onClaude, [{ phase: 'completed', runtime: 'cursor' }])).toBe('cursor')
    // A running one outranks a finished one.
    expect(
      runtimeOfTeammate(onClaude, [
        { phase: 'completed', runtime: 'cursor' },
        { phase: 'running', runtime: 'opencode' }
      ])
    ).toBe('opencode')
  })

  it('is judged by nothing when it has neither missions nor a route', () => {
    expect(runtimeOfTeammate({}, [])).toBeUndefined()
  })

  it('reads as blocked, not idle, when its runtime is signed out', () => {
    const view = teammateStatusView({
      runtime: claudeSignedOut,
      anyRuntimeUsable: true, // Codex IS ready -- which is why this was missed.
      hasRunningMission: false,
      pendingApprovals: 0,
      roleLabel: 'Docs & QA'
    })
    expect(view.status).toBe('blocked')
    expect(view.label).toBe('Sign-in needed')
    expect(view.label).not.toContain('idle')
    expect(view.tone).toBe('red')
    // And the dot every surface draws from it.
    expect(facePresenceFor(view.status)).toBe('blocked')
  })

  it('still reads as idle when its own runtime is fine', () => {
    const view = teammateStatusView({
      runtime: codexReady,
      anyRuntimeUsable: true,
      hasRunningMission: false,
      pendingApprovals: 0,
      roleLabel: 'Docs & QA'
    })
    expect(view.status).toBe('idle')
    expect(facePresenceFor(view.status)).toBe('none')
  })

  it('keeps a mission waiting on an approval as its own state, not blocked', () => {
    // Astra: "Preserve a separate state for a mission actually blocked on an
    // approval; don't conflate the two." A sign-in wall is the app's problem;
    // an approval is the person's decision, and they are different colours,
    // different words and different actions.
    const view = teammateStatusView({
      runtime: codexReady,
      anyRuntimeUsable: true,
      hasRunningMission: true,
      pendingApprovals: 1,
      roleLabel: 'Builder'
    })
    expect(view.status).toBe('approval-needed')
    expect(facePresenceFor(view.status)).toBe('approval')
    expect(view.tone).toBe('amber')
  })

  it('is blocked when nothing at all is signed in, whatever it is set to', () => {
    const view = teammateStatusView({
      runtime: undefined,
      anyRuntimeUsable: false,
      hasRunningMission: false,
      pendingApprovals: 0,
      roleLabel: 'Docs & QA'
    })
    expect(view.status).toBe('blocked')
  })
})

/*
 * L18 (the code review): an installed runtime that had not answered its
 * probe yet -- Claude Code's first version probe can outlast the window on a
 * cold start -- was labelled "Runtime sign-in required", an instruction to
 * do something nobody needed to do. Settings already says CHECKING.
 */
describe('a teammate whose runtime has not answered yet', () => {
  const base = { hasRunningMission: false, pendingApprovals: 0, roleLabel: 'Code & Migrations', anyRuntimeUsable: true, anyRuntimeInstalled: true }
  it('is not told to sign in', () => {
    for (const status of ['probe-failed', 'offline']) {
      const runtime = { id: 'claude', ready: false, installed: true, auth: 'unknown', status } as unknown as Parameters<typeof teammateStatusView>[0]['runtime']
      const view = teammateStatusView({ ...base, runtime })
      expect(view.label, status).not.toMatch(/sign-in/i)
      expect(view.label, status).toMatch(/not answering/i)
    }
  })

  it('still is, when the runtime says it is signed out', () => {
    const runtime = { id: 'claude', ready: false, installed: true, auth: 'unauthenticated', status: 'auth-required' } as unknown as Parameters<typeof teammateStatusView>[0]['runtime']
    expect(teammateStatusView({ ...base, runtime }).label).toBe('Sign-in needed')
  })
})
