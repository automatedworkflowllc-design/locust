import { describe, expect, it } from 'vitest'

import type { PublicRuntimeStatus } from '../../shared/ipc.js'
import {
  ACCOUNT_DEFAULT_MODEL,
  settledModelFor,
  checkpointLabel,
  collapseConversations,
  listedAsMission,
  modeLabel,
  recentRouteRows,
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
  ownerToSelect,
  sandboxPhrase,
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
  teammateStatusView, ROUTE_SEARCH_GROUP_LIMIT } from './status.js'
import type { RouteTag } from './status.js'
import { startRoute } from './status.js'
import type { PublicModel } from '../../shared/ipc.js'

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

describe('the routes a person moves between', () => {
  const rows = [
    { key: 'codex:gpt-5.6-sol', group: 'Codex CLI · your account' },
    { key: 'claude:sonnet', group: 'Claude Code · your account' },
    { key: 'cursor:composer-2.5', group: 'Cursor Agent · your account' }
  ]

  // A list long enough for a shortcut to shorten something.
  const longList = [
    ...rows,
    ...Array.from({ length: 9 }, (_, index) => ({
      key: `codex:filler-${String(index)}`,
      group: 'Codex CLI · your account'
    }))
  ]

  it('lifts the recently used routes into a group of their own, newest first', () => {
    const recent = recentRouteRows(longList, ['claude:sonnet', 'codex:gpt-5.6-sol'])
    expect(recent.map((row) => row.group)).toEqual(['Recent', 'Recent'])
    expect(recent.map((row) => row.key)).toEqual(['recent:claude:sonnet', 'recent:codex:gpt-5.6-sol'])
  })

  it('withholds the group for a single recent route, which is the one you are on', () => {
    // Against the LONG list, so the short-list and half-the-list rules cannot
    // withhold it for their own reasons -- this has to fail when the
    // single-recent rule is the thing that breaks. The sweep caught exactly
    // that: written against the short list, the test passed no matter what
    // this rule did.
    expect(recentRouteRows(longList, ['claude:sonnet'])).toEqual([])
    expect(recentRouteRows(longList, [])).toEqual([])
  })

  it('withholds the group when the whole list is short enough to take in at once', () => {
    // The justification for the group was 27 rows scrolling at 330px. Three
    // rows on screen have nothing to skip past, so a shortcut shortens nothing.
    expect(recentRouteRows(rows, ['claude:sonnet', 'codex:gpt-5.6-sol'])).toEqual([])
  })

  it('withholds the group when it would be half the list or more', () => {
    // With two routes total the shortcut is a second copy of the picker.
    const many = Array.from({ length: 12 }, (_, index) => ({
      key: `codex:model-${String(index)}`,
      group: 'Codex CLI · your account'
    }))
    const halfOrMore = many.slice(0, 6).map((row) => row.key)
    expect(recentRouteRows(many, halfOrMore, 6)).toEqual([])
    const aFew = many.slice(0, 3).map((row) => row.key)
    expect(recentRouteRows(many, aFew)).toHaveLength(3)
  })

  it('never resurrects a route the runtime has stopped offering', () => {
    const recent = recentRouteRows(longList, ['codex:retired-model', 'claude:sonnet', 'cursor:composer-2.5'])
    expect(recent.map((row) => row.key)).toEqual(['recent:claude:sonnet', 'recent:cursor:composer-2.5'])
  })

  it('stops at the limit rather than repeating the whole list', () => {
    const many = ['codex:gpt-5.6-sol', 'claude:sonnet', 'cursor:composer-2.5']
    expect(recentRouteRows(longList, many, 2)).toHaveLength(2)
  })
})

