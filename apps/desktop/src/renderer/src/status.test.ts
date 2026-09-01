import { describe, expect, it } from 'vitest'

import type { PublicRuntimeStatus } from '../../shared/ipc.js'
import {
  checkpointLabel,
  connectedRuntimeCount,
  ledgerVerificationLabel,
  missionPhaseView,
  routeRowStatus,
  runtimeIsUsable,
  shortMissionId,
  teammateStatusView
} from './status.js'

function runtime(overrides: Partial<PublicRuntimeStatus> = {}): PublicRuntimeStatus {
  return {
    id: 'codex',
    displayName: 'Codex CLI',
    installed: true,
    version: '0.151.0-alpha.7.2',
    auth: 'authenticated',
    ready: true,
    status: 'ready',
    ...overrides
  }
}

describe('nothing is live unless discovery proved it', () => {
  // This is the invariant the product's trust claim rests on. If it can be
  // broken, every other label in the shell is decoration.
  it('never issues ACTIVE or READY for a runtime that is not ready', () => {
    const notReady: readonly Partial<PublicRuntimeStatus>[] = [
      { ready: false, status: 'probe-failed' },
      { ready: false, status: 'offline' },
      { ready: false, status: 'auth-required' },
      { ready: false, status: 'not-installed', installed: false },
      // The dangerous one: a probe that failed while a stale `ready` flag
      // survived. Either field alone must be enough to withhold the label.
      { ready: true, status: 'probe-failed' },
      { ready: false, status: 'ready' }
    ]
    for (const overrides of notReady) {
      const status = routeRowStatus(runtime(overrides), 'live', true)
      expect(status.tag).not.toBe('ACTIVE')
      expect(status.tag).not.toBe('READY')
      expect(status.selectable).toBe(false)
    }
  })

  it('marks a ready runtime active only when it is the active one', () => {
    expect(routeRowStatus(runtime(), 'live', true).tag).toBe('ACTIVE')
    expect(routeRowStatus(runtime(), 'live', false).tag).toBe('READY')
  })

  it('never calls a half-built adapter live, even when its runtime is ready', () => {
    const status = routeRowStatus(runtime({ id: 'claude', displayName: 'Claude Code' }), 'preview', true)
    expect(status.tag).toBe('PREVIEW')
    // Selectable is the point -- Claude must be visibly choosable -- but the
    // row has to say the adapter is unfinished rather than imply durability.
    expect(status.selectable).toBe(true)
    expect(status.detail).toMatch(/not finished/)
  })

  it('keeps a planned runtime non-interactive whatever discovery says', () => {
    const status = routeRowStatus(runtime({ ready: true, status: 'ready' }), 'planned', true)
    expect(status.tag).toBe('PLANNED')
    expect(status.selectable).toBe(false)
  })

  it('separates sign-in from missing and from broken', () => {
    expect(routeRowStatus(runtime({ installed: false, ready: false, status: 'not-installed' }), 'live', false).tag)
      .toBe('UNAVAILABLE')
    expect(routeRowStatus(runtime({ ready: false, status: 'auth-required', auth: 'unauthenticated' }), 'live', false).tag)
      .toBe('SIGN IN')
    expect(routeRowStatus(runtime({ ready: false, status: 'offline' }), 'live', false).detail)
      .toMatch(/could not be reached/)
  })

  it('counts only usable runtimes as connected', () => {
    expect(
      connectedRuntimeCount([
        runtime(),
        runtime({ id: 'claude', ready: false, status: 'auth-required' }),
        runtime({ id: 'omniroute', ready: false, status: 'not-installed', installed: false })
      ])
    ).toBe(1)
  })
})

describe('teammate status', () => {
  it('reports a blocked runtime even while a mission looks like it is running', () => {
    const view = teammateStatusView({
      runtime: runtime({ ready: false, status: 'auth-required' }),
      hasRunningMission: true,
      pendingApprovals: 0,
      roleLabel: 'Code & Migrations'
    })
    expect(view.status).toBe('blocked')
    expect(view.tone).toBe('red')
  })

  it('puts a pending approval ahead of working', () => {
    const view = teammateStatusView({
      runtime: runtime(),
      hasRunningMission: true,
      pendingApprovals: 1,
      roleLabel: 'Code & Migrations'
    })
    expect(view.status).toBe('approval-needed')
  })

  it('pulses only while working', () => {
    const working = teammateStatusView({
      runtime: runtime(),
      hasRunningMission: true,
      pendingApprovals: 0,
      roleLabel: 'Code & Migrations'
    })
    const idle = teammateStatusView({
      runtime: runtime(),
      hasRunningMission: false,
      pendingApprovals: 0,
      roleLabel: 'Code & Migrations'
    })
    expect(working.pulse).toBe(true)
    expect(idle.pulse).toBe(false)
    expect(idle.label).toMatch(/idle$/)
  })
})

describe('mission phase and receipt truth', () => {
  it('distinguishes every terminal phase', () => {
    expect(missionPhaseView('running').tag).toBe('RUNNING')
    expect(missionPhaseView('completed').tag).toBe('COMPLETED')
    expect(missionPhaseView('interrupted').tag).toBe('INTERRUPTED')
    expect(missionPhaseView('failed').tag).toBe('FAILED')
    expect(missionPhaseView('cancelled').tag).toBe('CANCELLED')
  })

  it('will not present a completed mission as clean when its ledger is not', () => {
    // The run finished; its record did not. The receipt card must not print
    // `verified` over that, and the phase line must not read plain "Completed".
    const view = missionPhaseView('completed', true)
    expect(view.tone).toBe('amber')
    expect(view.label).toMatch(/incomplete/)
    expect(ledgerVerificationLabel(1)).toBe('incomplete')
    expect(ledgerVerificationLabel(0)).toBe('verified')
  })
})

describe('provenance formatting', () => {
  it('shortens a real mission id rather than inventing a counter', () => {
    expect(shortMissionId('mission_b806b862-bd4d-4fad-a011-efea6140f46d')).toBe('b806b862')
    expect(shortMissionId('b806b862-bd4d')).toBe('b806b862')
  })

  it('labels checkpoints from their 1-based epoch', () => {
    expect(checkpointLabel(1)).toBe('ck_1')
    expect(checkpointLabel(14)).toBe('ck_14')
  })

  it('treats usability as needing both the flag and the probe', () => {
    expect(runtimeIsUsable(runtime())).toBe(true)
    expect(runtimeIsUsable(runtime({ ready: false }))).toBe(false)
    expect(runtimeIsUsable(runtime({ status: 'probe-failed' }))).toBe(false)
  })
})
