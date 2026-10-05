import type { MissionLedger, RecoveredMission, WorkroomMessage } from '@teammate/mission-store'
import { joinMessageFragments } from '../shared/messageFragments.js'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { describe, expect, it, vi } from 'vitest'
import { MAX_HISTORY_EVENTS, deleteMissionRecord, limitedRuntimesFrom, publicRecoveredMission, readingOfWarning, usageWindowsFrom, withinByteBudget, readMissionHistory } from './mission-history.js'

const NOW = '2026-08-31T15:00:00.000Z'

function event(sequence: number): NormalizedRuntimeEvent {
  return {
    id: `event_${sequence}`,
    runId: 'run_1',
    missionId: 'mission_1',
    sequence,
    type: 'step.started',
    occurredAt: NOW,
    sourceAdapter: 'codex',
    payload: {
      stepKind: 'turn',
      evidence: { redacted: true }
    }
  } as unknown as NormalizedRuntimeEvent
}


function fragment(sequence: number, text: string, final = false, itemId = 'msg_0'): NormalizedRuntimeEvent {
  return {
    id: `event_${sequence}`,
    runId: 'run_1',
    missionId: 'mission_1',
    sequence,
    type: 'message.delta',
    occurredAt: NOW,
    sourceAdapter: 'cursor',
    payload: { itemId, operation: 'append', text, final, evidence: { redacted: true } }
  } as unknown as NormalizedRuntimeEvent
}

function recovered(overrides: Partial<RecoveredMission> = {}): RecoveredMission {
  return {
    metadata: {
      missionId: 'mission_1',
      runId: 'run_1',
      prompt: 'Inspect the workspace without changing it.',
      runtime: 'codex',
      model: 'account-default',
      requestedRouteId: 'codex',
      resolvedRouteId: 'codex-account:default',
      cliVersion: '0.151.0-alpha.7.2',
      workspaceId: 'ws_test',
      sandbox: 'read-only',
      executionPolicyVersion: 1,
      createdAt: NOW
    },
    events: [],
    hostFailures: [],
    checkpoints: [],
    peerLinks: [],
    editChecks: [], approvals: [],
    phase: 'completed',
    lastUpdatedAt: NOW,
    ledgerSequence: 1,
    issues: [],
    ...overrides
  }
}

import { workspaceIdFor } from './workspace.js'

describe('which folder a mission belongs to', () => {
  it('gives the same folder the same id every time, so a mission can be matched back to it', () => {
    expect(workspaceIdFor('C:/w/streaks')).toBe(workspaceIdFor('C:/w/streaks'))
    expect(workspaceIdFor('C:/w/streaks')).not.toBe(workspaceIdFor('C:/w/other'))
  })

  it('does not put the path itself in the ledger', () => {
    // The ledger is a durable local record and a path can name a person, a
    // client, or an unreleased project.
    expect(workspaceIdFor('C:/clients/acme-secret')).not.toContain('acme')
    expect(workspaceIdFor('C:/clients/acme-secret')).toMatch(/^ws_[0-9a-f]{32}$/)
  })
})

