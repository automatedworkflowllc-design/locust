import { describe, expect, it } from 'vitest'

import type { PublicRuntimeStatus } from '../../shared/ipc.js'
import {
  checkpointLabel,
  collapseConversations,
  listedAsMission,
  routeSearchText,
  facePresenceFor,
  connectedRuntimeCount,
  handoffAvailability,
  handoffTitle,
  ledgerVerificationLabel,
  missionPhaseView,
  capRouteRows,
  modeRunsOn,
  modesFor,
  modeUnavailableReason,
  flagshipRank,
  missionsMatching,
  orderRouteRows,
  integrationOf,
  RUNTIME_INTEGRATION,
  formatBytes,
  prunePreviewSummary,
  ROUTE_GROUP_LIMIT,
  routeRowStatus,
  routeRowTag,
  runtimeIsUsable,
  shortMissionId,
  teammateStatusView
} from './status.js'
import type { RouteTag } from './status.js'

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

describe('what belongs in the mission list', () => {
  it('keeps a run that has a mission id, settled or not', () => {
    expect(listedAsMission({ missionId: 'mission_1', active: false })).toBe(true)
    expect(listedAsMission({ missionId: 'mission_1', active: true })).toBe(true)
  })

  it('keeps a run that is still starting, because that is how a teammate reads as working', () => {
    expect(listedAsMission({ missionId: undefined, active: true })).toBe(true)
  })

  it('drops a refused send, which settled without ever being given a mission id', () => {
    // Otherwise it sits in the list forever under an internal key, and
    // "Copy mission id" hands back that key.
    expect(listedAsMission({ missionId: undefined, active: false })).toBe(false)
  })
})

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

describe('handoff availability', () => {
  it('offers a handoff only once the mission has a runId to address', () => {
    // The window between submitting and the host's receipt is real, and a
    // control offered in it silently does nothing when clicked.
    expect(handoffAvailability(true, false, false)).toBe('starting')
    expect(handoffAvailability(true, true, false)).toBe('available')
  })

  it('offers nothing when no mission is running', () => {
    expect(handoffAvailability(false, false, false)).toBe('idle')
    // A stale runId from a finished mission must not make the control live.
    expect(handoffAvailability(false, true, false)).toBe('idle')
  })

  it('refuses a second switch while one is in flight', () => {
    // A handoff cannot be undone, so racing two of them would leave the user
    // with runs they never asked for.
    expect(handoffAvailability(true, true, true)).toBe('switching')
    expect(handoffAvailability(false, false, true)).toBe('switching')
  })

  it('says why whenever the control cannot do its job', () => {
    // Silence on a disabled control is the failure being prevented here.
    expect(handoffTitle('starting')).toMatch(/waiting/i)
    expect(handoffTitle('switching')).toMatch(/handing/i)
    expect(handoffTitle('available')).toMatch(/hand this mission/i)
    // Idle needs no explanation: the control is doing its ordinary job.
    expect(handoffTitle('idle')).toBeUndefined()
  })
})

describe('face activity', () => {
  it('decides the face from the same inputs as the label, so the two agree', () => {
    const base = { runtime: undefined, anyRuntimeUsable: true, hasRunningMission: false, pendingApprovals: 0, roleLabel: 'Docs & QA' }
    expect(teammateStatusView({ ...base, hasRunningMission: true, liveActivity: 'thinking' })).toMatchObject({ activity: 'thinking', label: 'Docs & QA · thinking' })
    expect(teammateStatusView({ ...base, hasRunningMission: true })).toMatchObject({ activity: 'working', label: 'Docs & QA · working' })
    expect(teammateStatusView({ ...base, pendingApprovals: 1 })).toMatchObject({ activity: 'waiting', label: 'Docs & QA · waiting on you' })
    expect(teammateStatusView({ ...base, anyRuntimeUsable: false })).toMatchObject({ activity: 'blocked' })
    expect(teammateStatusView({ ...base, recentlyDone: true })).toMatchObject({ activity: 'done', label: 'Docs & QA · done' })
    expect(teammateStatusView(base)).toMatchObject({ activity: 'idle', label: 'Docs & QA · idle' })
  })

  it('carries every state on the presence dot, so a still face still reads', () => {
    expect(facePresenceFor('working')).toBe('working')
    expect(facePresenceFor('approval-needed')).toBe('approval')
    expect(facePresenceFor('blocked')).toBe('blocked')
    expect(facePresenceFor('idle')).toBe('none')
  })
})