describe('the mode a roster card shows', () => {
  it('names the mode the teammate actually last ran in', () => {
    // The card printed the literal string `read-only` for every teammate,
    // whatever they had run in -- false the moment a runtime could edit.
    expect(modeLabel('accept-edits')).toBe('accept edits')
    expect(modeLabel('approve-each')).toBe('approve each action')
    expect(modeLabel('ask')).toContain('read-only')
  })

  it('says a teammate who has never run has no mode yet, rather than inventing one', () => {
    expect(modeLabel(undefined)).toBe('not set yet')
  })
})

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

  it('a runtime whose last run ended on the usage limit says so instead of READY', () => {
    // MEASURED user session 1, 2026-09-05: two Codex missions in a row failed
    // on quota, and Settings, the welcome list and every picker row of it
    // still read READY. Signed in was true; runnable was not.
    const said = "You've hit your usage limit. Try again at Sep 7th, 2026 1:57 AM."
    const limited = routeRowStatus(runtime(), 'live', false, said)
    expect(limited.tag).toBe('AT LIMIT')
    expect(limited.selectable).toBe(true)
    expect(limited.detail).toContain(said)
    // Outranks ACTIVE: the active route refusing to run is the thing to show.
    expect(routeRowTag(routeRowStatus(runtime(), 'live', true, said), true)).toBe('AT LIMIT')
    // A runtime that is not runnable anyway keeps its own reason; the limit
    // note must not upgrade a SIGN IN row to something selectable.
    const signedOut = routeRowStatus(runtime({ ready: false, status: 'ready' }), 'live', false, said)
    expect(signedOut.tag).not.toBe('AT LIMIT')
    expect(signedOut.selectable).toBe(false)
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
      .toBe('NOT INSTALLED')
    expect(routeRowStatus(runtime({ ready: false, status: 'auth-required', auth: 'unauthenticated' }), 'live', false).tag)
      .toBe('SIGN IN')
    expect(routeRowStatus(runtime({ ready: false, status: 'offline' }), 'live', false).detail)
      .toMatch(/could not be reached/)
    // Installed but not answering is CHECKING, not UNAVAILABLE: the shell
    // asks again, and only a runtime that is not on the machine is missing.
    expect(routeRowStatus(runtime({ ready: false, status: 'probe-failed' }), 'live', false).tag).toBe('CHECKING')
    expect(routeRowStatus(runtime({ ready: false, status: 'offline' }), 'live', false).tag).toBe('CHECKING')
    expect(routeRowStatus(runtime({ ready: false, status: 'probe-failed' }), 'live', false).selectable).toBe(false)
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

  it('does not count a runtime this build cannot actually run', () => {
    // A guard rather than a repair: no live miscount has been observed, and
    // the one that looked like it on 2026-09-05 was the probe counting the
    // word READY while the sixth runtime was EXPERIMENTAL and genuinely
    // runnable. What this pins is that a runtime discovery calls ready but
    // this build cannot run -- Gemini probes and reports signed in -- is not
    // counted as connected.
    expect(connectedRuntimeCount([runtime(), runtime({ id: 'gemini' })])).toBe(1)
  })

  it('counts a runtime whose adapter is finished but unofficial', () => {
    // Experimental is a caveat about the SURFACE, not about whether it runs --
    // Antigravity completes missions today. Excluding it would understate.
    expect(connectedRuntimeCount([runtime({ id: 'antigravity' })])).toBe(1)
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

  it('widens the cap while searching, and still counts what it holds back', () => {
    // It used to lift the cap entirely, and one letter produced 92 rows
    // (0.21.2 QA). A search for `a` narrows nothing; the count is what keeps
    // the narrowing honest.
    const rows = many('Cursor Agent', 217)
    const capped = capRouteRows(rows, ROUTE_GROUP_LIMIT, true)
    expect(capped.rows).toHaveLength(ROUTE_SEARCH_GROUP_LIMIT)
    expect(capped.hiddenByGroup.get('Cursor Agent')).toBe(217 - ROUTE_SEARCH_GROUP_LIMIT)
    // A group that fits under the wider cap is untouched.
    const few = capRouteRows(many('Claude Code', 9), ROUTE_GROUP_LIMIT, true)
    expect(few.rows).toHaveLength(9)
    expect(few.hiddenByGroup.size).toBe(0)
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
    expect(routeRowTag(missing, true)).toBe('NOT INSTALLED')
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
    expect(modesFor('cursor', 'win32')).toEqual(['accept-edits', 'auto'])
  })

  it('offers it where the sandbox exists', () => {
    expect(modeRunsOn('ask', 'cursor', 'darwin')).toBe(true)
    expect(modesFor('cursor', 'darwin')).toEqual(['ask', 'plan', 'accept-edits', 'auto'])
  })

  it('leaves the other runtimes alone on every platform', () => {
    expect(modesFor('codex', 'win32')).toEqual(['ask', 'plan', 'accept-edits', 'approve-each', 'auto'])
    expect(modesFor('claude', 'win32')).toEqual(['ask', 'plan', 'accept-edits', 'auto'])
  })

  it('withholds Plan wherever read-only is not real, for the same reason as Ask', () => {
    // Plan became the fourth MODE rather than a switch beside one (design
    // pass, 2026-09-05): a switch that can only ever be on together with a
    // read-only mode asks the same question twice and can disagree with the
    // answer next to it. So Plan is offered exactly where Ask is.
    expect(modeRunsOn('plan', 'cursor', 'win32')).toBe(false)
    expect(modesFor('cursor', 'win32')).toEqual(['accept-edits', 'auto'])
    expect(modeRunsOn('plan', 'cursor', 'darwin')).toBe(true)
    expect(modeRunsOn('plan', 'antigravity')).toBe(false)
    // And it reads as what it is on a roster card.
    expect(modeLabel('plan')).toBe('plan · read-only')
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

  it('lets every runtime read and edit', () => {
    for (const runtime of ['codex', 'claude', 'cursor'] as const) {
      expect(modeRunsOn('ask', runtime)).toBe(true)
      // Claude Code included: `--permission-mode acceptEdits` with the editing
      // tools named is a real edit mode, and the argv follows the mode.
      expect(modeRunsOn('accept-edits', runtime)).toBe(true)
    }
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

  it('puts a newer flagship family above the one it replaces', () => {
    // The catalog itself is read from each runtime, so a new model needs no
    // code to appear. This curated list is the one exception, and it only
    // decides ORDER -- so the check is that GPT-6 outranks GPT-5.6 rather
    // than that either is present.
    const astra = flagshipRank('gpt-6-astra')
    const sol = flagshipRank('gpt-5.6-sol')
    expect(astra).toBeDefined()
    expect(sol).toBeDefined()
    expect(astra!).toBeLessThan(sol!)
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

describe('the route a mission starts on', () => {
  const models: readonly PublicModel[] = [
    {
      id: 'cursor-grok-4.6-high-fast',
      runtime: 'cursor',
      displayName: 'cursor-grok-4.6',
      description: '',
      supportedEfforts: ['low', 'high', 'high-fast'],
      variants: { low: 'cursor-grok-4.6-low', high: 'cursor-grok-4.6-high', 'high-fast': 'cursor-grok-4.6-high-fast' }
    },
    { id: 'sonnet', runtime: 'claude', displayName: 'Sonnet', description: '', supportedEfforts: ['low', 'medium', 'high'] }
  ]

  it('turns an effort into the variant it names and sends no effort beside it', () => {
    expect(startRoute(models, 'cursor', 'cursor-grok-4.6-high-fast', 'low')).toEqual({ model: 'cursor-grok-4.6-low' })
  })

  it('drops an effort the variants do not name rather than refuse the run', () => {
    expect(startRoute(models, 'cursor', 'cursor-grok-4.6-high-fast', 'medium')).toEqual({ model: 'cursor-grok-4.6-high-fast' })
  })

  it('sends the effort as itself where the runtime takes it as a flag', () => {
    expect(startRoute(models, 'claude', 'sonnet', 'medium')).toEqual({ model: 'sonnet', effort: 'medium' })
    expect(startRoute(models, 'claude', 'sonnet', undefined)).toEqual({ model: 'sonnet' })
  })
})

describe('the Auto mode, which has to be switched on before it is offered', () => {
  it('is always offered, whatever the workspace switch says', () => {
    // Colin, 2026-09-06: "always allow auto to be chosen from the permission
    // dropdown, we want the user experience to be fluid." Picking it is what
    // turns the switch on; the host still asks the switch as a run starts.
    expect(modesFor('codex', 'win32')).toContain('auto')
  })

  it('is offered on every runtime Locust has a handle on, and not on Antigravity', () => {
    for (const runtime of ['codex', 'claude', 'cursor', 'opencode', 'copilot'] as const) {
      expect(modesFor(runtime, 'win32')).toContain('auto')
    }
    expect(modesFor('antigravity', 'win32')).not.toContain('auto')
    expect(modeUnavailableReason('auto', 'antigravity', 'win32')).toMatch(/own permissions/)
  })

  it('is never the mode a route falls back to', () => {
    // The fallback takes the first offered mode, so Auto being last in the
    // list is what keeps a refused choice from widening into the widest one.
    expect(modesFor('codex', 'win32')[0]).not.toBe('auto')
    expect(modesFor('cursor', 'win32')[0]).not.toBe('auto')
  })

  it('has its own phrase for what a run was allowed', () => {
    // "may edit the workspace" on a run that could touch the whole machine
    // would understate what happened, on the receipt that exists to say it.
    expect(sandboxPhrase('full-access')).toBe('may edit anything on this machine')
    expect(sandboxPhrase('workspace-write')).toBe('may edit the workspace')
    expect(sandboxPhrase('read-only')).toBe('read-only')
    expect(sandboxPhrase(undefined)).toBe('read-only')
  })

  it('says what it allowed, not what it was called', () => {
    expect(modeLabel('auto')).toBe('auto \u00b7 whole machine')
  })
})

describe('who the composer addresses when a conversation is opened', () => {
  const owners = { mission_booty: 'tm_booty', mission_wren: 'tm_wren' }

  it("follows the mission's owner, so the header and the composer agree", () => {
    // Clicking Booty's message in an exchange opened Booty's run under a
    // header naming Booty, while the composer still said "Message Wren..."
    // and Wren's card stayed lit (0.35.0 targeted QA).
    expect(ownerToSelect('mission_booty', owners, 'tm_wren')).toBe('tm_booty')
  })

  it("prefers the run's own owner, which is what the header uses", () => {
    // The header reads `run.teammateId ?? missionOwners[id]`; this used to
    // read only the second. They agreed everywhere anyone could trace, except
    // while a run has started and the host has not recorded it yet -- the
    // exact window that produced the 0.35.0 bug (QA, 2026-09-06).
    expect(ownerToSelect('mission_new', {}, 'tm_wren', 'tm_booty')).toBe('tm_booty')
    // It is the first answer, not an override of a recorded one it disagrees
    // with: no such case exists, and if one appears the run is the fresher.
    expect(ownerToSelect('mission_booty', { mission_booty: 'tm_booty' }, 'tm_wren', undefined)).toBe('tm_booty')
  })

  it('keeps the current selection for a conversation nobody owns', () => {
    // An unowned raw conversation is a real state; blanking the composer
    // would be a second wrong answer rather than a fix for the first.
    expect(ownerToSelect('mission_nobody', owners, 'tm_wren')).toBe('tm_wren')
    expect(ownerToSelect('mission_nobody', owners, undefined)).toBeUndefined()
  })
})

describe('a route nobody chose settles onto a real model', () => {
  // The starting route names "account-default": real to run, but not a row in
  // any list. The picker hangs the effort levels on the ACTIVE row, so a route
  // that matches no row has nowhere to put them -- and the composer's effort
  // chip was removed in the same design pass. Measured on a fresh profile
  // 2026-09-07: 0 ACTIVE rows, 0 effort chips, no way to choose effort at all.
  const model = (
    runtime: string,
    id: string,
    supportedEfforts: readonly string[] = []
  ): { runtime: string; id: string; supportedEfforts: readonly string[] } => ({
    runtime,
    id,
    supportedEfforts
  })

  it('prefers a model that reports effort levels, because that is the point', () => {
    expect(
      settledModelFor({ runtime: 'codex', model: ACCOUNT_DEFAULT_MODEL }, [
        model('codex', 'gpt-5.4-mini'),
        model('codex', 'gpt-5.6-sol', ['low', 'high'])
      ])
    ).toBe('gpt-5.6-sol')
  })

  it('falls back to the first model listed when none report levels', () => {
    expect(
      settledModelFor({ runtime: 'opencode', model: ACCOUNT_DEFAULT_MODEL }, [
        model('opencode', 'big-pickle'),
        model('opencode', 'nemotron-3-ultra-free')
      ])
    ).toBe('big-pickle')
  })

  it('never reaches into another runtime for one', () => {
    expect(
      settledModelFor({ runtime: 'copilot', model: ACCOUNT_DEFAULT_MODEL }, [
        model('codex', 'gpt-5.6-sol', ['low', 'high'])
      ])
    ).toBeUndefined()
  })

  it('stays put when the runtime lists nothing: vague beats unrunnable', () => {
    expect(settledModelFor({ runtime: 'codex', model: ACCOUNT_DEFAULT_MODEL }, [])).toBeUndefined()
  })

  it('leaves a route that already names a real model alone', () => {
    expect(
      settledModelFor({ runtime: 'claude', model: 'sonnet' }, [model('claude', 'opus', ['high'])])
    ).toBeUndefined()
  })

  it('does not settle onto the placeholder itself', () => {
    expect(
      settledModelFor({ runtime: 'codex', model: ACCOUNT_DEFAULT_MODEL }, [
        model('codex', ACCOUNT_DEFAULT_MODEL)
      ])
    ).toBeUndefined()
  })
})