describe('a long reply survives the history window', () => {
  /*
   * The shape that lost sixty percent of an answer, measured on mission
   * 645f02a4 -- 1279 events, 1251 of them fragments of ONE reply. Windowing
   * by event count kept the newest 499 fragments and dropped the rest, so
   * the message reopened starting mid-sentence and looked complete.
   *
   * The assertion is the whole text, because "the front is still there" is
   * the only thing that was ever wrong; a count would have passed the whole
   * time this was broken.
   */
  const wordsOf = (events: readonly NormalizedRuntimeEvent[]): string =>
    events
      .filter((event): event is NormalizedRuntimeEvent & { type: 'message.delta' } => event.type === 'message.delta')
      .map((event) => (event.payload as { text: string }).text)
      .join('')

  it('keeps every character of a reply streamed across more fragments than the window holds', () => {
    const fragments = Array.from({ length: 1200 }, (_, index) =>
      fragment(index + 1, `w${index} `, index === 1199)
    )
    const mission = recovered({ events: fragments })
    const mapped = publicRecoveredMission(mission)
    expect(wordsOf(mapped.events)).toBe(fragments.map((_, index) => `w${index} `).join(''))
    expect(wordsOf(mapped.events)).toMatch(/^w0 w1 /)
  })

  it('reports the true event count, and does not call joining truncation', () => {
    const mission = recovered({ events: Array.from({ length: 1200 }, (_, index) => fragment(index + 1, 'x')) })
    const mapped = publicRecoveredMission(mission)
    // What the ledger holds, unchanged -- the footnote must not start lying
    // in the other direction.
    expect(mapped.eventCount).toBe(1200)
    // One message is one event, so nothing was dropped and nothing is said.
    expect(mapped.events).toHaveLength(1)
    expect(mapped.eventsTruncated).toBe(false)
  })

  it('marks the message final from the LAST fragment, not the first', () => {
    const joined = joinMessageFragments([fragment(1, 'a'), fragment(2, 'b'), fragment(3, 'c', true)])
    expect(joined).toHaveLength(1)
    expect(joined[0]?.payload).toMatchObject({ text: 'abc', final: true, operation: 'replace' })
    // The first fragment's identity, so the array stays in time order and a
    // reopened thread keeps its keys.
    expect(joined[0]?.id).toBe('event_1')
  })

  it('honours a replace, which is how a runtime rewrites what it already said', () => {
    const joined = joinMessageFragments([
      fragment(1, 'draft'),
      { ...fragment(2, 'final answer', true), payload: { itemId: 'msg_0', operation: 'replace', text: 'final answer', final: true, evidence: { redacted: true } } } as unknown as NormalizedRuntimeEvent
    ])
    expect((joined[0]?.payload as { text: string }).text).toBe('final answer')
  })

  it('keeps two messages apart, and in the order they were said', () => {
    const joined = joinMessageFragments([
      fragment(1, 'first '),
      fragment(2, 'one', true),
      fragment(3, 'second ', false, 'msg_1'),
      fragment(4, 'two', true, 'msg_1')
    ])
    expect(joined.map((event) => (event.payload as { text: string }).text)).toEqual(['first one', 'second two'])
  })

  it('leaves a mission that never streamed exactly as it was', () => {
    const events = [event(1), event(2)]
    expect(joinMessageFragments(events)).toBe(events)
  })
})

describe('mission history mapping', () => {
  it('passes small missions through untruncated with truthful counts', () => {
    const mission = recovered({ events: Array.from({ length: MAX_HISTORY_EVENTS }, (_, index) => event(index + 1)) })
    const mapped = publicRecoveredMission(mission)
    expect(mapped.events).toHaveLength(MAX_HISTORY_EVENTS)
    expect(mapped.eventCount).toBe(MAX_HISTORY_EVENTS)
    expect(mapped.eventsTruncated).toBe(false)
    expect(mapped.integrityIssueCount).toBe(0)
  })

  it('windows oversized missions to the first and latest events and says so', () => {
    const mission = recovered({ events: Array.from({ length: MAX_HISTORY_EVENTS + 1 }, (_, index) => event(index + 1)) })
    const mapped = publicRecoveredMission(mission)
    expect(mapped.events).toHaveLength(MAX_HISTORY_EVENTS)
    expect(mapped.events[0]?.sequence).toBe(1)
    expect(mapped.events.at(-1)?.sequence).toBe(MAX_HISTORY_EVENTS + 1)
    expect(mapped.events[1]?.sequence).toBe(3)
    expect(mapped.eventCount).toBe(MAX_HISTORY_EVENTS + 1)
    expect(mapped.eventsTruncated).toBe(true)
  })

  it('surfaces only the latest host failure and the mission-local issue count', () => {
    const mission = recovered({
      hostFailures: [
        { code: 'runtime-start-failed', message: 'first failure', occurredAt: NOW },
        { code: 'runtime-transport-failed', message: 'latest failure', occurredAt: NOW }
      ],
      issues: [{ code: 'truncated-tail', message: 'An incomplete final ledger record was ignored after recovery.' }],
      phase: 'failed'
    })
    const mapped = publicRecoveredMission(mission)
    expect(mapped.hostFailureMessage).toBe('latest failure')
    expect(mapped.integrityIssueCount).toBe(1)
    expect(mapped.phase).toBe('failed')
  })
})