describe('a picker group that would not fit', () => {
  // One runtime lists 217 models on a real account. These stand in for them.
  const many = (group: string, count: number, activeIndex?: number) =>
    Array.from({ length: count }, (_, index) => ({
      group,
      label: `model-${String(index)}`,
      tag: (index === activeIndex ? 'ACTIVE' : 'READY') as RouteTag
    }))

  it('leaves a group that fits exactly as it is, and says nothing about it', () => {
    const rows = many('Codex CLI', ROUTE_GROUP_LIMIT)
    const capped = capRouteRows(rows, ROUTE_GROUP_LIMIT, false)
    expect(capped.rows).toEqual(rows)
    expect(capped.hiddenByGroup.size).toBe(0)
  })

  it('caps a long group and counts every row it is not showing', () => {
    const capped = capRouteRows(many('Cursor Agent', 217), ROUTE_GROUP_LIMIT, false)
    expect(capped.rows).toHaveLength(ROUTE_GROUP_LIMIT)
    expect(capped.hiddenByGroup.get('Cursor Agent')).toBe(217 - ROUTE_GROUP_LIMIT)
  })

  it('keeps the runtimes below a long group reachable', () => {
    const capped = capRouteRows(
      [...many('Cursor Agent', 217), ...many('Claude Code', 3)],
      ROUTE_GROUP_LIMIT,
      false
    )
    expect(capped.rows.filter((row) => row.group === 'Claude Code')).toHaveLength(3)
  })

  it('never hides the route you are on, and still shows the cap', () => {
    const capped = capRouteRows(many('Cursor Agent', 217, 180), ROUTE_GROUP_LIMIT, false)
    expect(capped.rows).toHaveLength(ROUTE_GROUP_LIMIT)
    expect(capped.rows.some((row) => row.tag === 'ACTIVE')).toBe(true)
    expect(capped.hiddenByGroup.get('Cursor Agent')).toBe(217 - ROUTE_GROUP_LIMIT)
  })

  it('lifts the cap entirely once someone is searching', () => {
    const rows = many('Cursor Agent', 217)
    const capped = capRouteRows(rows, ROUTE_GROUP_LIMIT, true)
    expect(capped.rows).toEqual(rows)
    expect(capped.hiddenByGroup.size).toBe(0)
  })
})

describe('what a prune says before it happens', () => {
  const preview = (deleted: number, continuity = 0, running = 0) => ({
    deleted: Array.from({ length: deleted }, (_, i) => `d${String(i)}`),
    keptForContinuity: Array.from({ length: continuity }, (_, i) => `c${String(i)}`),
    keptAsRunning: Array.from({ length: running }, (_, i) => `r${String(i)}`)
  })

  it('states the count that would go, and names everything held back', () => {
    expect(prunePreviewSummary(preview(3, 2, 1))).toBe(
      'Delete 3 missions for good, with 2 missions kept as part of a conversation you are keeping and 1 mission kept because they are running.'
    )
  })

  it('says why nothing would go, rather than just saying nothing', () => {
    expect(prunePreviewSummary(preview(0, 2))).toBe(
      'Nothing would be deleted: 2 missions still part of a conversation you are keeping.'
    )
    expect(prunePreviewSummary(preview(0))).toBe('Nothing is old enough to delete.')
  })

  it('counts one mission as one', () => {
    expect(prunePreviewSummary(preview(1))).toBe('Delete 1 mission for good.')
  })
})

describe('sizes a person can read', () => {
  it('scales to the largest unit that keeps the number short', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(900)).toBe('900 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(15 * 1024)).toBe('15 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3.0 GB')
  })

  it('says unknown rather than printing nonsense', () => {
    expect(formatBytes(Number.NaN)).toBe('unknown')
    expect(formatBytes(-1)).toBe('unknown')
  })
})

describe('how far each integration goes', () => {
  it('says live only for the runtimes that can own a mission today', () => {
    expect(RUNTIME_INTEGRATION.codex).toBe('live')
    expect(RUNTIME_INTEGRATION.claude).toBe('live')
    expect(RUNTIME_INTEGRATION.cursor).toBe('live')
  })

  it('does not claim a runtime the host refuses to run', () => {
    // Gemini CLI is discovered and can be signed into, but no mission can run
    // under it, so no screen may draw it as ready.
    expect(RUNTIME_INTEGRATION.gemini).toBe('planned')
    expect(RUNTIME_INTEGRATION.omniroute).toBe('planned')
  })

  it('treats a runtime it has never heard of as planned, not as live', () => {
    expect(integrationOf('something-new')).toBe('planned')
  })
})