describe('peer messages in history', () => {
  const link = (direction: 'received' | 'posted', messageId: string) => ({
    direction,
    messageId,
    peerTeammateId: 'tm_atlas',
    occurredAt: NOW
  })
  const atlasMessage = (messageId: string): WorkroomMessage => ({
    messageId,
    sequence: 1,
    from: { teammateId: 'tm_atlas', name: 'Atlas', missionId: 'mission_a' },
    to: { teammateId: 'tm_wren', name: 'Wren' },
    text: 'pnpm check runs everything.',
    postedAt: NOW
  })

  it('joins a mission\'s links with the workroom text, keeping direction', () => {
    const mapped = publicRecoveredMission(
      recovered({ peerLinks: [link('received', 'wm_1')] }),
      new Map([['wm_1', atlasMessage('wm_1')]])
    )
    expect(mapped.peerMessages).toEqual([
      {
        messageId: 'wm_1',
        direction: 'received',
        // With the conversation it was sent from (0.463), as the live path always had it.
        from: { teammateId: 'tm_atlas', name: 'Atlas', missionId: 'mission_a' },
        to: { teammateId: 'tm_wren', name: 'Wren' },
        text: 'pnpm check runs everything.',
        at: NOW
      }
    ])
  })

  it('keeps a link whose message the workroom no longer holds, with no text', () => {
    // Dropping it would show a mission that was briefed from a claim as if it
    // had been briefed from nothing.
    const mapped = publicRecoveredMission(recovered({ peerLinks: [link('received', 'wm_gone')] }), new Map())
    expect(mapped.peerMessages).toHaveLength(1)
    expect(mapped.peerMessages[0]).toMatchObject({ messageId: 'wm_gone', direction: 'received', text: null })
  })

  it('reads history even when the workroom itself cannot be read', async () => {
    const response = await readMissionHistory(
      ledger({
        listMissions: async () => ({ missions: [recovered({ peerLinks: [link('posted', 'wm_1')] })], issues: [], unreadableCount: 0 })
      }),
      {
        post: async () => { throw new Error('unused') },
        unread: async () => ({ messages: [], remaining: 0 }),
        markDelivered: async () => undefined,
        read: async () => { throw new Error('channel damaged') },
        flush: async () => undefined
      }
    )
    expect(response.ok).toBe(true)
    if (!response.ok) return
    expect(response.data.missions[0]?.peerMessages[0]?.text).toBeNull()
  })

  function ledger(overrides: Partial<MissionLedger>): MissionLedger {
    return {
      createMission: async () => undefined,
      appendEvents: async () => undefined,
      appendHostFailure: async () => undefined,
      createCheckpoint: async () => { throw new Error('not used in this test') },
      appendPeerLinks: async () => undefined, appendEditCheck: async () => undefined, appendApproval: async () => undefined,
      deleteMission: async () => true,
      listTrashedMissions: async () => [],
      restoreMission: async () => true,
      emptyTrash: async () => 0,
    storageReport: async () => ({ missionCount: 0, byteTotal: 0, unreadableCount: 0 }),
    pruneMissions: async () => ({ deleted: [], failed: [], unreadable: [], keptForContinuity: [], keptAsRunning: [] }),
      getMission: async () => undefined,
      listMissions: async () => ({ missions: [], issues: [], unreadableCount: 0 }),
      flush: async () => undefined,
      ...overrides
    }
  }
})

describe('mission history reads', () => {
  const ledger = (overrides: Partial<MissionLedger>): MissionLedger => ({
    createMission: async () => undefined,
    appendEvents: async () => undefined,
    appendHostFailure: async () => undefined,
    createCheckpoint: async () => { throw new Error('not used in this test') },
    appendPeerLinks: async () => undefined, appendEditCheck: async () => undefined, appendApproval: async () => undefined,
    deleteMission: async () => true,
    listTrashedMissions: async () => [],
    restoreMission: async () => true,
    emptyTrash: async () => 0,
    storageReport: async () => ({ missionCount: 0, byteTotal: 0, unreadableCount: 0 }),
    pruneMissions: async () => ({ deleted: [], failed: [], unreadable: [], keptForContinuity: [], keptAsRunning: [] }),
    getMission: async () => undefined,
    listMissions: async () => ({ missions: [], issues: [], unreadableCount: 0 }),
    flush: async () => undefined,
    ...overrides
  })

  it('returns mapped missions and the store-wide issue count', async () => {
    const response = await readMissionHistory(ledger({
      listMissions: async () => ({
        missions: [recovered()],
        issues: [{ code: 'read-failed', message: 'A mission ledger could not be read.' }],
        // One file raised the issue and produced no mission. Reported by the
        // reader now, rather than inferred here from the recovered list --
        // which is a PAGE, so the inference counted paged-out missions as
        // unreadable (Astra, 2026-09-09).
        unreadableCount: 1
      })
    }))
    expect(response.ok).toBe(true)
    if (!response.ok) return
    expect(response.data.missions).toHaveLength(1)
    expect(response.data.missions[0]?.missionId).toBe('mission_1')
    expect(response.data.issueCount).toBe(1)
  })

  it('converts a ledger failure into a generic response without leaking the error', async () => {
    const response = await readMissionHistory(ledger({
      listMissions: async () => {
        throw new Error('C:\\private\\ledger-path sk-secret')
      }
    }))
    expect(response).toEqual({
      ok: false,
      error: {
        code: 'HISTORY_UNAVAILABLE',
        message: 'Local mission history could not be read.'
      }
    })
    expect(JSON.stringify(response)).not.toContain('private')
  })
})

describe('history byte budget', () => {
  function sized(missionId: string, bytes: number) {
    return recovered({
      metadata: { ...recovered().metadata, missionId },
      events: [
        {
          ...event(1),
          payload: { ...event(1).payload, message: 'x'.repeat(bytes) }
        } as unknown as NormalizedRuntimeEvent
      ]
    })
  }

  it('stops adding missions once the response would exceed its budget', () => {
    // The per-mission window bounds COUNT, not SIZE: 500 events of large tool
    // output is still megabytes, and twenty of those is an unbounded payload.
    const missions = [
      publicRecoveredMission(sized('mission_1', 400)),
      publicRecoveredMission(sized('mission_2', 400)),
      publicRecoveredMission(sized('mission_3', 400))
    ]
    // Budget derived from the real serialized size rather than guessed, so the
    // test pins the BEHAVIOUR (two fit, the third does not) instead of pinning
    // a magic number that drifts the moment a field is added to the shape.
    const one = Buffer.byteLength(JSON.stringify(missions[0]), 'utf8')
    const kept = withinByteBudget(missions, one * 2 + 1)

    expect(kept.map((mission) => mission.missionId)).toEqual(['mission_1', 'mission_2'])
  })

  it('always returns the first mission even when it alone is over budget', () => {
    // An empty history reads as "you have no missions", which is a worse lie
    // than a large payload.
    const kept = withinByteBudget([publicRecoveredMission(sized('mission_1', 5000))], 10)
    expect(kept).toHaveLength(1)
  })

  it('keeps everything when the whole response fits', () => {
    const missions = [
      publicRecoveredMission(sized('mission_1', 10)),
      publicRecoveredMission(sized('mission_2', 10))
    ]
    expect(withinByteBudget(missions, 1_000_000)).toHaveLength(2)
  })
})