describe('the tag on the route you are set to', () => {
  const runtime = (overrides: Partial<PublicRuntimeStatus> = {}): PublicRuntimeStatus => ({
    id: 'codex',
    displayName: 'Codex CLI',
    installed: true,
    version: '0.151.0',
    auth: 'authenticated',
    ready: true,
    status: 'ready',
    ...overrides
  })

  it('says ACTIVE only on a row that could actually run', () => {
    expect(routeRowTag(routeRowStatus(runtime(), 'live', true), true)).toBe('ACTIVE')
  })

  it('does not put ACTIVE on a runtime that is not there', () => {
    // A fresh install points the composer at Codex before discovery has
    // found anything. The row used to read lime ACTIVE directly above the
    // sentence "Codex CLI was not found on this machine."
    const missing = routeRowStatus(runtime({ installed: false, ready: false, status: 'not-installed' }), 'live', true)
    expect(routeRowTag(missing, true)).toBe('UNAVAILABLE')
    const signedOut = routeRowStatus(runtime({ ready: false, status: 'auth-required', auth: 'unauthenticated' }), 'live', true)
    expect(routeRowTag(signedOut, true)).toBe('SIGN IN')
  })
})

describe('a teammate with no work of their own', () => {
  const ready: PublicRuntimeStatus = {
    id: 'claude',
    displayName: 'Claude Code',
    installed: true,
    version: '2.1.0',
    auth: 'authenticated',
    ready: true,
    status: 'ready'
  }

  it('is idle, not blocked, when something could run', () => {
    const view = teammateStatusView({
      runtime: undefined,
      anyRuntimeUsable: true,
      hasRunningMission: false,
      pendingApprovals: 0,
      roleLabel: 'Docs & QA'
    })
    expect(view.status).toBe('idle')
  })

  it('is blocked when nothing is signed in at all', () => {
    const view = teammateStatusView({
      runtime: undefined,
      anyRuntimeUsable: false,
      hasRunningMission: false,
      pendingApprovals: 0,
      roleLabel: 'Docs & QA'
    })
    expect(view.status).toBe('blocked')
  })

  it('is judged against the runtime its own mission is on', () => {
    // Claude is signed in and running this teammate's work. Asking about a
    // different runtime told the person she needed to sign in while her
    // output was streaming on screen.
    const view = teammateStatusView({
      runtime: ready,
      anyRuntimeUsable: true,
      hasRunningMission: true,
      pendingApprovals: 0,
      roleLabel: 'Code & Migrations'
    })
    expect(view.status).toBe('working')
  })
})

describe('a route whose read-only mode is not real here', () => {
  it('does not offer Cursor a read-only mode on Windows, where nothing enforces it', () => {
    // Measured: Cursor's sandbox needs macOS or Linux, and plan mode alone
    // did not stop a run editing files. The host refuses such a mission, so
    // offering the mode meant every message came back an error -- and a run
    // that never started leaves no conversation to reply to, which read as
    // "it starts a new chat every time".
    expect(modeRunsOn('ask', 'cursor', 'win32')).toBe(false)
    expect(modesFor('cursor', 'win32')).toEqual(['accept-edits'])
  })

  it('offers it where the sandbox exists', () => {
    expect(modeRunsOn('ask', 'cursor', 'darwin')).toBe(true)
    expect(modesFor('cursor', 'darwin')).toEqual(['ask', 'accept-edits'])
  })

  it('leaves the other runtimes alone on every platform', () => {
    expect(modesFor('codex', 'win32')).toEqual(['ask', 'accept-edits', 'approve-each'])
    // Claude Code launches --restricted with a read-only tool list every
    // time, so Ask is the only mode it can honour. Offering Accept edits put
    // "Accept edits" in the composer and "read-only" in the header at once.
    expect(modesFor('claude', 'win32')).toEqual(['ask'])
  })

  it('says why, in the words a person needs to act on', () => {
    expect(modeUnavailableReason('ask', 'cursor', 'win32')).toContain('macOS or Linux')
  })
})