describe('deleting a mission', () => {
  function ledger(overrides: Partial<MissionLedger>): MissionLedger {
    return {
      createMission: async () => undefined,
      appendEvents: async () => undefined,
      appendHostFailure: async () => undefined,
      createCheckpoint: async () => { throw new Error('not used in this test') },
      appendPeerLinks: async () => undefined, appendEditCheck: async () => undefined, appendApproval: async () => undefined,
      deleteMission: async () => true,
      listTrashedMissions: async () => [],
      restoreMission: async () => true,
      emptyTrash: async () => 0,
    storageReport: async () => ({ missionCount: 0, byteTotal: 0, unreadableCount: 0 }),
    pruneMissions: async () => ({ deleted: [], failed: [], unreadable: [], keptForContinuity: [], keptAsRunning: [] }),
      getMission: async () => undefined,
      listMissions: async () => ({ missions: [], issues: [], unreadableCount: 0 }),
      flush: async () => undefined,
      ...overrides
    }
  }

  it('refuses to delete a mission that is still running, and names the remedy', async () => {
    const deleteMission = vi.fn<MissionLedger['deleteMission']>(async () => true)
    const response = await deleteMissionRecord(ledger({ deleteMission }), 'mission_1', () => true)
    expect(response).toEqual({
      ok: false,
      error: { code: 'LIVE', message: 'That mission is still running. Stop it first, then delete it.' }
    })
    // Refused means untouched: the file is never asked to go.
    expect(deleteMission).not.toHaveBeenCalled()
  })

  it('deletes a finished mission and says when there was nothing to delete', async () => {
    expect(await deleteMissionRecord(ledger({}), 'mission_1', () => false)).toEqual({ ok: true })
    expect(await deleteMissionRecord(ledger({ deleteMission: async () => false }), 'mission_9', () => false))
      .toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
  })

  it('refuses an id that could name any other file, before touching the store', async () => {
    const deleteMission = vi.fn<MissionLedger['deleteMission']>(async () => true)
    const response = await deleteMissionRecord(ledger({ deleteMission }), '../escape', () => false)
    expect(response).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
    expect(deleteMission).not.toHaveBeenCalled()
  })
})

describe('which runtimes the record still holds at their limit', () => {
  // The 0.21.2 QA pass: Codex ran out of quota, Settings said AT LIMIT, a
  // reload turned it back into READY with no successful run in between.
  const at = (minutes: number): string => new Date(Date.parse(NOW) + minutes * 60_000).toISOString()
  const limit = (runtime: string, minutes: number, said = 'You have hit your usage limit.'): NormalizedRuntimeEvent =>
    ({
      id: `limit-${runtime}-${String(minutes)}`,
      runId: 'run_x',
      missionId: 'mission_x',
      sequence: 1,
      type: 'route.limit_detected',
      occurredAt: at(minutes),
      sourceAdapter: runtime,
      payload: { kind: 'quota-exhausted', message: said, evidence: { redacted: true } }
    }) as unknown as NormalizedRuntimeEvent
  const completed = (runtime: string, minutes: number): NormalizedRuntimeEvent =>
    ({
      id: `done-${runtime}-${String(minutes)}`,
      runId: 'run_x',
      missionId: 'mission_x',
      sequence: 2,
      type: 'run.completed',
      occurredAt: at(minutes),
      sourceAdapter: runtime,
      payload: { process: { exitCode: 0, signal: null }, evidence: { redacted: true } }
    }) as unknown as NormalizedRuntimeEvent

  it('reports a runtime whose last word was its limit, with that word', () => {
    expect(limitedRuntimesFrom([recovered({ events: [limit('codex', 5)] })])).toEqual({
      codex: 'You have hit your usage limit.'
    })
  })

  it('CONTROL: a later completed run on that runtime clears it', () => {
    expect(
      limitedRuntimesFrom([recovered({ events: [limit('codex', 5)] }), recovered({ events: [completed('codex', 9)] })])
    ).toEqual({})
  })

  it('decides by time across missions, not by file order', () => {
    // The completed run is listed first but happened earlier.
    expect(
      limitedRuntimesFrom([recovered({ events: [completed('codex', 1)] }), recovered({ events: [limit('codex', 3)] })])
    ).toEqual({ codex: 'You have hit your usage limit.' })
  })

  it('keeps runtimes apart: Claude finishing says nothing about Codex', () => {
    expect(limitedRuntimesFrom([recovered({ events: [limit('codex', 5), completed('claude', 9)] })])).toEqual({
      codex: 'You have hit your usage limit.'
    })
  })

  it('ignores a temporary rate limit -- that is a moment, not the account', () => {
    const temporary = {
      ...limit('codex', 5),
      payload: { kind: 'temporary-rate-limit', message: 'slow down', evidence: { redacted: true } }
    } as unknown as NormalizedRuntimeEvent
    expect(limitedRuntimesFrom([recovered({ events: [temporary] })])).toEqual({})
  })

  it('rides on the history response', async () => {
    const stub: MissionLedger = {
      createMission: async () => undefined,
      appendEvents: async () => undefined,
      appendHostFailure: async () => undefined,
      createCheckpoint: async () => { throw new Error('not used in this test') },
      appendPeerLinks: async () => undefined, appendEditCheck: async () => undefined, appendApproval: async () => undefined,
      deleteMission: async () => true,
      listTrashedMissions: async () => [],
      restoreMission: async () => true,
      emptyTrash: async () => 0,
      storageReport: async () => ({ missionCount: 0, byteTotal: 0, unreadableCount: 0 }),
      pruneMissions: async () => ({ deleted: [], failed: [], unreadable: [], keptForContinuity: [], keptAsRunning: [] }),
      getMission: async () => undefined,
      listMissions: async () => ({ missions: [recovered({ events: [limit('codex', 5)] })], issues: [], unreadableCount: 0 }),
      flush: async () => undefined
    }
    const response = await readMissionHistory(stub)
    expect(response.ok && response.data.limitedRuntimes).toEqual({ codex: 'You have hit your usage limit.' })
  })
})