describe('which modes a route can actually run', () => {
  it('keeps per-action approvals to the runtime that can stop and ask', () => {
    expect(modeRunsOn('approve-each', 'codex')).toBe(true)
    expect(modeRunsOn('approve-each', 'cursor')).toBe(false)
    expect(modeRunsOn('approve-each', 'claude')).toBe(false)
  })

  it('lets a runtime read, and edit only where it really can', () => {
    for (const runtime of ['codex', 'claude', 'cursor'] as const) {
      expect(modeRunsOn('ask', runtime)).toBe(true)
    }
    expect(modeRunsOn('accept-edits', 'codex')).toBe(true)
    expect(modeRunsOn('accept-edits', 'cursor')).toBe(true)
    // Measured from the argv: Claude Code is always --restricted with
    // Read,Glob,Grep, so an edit mode would be a promise the host breaks.
    expect(modeRunsOn('accept-edits', 'claude')).toBe(false)
  })

  it('names the runtime when it says no, so the menu can explain itself', () => {
    expect(modeUnavailableReason('approve-each', 'cursor')).toContain('Cursor Agent')
    expect(modeUnavailableReason('ask', 'cursor')).toBeUndefined()
  })
})

describe('the order rows are offered in', () => {
  const row = (key: string, group: string) => ({ key, group })

  it('puts what this person has run first, newest first, inside its own runtime', () => {
    const rows = [
      row('cursor:a', 'CURSOR'),
      row('cursor:b', 'CURSOR'),
      row('cursor:c', 'CURSOR')
    ]
    const ordered = orderRouteRows(rows, ['cursor:c', 'cursor:b'])
    expect(ordered.map((entry) => entry.key)).toEqual(['cursor:c', 'cursor:b', 'cursor:a'])
  })

  it('never moves a row out of its runtime', () => {
    const rows = [row('codex:a', 'CODEX'), row('cursor:b', 'CURSOR'), row('codex:c', 'CODEX')]
    const ordered = orderRouteRows(rows, ['cursor:b', 'codex:c'])
    expect(ordered.map((entry) => entry.group)).toEqual(['CODEX', 'CODEX', 'CURSOR'])
    expect(ordered.map((entry) => entry.key)).toEqual(['codex:c', 'codex:a', 'cursor:b'])
  })

  it('leaves the runtime order alone when nothing has been run', () => {
    const rows = [row('codex:a', 'CODEX'), row('cursor:b', 'CURSOR')]
    expect(orderRouteRows(rows, []).map((entry) => entry.key)).toEqual(['codex:a', 'cursor:b'])
  })
})

describe('the curated shortlist', () => {
  it('puts the flagship families above the rest when nothing has been run', () => {
    const rows = [
      { key: 'cursor:aardvark-1', group: 'CURSOR', model: 'aardvark-1' },
      { key: 'cursor:cursor-grok-4.6', group: 'CURSOR', model: 'cursor-grok-4.6' },
      { key: 'cursor:zebra-9', group: 'CURSOR', model: 'zebra-9' }
    ]
    expect(orderRouteRows(rows, []).map((row) => row.model)).toEqual([
      'cursor-grok-4.6',
      'aardvark-1',
      'zebra-9'
    ])
  })

  it('still puts what this person ran above the curated list', () => {
    // Their own ledger outranks my judgement about what people want.
    const rows = [
      { key: 'cursor:cursor-grok-4.6', group: 'CURSOR', model: 'cursor-grok-4.6' },
      { key: 'cursor:zebra-9', group: 'CURSOR', model: 'zebra-9' }
    ]
    expect(orderRouteRows(rows, ['cursor:zebra-9']).map((row) => row.model)).toEqual([
      'zebra-9',
      'cursor-grok-4.6'
    ])
  })

  it('hides nothing: a model on no list is still offered', () => {
    const rows = [{ key: 'cursor:obscure', group: 'CURSOR', model: 'obscure' }]
    expect(orderRouteRows(rows, [])).toHaveLength(1)
    expect(flagshipRank('obscure')).toBeUndefined()
  })
})

describe('searching missions', () => {
  const rows = [
    { title: 'Audit the config', missionId: 'mission_abc12345' },
    { title: 'Rewrite the README', missionId: 'mission_def67890' }
  ]

  it('matches the words a person can see, whatever the case', () => {
    expect(missionsMatching(rows, 'audit').map((row) => row.missionId)).toEqual(['mission_abc12345'])
    expect(missionsMatching(rows, 'README').map((row) => row.missionId)).toEqual(['mission_def67890'])
  })

  it('matches an id, so one pasted from a receipt finds its mission', () => {
    expect(missionsMatching(rows, 'def678').map((row) => row.title)).toEqual(['Rewrite the README'])
  })

  it('shows everything when nothing was typed', () => {
    expect(missionsMatching(rows, '   ')).toHaveLength(2)
  })

  it('shows nothing when nothing matches, rather than everything', () => {
    expect(missionsMatching(rows, 'nonsense')).toEqual([])
  })
})

describe('the sidebar lists conversations, not turns', () => {
  const turn = (id: string, title: string, phase: string, rootId?: string, parentId?: string) => ({
    missionId: id,
    title,
    phase,
    integrityIssueCount: 0,
    ...(rootId === undefined ? {} : { rootId }),
    ...(parentId === undefined ? {} : { parentId })
  })

  it('collapses a three-turn exchange into one row', () => {
    const rows = collapseConversations([
      turn('m1', 'test', 'completed'),
      turn('m2', 'test', 'completed', 'm1', 'm1'),
      turn('m3', 'test', 'completed', 'm1', 'm2')
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ missionId: 'm3', turns: 3 })
    expect(rows[0]?.memberIds).toEqual(['m1', 'm2', 'm3'])
  })

  it('names the row for what the person typed first, and opens its newest turn', () => {
    const rows = collapseConversations([
      turn('m1', 'set up the parser', 'completed'),
      turn('m2', 'now add tests', 'completed', 'm1', 'm1')
    ])
    expect(rows[0]?.title).toBe('set up the parser')
    expect(rows[0]?.missionId).toBe('m2')
  })

  it('reads as running while any turn of it is running', () => {
    const rows = collapseConversations([
      turn('m1', 'x', 'completed'),
      turn('m2', 'x', 'running', 'm1', 'm1')
    ])
    expect(rows[0]?.phase).toBe('running')
  })

  it('surfaces an integrity issue from any turn, not just the last', () => {
    const rows = collapseConversations([
      { ...turn('m1', 'x', 'completed'), integrityIssueCount: 2 },
      turn('m2', 'x', 'completed', 'm1', 'm1')
    ])
    expect(rows[0]?.integrityIssueCount).toBe(2)
  })

  it('leaves an ordinary single-run mission exactly as it was', () => {
    const rows = collapseConversations([turn('m1', 'one off', 'completed')])
    expect(rows[0]).toMatchObject({ missionId: 'm1', title: 'one off', turns: 1 })
  })

  it('keeps separate conversations separate, in the order they were read', () => {
    const rows = collapseConversations([
      turn('a1', 'first', 'completed'),
      turn('b1', 'second', 'completed'),
      turn('a2', 'first', 'completed', 'a1', 'a1')
    ])
    expect(rows.map((row) => row.title)).toEqual(['first', 'second'])
  })

  it('still returns a row when a hand-edited chain has no leaf', () => {
    // Both turns claim to continue the other. Nothing is dropped.
    const rows = collapseConversations([
      turn('m1', 'x', 'completed', 'm1', 'm2'),
      turn('m2', 'x', 'completed', 'm1', 'm1')
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.turns).toBe(2)
  })
})

describe('searching routes the way names are said', () => {
  it('folds the punctuation a CLI spells a model with', () => {
    expect(routeSearchText('opencode/muse-spark-1.3-contributor-free')).toBe('opencode muse spark 1 3 contributor free')
    expect(routeSearchText('  Muse   Spark ')).toBe('muse spark')
    expect(routeSearchText('OpenCode muse-spark-1.3').includes(routeSearchText('muse spark 1.3'))).toBe(true)
  })
})

describe("the words for what a teammate does", () => {
  it("uses a Custom teammate's own title, and the role name for everyone else", async () => {
    const { roleLabelOf } = await import('../../shared/ipc.js')
    expect(roleLabelOf({ role: 'Custom', roleTitle: 'Release manager' })).toBe('Release manager')
    expect(roleLabelOf({ role: 'Custom' })).toBe('Custom')
    expect(roleLabelOf({ role: 'Custom', roleTitle: '   ' })).toBe('Custom')
    expect(roleLabelOf({ role: 'Docs & QA', roleTitle: 'ignored' })).toBe('Docs & QA')
  })
})