describe('the latest usage window per runtime, from the ledger', () => {
  const windowEvent = (runtime: 'claude' | 'codex', at: string, said: string) => ({
    id: `w-${at}`, runId: 'run_1', missionId: 'mission_1', sequence: 1, occurredAt: at, sourceAdapter: runtime,
    type: 'adapter.diagnostic', payload: { code: `${runtime}.usage_window`, level: 'info', terminal: false, message: said, evidence: { redacted: true } }
  }) as never

  it('keeps the newest reading per runtime and ignores everything else', () => {
    const missions = [
      recovered({ events: [windowEvent('claude', '2026-09-05T10:00:00.000Z', '5-hour window 20% used'), windowEvent('claude', '2026-09-05T11:00:00.000Z', '5-hour window 35% used')] }),
      recovered({ events: [windowEvent('codex', '2026-09-05T09:00:00.000Z', 'primary 10% used')] })
    ]
    // 0.406: each carries when it was seen, from which run's event.
    expect(usageWindowsFrom(missions)).toEqual({
      claude: '5-hour window 35% used · from a run at 2026-09-05T11:00:00.000Z',
      codex: 'primary 10% used · from a run at 2026-09-05T09:00:00.000Z'
    })
    expect(usageWindowsFrom([recovered({ events: [] })])).toEqual({})
  })

  /*
   * 0.407: a ledger written before it keeps a warning's figure only in the
   * notice. Colin's held nine at 78-79% the morning his card still said 66%.
   */
  it('reads a newer usage warning back as the reading', () => {
    const warning = (at: string, said: string) => ({
      id: `l-${at}`, runId: 'run_1', missionId: 'mission_1', sequence: 2, occurredAt: at, sourceAdapter: 'claude',
      type: 'route.limit_detected', payload: { kind: 'temporary-rate-limit', message: said, evidence: { redacted: true } }
    }) as never
    const missions = [recovered({ events: [
      windowEvent('claude', '2026-09-27T01:23:19.233Z', '7-day window 66% used · resets 2026-09-28T07:00:00.000Z · 5-hour window 20% used'),
      warning('2026-09-27T14:11:40.000Z', "You've used 79% of your 7-day window · resets 2026-09-28T07:00:00.000Z")
    ] })]
    expect(usageWindowsFrom(missions)).toEqual({ claude: '7-day window 79% used · resets 2026-09-28T07:00:00.000Z · from a run at 2026-09-27T14:11:40.000Z' })
    expect(readingOfWarning('Your 7-day window is running low')).toBeUndefined()
    expect(readingOfWarning("You've used 31% of your 5-hour window")).toBe('5-hour window 31% used')
  })
})
