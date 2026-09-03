import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import type { PublicRecoveredMission } from '../../shared/ipc.js'
import { describe, expect, it } from 'vitest'

import {
  activitySummary,
  assistantMessages,
  buildSignalRail,
  buildThread,
  cancellationSummary,
  conversationTurns,
  peerGroups,
  resolvedModelNames,
  rootMission,
  stitchedHandoff,
  recentlyUsedRoutes,
  resumableSessionOf,
  typedPrompt,
  railLabel
} from './missionView.js'

const NOW = '2026-08-31T16:00:00.000Z'
let sequence = 0

function event(type: string, payload: Record<string, unknown>): NormalizedRuntimeEvent {
  sequence += 1
  return {
    id: `evt_${sequence}`,
    runId: 'run_1',
    missionId: 'mission_1',
    sequence,
    occurredAt: NOW,
    sourceAdapter: 'codex',
    type,
    payload: { evidence: { redacted: false }, ...payload }
  } as unknown as NormalizedRuntimeEvent
}

function startedEvent(runtimeThreadId?: string): NormalizedRuntimeEvent {
  const started = event('run.started', { runtimeThreadId: runtimeThreadId ?? '' })
  return runtimeThreadId === undefined
    ? started
    : ({ ...started, runtimeThreadId } as unknown as NormalizedRuntimeEvent)
}

function toolStart(itemId: string, name: string, command?: string): NormalizedRuntimeEvent {
  return event('tool.started', {
    itemId,
    toolKind: 'command_execution',
    name,
    phase: 'started',
    ...(command === undefined ? {} : { command })
  })
}

function toolDone(itemId: string): NormalizedRuntimeEvent {
  return event('tool.completed', {
    itemId,
    toolKind: 'command_execution',
    name: 'shell',
    phase: 'completed'
  })
}

function delta(itemId: string, text: string, operation: 'append' | 'replace', final = false): NormalizedRuntimeEvent {
  return event('message.delta', { itemId, operation, text, final })
}

describe('assistant text', () => {
  it('rebuilds an appended stream instead of keeping the last fragment', () => {
    const messages = assistantMessages([
      delta('a', 'Adapter parity ', 'append'),
      delta('a', 'holds for ', 'append'),
      delta('a', 'invoice.paid.', 'append', true)
    ])
    expect(messages).toEqual([{ itemId: 'a', text: 'Adapter parity holds for invoice.paid.', final: true }])
  })

  it('honors a replace as a replace', () => {
    const messages = assistantMessages([
      delta('a', 'partial', 'append'),
      delta('a', 'the whole answer', 'replace', true)
    ])
    expect(messages[0]?.text).toBe('the whole answer')
  })

  it('keeps separate messages separate and in order', () => {
    const messages = assistantMessages([
      delta('a', 'first', 'append', true),
      delta('b', 'second', 'append', true)
    ])
    expect(messages.map((m) => m.text)).toEqual(['first', 'second'])
  })
})

describe('collapsed activity', () => {
  it('counts edits and commands separately from their tool events', () => {
    expect(
      activitySummary([
        { kind: 'edit', name: 'apply_patch', settled: true },
        { kind: 'edit', name: 'apply_patch', settled: true },
        { kind: 'shell', name: 'pnpm test', settled: true }
      ])
    ).toBe('Edited 2 files · ran 1 command')
  })

  it('singularizes honestly', () => {
    expect(activitySummary([{ kind: 'edit', name: 'x', settled: true }])).toBe('Edited 1 file')
  })

  it('says so when there was no tool activity', () => {
    expect(activitySummary([])).toBe('No tool activity')
  })

  it('classifies a patch command as an edit and a test run as a command', () => {
    const thread = buildThread(
      [toolStart('t1', 'shell', 'apply_patch <<EOF'), toolStart('t2', 'shell', 'pnpm test')],
      { running: true }
    )
    const activity = thread.find((item) => item.type === 'activity')
    expect(activity).toMatchObject({ summary: 'Edited 1 file · ran 1 command' })
  })
})

describe('thread composition', () => {
  it('shows a caret only while text is genuinely still arriving', () => {
    const streaming = buildThread([delta('a', 'partial', 'append')], { running: true })
    const finished = buildThread([delta('a', 'done', 'append', true)], { running: true })
    const stopped = buildThread([delta('a', 'partial', 'append')], { running: false })
    expect(streaming.find((i) => i.type === 'agent-message')).toMatchObject({ streaming: true })
    // Final means the provider is done with this message even if the run is not.
    expect(finished.find((i) => i.type === 'agent-message')).toMatchObject({ streaming: false })
    expect(stopped.find((i) => i.type === 'agent-message')).toMatchObject({ streaming: false })
  })

  it('drops the live step once it completes', () => {
    const running = buildThread([event('step.started', { stepKind: 'turn', message: 'Running the billing suite' })], {
      running: true
    })
    const done = buildThread(
      [
        event('step.started', { stepKind: 'turn', message: 'Running the billing suite' }),
        event('step.completed', { stepKind: 'turn' })
      ],
      { running: true }
    )
    expect(running.some((i) => i.type === 'live-step')).toBe(true)
    expect(done.some((i) => i.type === 'live-step')).toBe(false)
  })

  it('never shows a live step for a run that is not running', () => {
    const thread = buildThread([event('step.started', { stepKind: 'turn', message: 'Working' })], { running: false })
    expect(thread.some((i) => i.type === 'live-step')).toBe(false)
  })

  it('surfaces provider limits and diagnostics as their own items', () => {
    const thread = buildThread(
      [
        // Work has begun, so a notice here is about the mission, not the setup.
        toolStart('t1', 'shell', 'pnpm test'),
        event('route.limit_detected', { kind: 'temporary-rate-limit', message: 'Slow down' }),
        event('adapter.diagnostic', { level: 'warning', code: 'x', message: 'Heads up', terminal: false })
      ],
      { running: true }
    )
    expect(thread.find((i) => i.type === 'limit')).toMatchObject({ kind: 'temporary-rate-limit' })
    expect(thread.find((i) => i.type === 'diagnostic')).toMatchObject({ level: 'warning' })
  })

  it('does not invent an activity card when nothing ran', () => {
    expect(buildThread([delta('a', 'hi', 'append', true)], { running: false }).some((i) => i.type === 'activity'))
      .toBe(false)
  })
})

describe('cancellation summary', () => {
  it('separates what finished from what was cut off mid-flight', () => {
    const summary = cancellationSummary(
      [toolStart('t1', 'shell', 'pnpm build'), toolDone('t1'), toolStart('t2', 'shell', 'pnpm test')],
      4
    )
    expect(summary.settled).toEqual(['pnpm build'])
    expect(summary.interrupted).toEqual(['pnpm test'])
    expect(summary.neverStarted).toBe(2)
  })

  it('never reports a negative count when more ran than were planned', () => {
    const summary = cancellationSummary([toolStart('t1', 'shell', 'a'), toolDone('t1')], 0)
    expect(summary.neverStarted).toBe(0)
  })
})

describe('signal rail', () => {
  it('shows newest first', () => {
    const rows = buildSignalRail(
      [event('run.started', { runtimeThreadId: 't' }), toolStart('t1', 'shell', 'pnpm test')],
      { running: true }
    )
    expect(rows[0]?.name).toMatch(/^tool\./)
    expect(rows[1]?.name).toMatch(/^runtime\.started/)
  })

  it('marks a tool live only while it is open AND the run is going', () => {
    const open = [toolStart('t1', 'shell', 'pnpm test')]
    const closed = [toolStart('t1', 'shell', 'pnpm test'), toolDone('t1')]
    expect(buildSignalRail(open, { running: true }).find((r) => r.name.startsWith('tool.'))?.live).toBe(true)
    // The same open tool in a run that has stopped is not live -- a pulsing dot
    // on a dead run is the shell asserting something is happening when nothing
    // is.
    expect(buildSignalRail(open, { running: false })[0]?.live).toBe(false)
    expect(buildSignalRail(closed, { running: true }).find((r) => r.name.includes('completed'))?.live).toBe(false)
  })

  it('colours by meaning, not decoration', () => {
    const rows = buildSignalRail(
      [
        event('route.limit_detected', { kind: 'temporary-rate-limit', message: 'slow down' }),
        event('run.failed', { kind: 'process-failed', message: 'died', runtimeTerminal: 'failed', process: {} }),
        event('run.completed', { process: {} })
      ],
      { running: false }
    )
    expect(rows.find((r) => r.name.includes('limit_detected'))?.tone).toBe('amber')
    expect(rows.find((r) => r.name.includes('run.failed'))?.tone).toBe('red')
    expect(rows.find((r) => r.name === 'run.completed')?.tone).toBe('blue')
  })

  it('says nothing about events it does not understand', () => {
    expect(buildSignalRail([event('nonsense.event', {})], { running: true })).toEqual([])
  })
})

describe('rail labels', () => {
  it('collapses whitespace and bounds a long command', () => {
    const long = `tool.shell · "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command "Get-Content -Raw -LiteralPath .\package.json"`
    const label = railLabel(long)
    expect(label.length).toBeLessThanOrEqual(72)
    expect(label.endsWith('\u2026')).toBe(true)
  })

  it('leaves a short label exactly as it is', () => {
    expect(railLabel('tool.shell · pnpm test')).toBe('tool.shell · pnpm test')
  })

  it('does not let a multi-line command become multiple rail lines', () => {
    expect(railLabel('a\nb\n  c')).toBe('a b c')
  })
})

describe('peer messages in the thread', () => {
  it('hides a share block from the agent bubble, keeping the prose', () => {
    const events = [
      {
        id: 'e1',
        runId: 'run_1',
        missionId: 'mission_1',
        sequence: 1,
        type: 'message.delta',
        occurredAt: '2026-09-01T15:00:00.000Z',
        sourceAdapter: 'codex',
        payload: {
          itemId: 'answer',
          operation: 'replace',
          text: 'The gate is pnpm check.\n\n<locust-share to="Atlas">\npnpm check runs everything.\n</locust-share>',
          final: true,
          evidence: { redacted: true }
        }
      }
    ] as unknown as NormalizedRuntimeEvent[]
    const items = buildThread(events, { running: false })
    expect(items).toEqual([{ key: 'msg_answer', type: 'agent-message', text: 'The gate is pnpm check.', streaming: false }])
  })

  it('groups an exchange by the other party and marks whether anything was received', () => {
    const groups = peerGroups([
      {
        messageId: 'wm_2',
        direction: 'posted',
        from: { teammateId: 'tm_wren', name: 'Wren' },
        to: { teammateId: 'tm_atlas', name: 'Atlas' },
        text: 'Noted as a claim.',
        at: '2026-09-01T15:05:00.000Z'
      },
      {
        messageId: 'wm_1',
        direction: 'received',
        from: { teammateId: 'tm_atlas', name: 'Atlas' },
        to: { teammateId: 'tm_wren', name: 'Wren' },
        text: 'Dispute events changed shape.',
        at: '2026-09-01T15:00:00.000Z'
      },
      {
        messageId: 'wm_3',
        direction: 'posted',
        from: { teammateId: 'tm_wren', name: 'Wren' },
        to: { teammateId: 'tm_nova', name: 'Nova' },
        text: 'Docs are stale.',
        at: '2026-09-01T15:06:00.000Z'
      }
    ])
    expect(groups.map((group) => group.peer.name)).toEqual(['Atlas', 'Nova'])
    expect(groups[0]?.messages.map((message) => message.messageId)).toEqual(['wm_1', 'wm_2'])
    expect(groups[0]?.received).toBe(true)
    expect(groups[1]?.received).toBe(false)
  })
})

describe('reopening a handed-off mission', () => {
  function mission(overrides: Partial<PublicRecoveredMission>): PublicRecoveredMission {
    return {
      missionId: 'mission_1',
      runId: 'run_1',
      prompt: 'Inspect the workspace.',
      runtime: 'codex',
      model: 'account-default',
      requestedRouteId: 'codex',
      resolvedRouteId: 'codex-account:default',
      cliVersion: null,
      createdAt: '2026-09-01T15:00:00.000Z',
      lastUpdatedAt: '2026-09-01T15:00:00.000Z',
      phase: 'completed',
      events: [],
      eventCount: 0,
      eventsTruncated: false,
      integrityIssueCount: 0,
      sandbox: 'read-only',
      checkpoints: [],
      peerMessages: [],
      ...overrides
    }
  }
  const first = mission({
    missionId: 'mission_1',
    runtime: 'codex',
    checkpoints: [
      {
        epoch: 1,
        reason: 'route-switch',
        resumeSafety: 'approval-required',
        safetyReason: 'one action never reported back',
        createdAt: '2026-09-01T15:01:00.000Z',
        unsettledActions: [{ itemId: 'tool_1', name: 'shell' }]
      }
    ]
  })
  const second = mission({
    missionId: 'mission_2',
    runtime: 'claude',
    prompt: 'You are continuing work that another agent (Codex) started...',
    createdAt: '2026-09-01T15:02:00.000Z',
    continuesFrom: { missionId: 'mission_1', checkpointEpoch: 1, reason: 'route-switch' as const }
  })
  const byId = new Map([
    ['mission_1', first],
    ['mission_2', second]
  ])

  it('shows the words the person typed, not the briefing the host wrote', () => {
    expect(rootMission(second, byId).prompt).toBe('Inspect the workspace.')
    expect(rootMission(first, byId)).toBe(first)
  })

  it('rebuilds the divider from the route-switch checkpoint it resumed from', () => {
    const stitched = stitchedHandoff(second, byId)
    expect(stitched).toMatchObject({ from: 'codex', to: 'claude', unsettledCount: 1, omittedBriefing: [] })
    expect(stitchedHandoff(first, byId)).toBeUndefined()
  })

  it('stops walking a chain whose earlier mission is missing, and a cyclic one', () => {
    const orphan = mission({ missionId: 'mission_3', continuesFrom: { missionId: 'mission_gone', checkpointEpoch: 1, reason: 'route-switch' as const } })
    expect(rootMission(orphan, new Map([['mission_3', orphan]]))).toBe(orphan)
    expect(stitchedHandoff(orphan, new Map([['mission_3', orphan]]))).toBeUndefined()
    const a = mission({ missionId: 'a', continuesFrom: { missionId: 'b', checkpointEpoch: 1, reason: 'route-switch' as const } })
    const b = mission({ missionId: 'b', continuesFrom: { missionId: 'a', checkpointEpoch: 1, reason: 'route-switch' as const } })
    expect(rootMission(a, new Map([['a', a], ['b', b]]))).toBeDefined()
  })
})

describe('the running step', () => {
  function stepEvent(stepKind: 'turn' | 'reasoning' | 'item'): NormalizedRuntimeEvent {
    return {
      id: `e_${stepKind}`,
      runId: 'run_1',
      missionId: 'mission_1',
      sequence: 1,
      type: 'step.started',
      occurredAt: '2026-09-01T15:00:00.000Z',
      sourceAdapter: 'codex',
      payload: { stepKind, evidence: { redacted: true } }
    } as unknown as NormalizedRuntimeEvent
  }

  it('carries the step kind, so thought and action draw differently', () => {
    const thinking = buildThread([stepEvent('reasoning')], { running: true }).find((item) => item.type === 'live-step')
    const acting = buildThread([stepEvent('turn')], { running: true }).find((item) => item.type === 'live-step')
    expect(thinking).toMatchObject({ type: 'live-step', kind: 'reasoning', label: 'Thinking' })
    expect(acting).toMatchObject({ type: 'live-step', kind: 'turn', label: 'Working' })
  })
})

describe('runtime notices in the thread', () => {
  const at = '2026-09-01T15:00:00.000Z'
  function notice(id: string, sequence: number): NormalizedRuntimeEvent {
    return {
      id,
      runId: 'run_1',
      missionId: 'mission_1',
      sequence,
      type: 'adapter.diagnostic',
      occurredAt: at,
      sourceAdapter: 'codex',
      payload: { level: 'warning', code: 'codex.item_error', message: 'Skill descriptions were shortened.', terminal: false, evidence: { redacted: true } }
    } as unknown as NormalizedRuntimeEvent
  }
  const step = {
    id: 's1',
    runId: 'run_1',
    missionId: 'mission_1',
    sequence: 2,
    type: 'step.started',
    occurredAt: at,
    sourceAdapter: 'codex',
    payload: { stepKind: 'turn', evidence: { redacted: true } }
  } as unknown as NormalizedRuntimeEvent

  it('keeps a notice raised before any work out of the thread, as setup talk', () => {
    expect(buildThread([notice('d1', 1), step], { running: false }).some((item) => item.type === 'diagnostic')).toBe(false)
    // Codex's real shape: the turn opens, THEN the setup notice arrives, and
    // only after that does anything run. The turn opening is not work.
    expect(buildThread([step, notice('d1', 3)], { running: false }).some((item) => item.type === 'diagnostic')).toBe(false)
  })

  it('shows a notice raised while the work was under way', () => {
    const items = buildThread([step, toolStart('t1', 'shell', 'pnpm test'), notice('d2', 4)], { running: false })
    expect(items.some((item) => item.type === 'diagnostic')).toBe(true)
  })
})

describe('what a model alias resolved to', () => {
  function ranOn(missionId: string, model: string, resolved: string | undefined, createdAt: string) {
    return {
      missionId,
      runId: `run_${missionId}`,
      prompt: 'x',
      runtime: 'claude' as const,
      model,
      requestedRouteId: 'claude',
      resolvedRouteId: 'claude-account:default',
      cliVersion: null,
      createdAt,
      lastUpdatedAt: createdAt,
      phase: 'completed' as const,
      events: [
        {
          id: `e_${missionId}`,
          runId: `run_${missionId}`,
          missionId,
          sequence: 1,
          type: 'run.started',
          occurredAt: createdAt,
          sourceAdapter: 'claude',
          payload: {
            runtimeThreadId: 'thread',
            evidence: { redacted: true, raw: resolved === undefined ? {} : { model: resolved } }
          }
        }
      ] as unknown as NormalizedRuntimeEvent[],
      eventCount: 1,
      eventsTruncated: false,
      integrityIssueCount: 0,
      sandbox: 'read-only' as const,
      checkpoints: [],
      peerMessages: []
    }
  }

  it('learns the real name the runtime reported for an alias', () => {
    const resolved = resolvedModelNames([ranOn('m1', 'fable', 'claude-fable-5-1', '2026-09-01T10:00:00.000Z')])
    expect(resolved.get('claude:fable')).toBe('claude-fable-5-1')
  })

  it('prefers the newest mission, so a new release replaces an old name', () => {
    // Newest FIRST, which is the order history arrives in. Listed the other
    // way round, plain last-write-wins would land on the right answer by
    // accident and the comparison this pins would not be doing any work.
    const resolved = resolvedModelNames([
      ranOn('new', 'fable', 'claude-fable-5-1', '2026-09-01T10:00:00.000Z'),
      ranOn('old', 'fable', 'claude-fable-5', '2026-08-01T10:00:00.000Z')
    ])
    expect(resolved.get('claude:fable')).toBe('claude-fable-5-1')
  })

  it('says nothing about an alias nobody has run, or one that taught it nothing', () => {
    expect(resolvedModelNames([]).size).toBe(0)
    expect(resolvedModelNames([ranOn('m1', 'fable', undefined, '2026-09-01T10:00:00.000Z')]).size).toBe(0)
    // `fable -> fable` is not a resolution, it is the same word back.
    expect(resolvedModelNames([ranOn('m2', 'fable', 'fable', '2026-09-01T10:00:00.000Z')]).size).toBe(0)
  })
})

describe('a conversation across turns', () => {
  function turn(
    missionId: string,
    prompt: string,
    continuesFrom?: { missionId: string; reason: 'follow-up' | 'route-switch' }
  ): PublicRecoveredMission {
    return {
      missionId,
      runId: `run_${missionId}`,
      prompt,
      runtime: 'claude',
      model: 'sonnet',
      requestedRouteId: 'claude',
      resolvedRouteId: 'claude-account:default',
      cliVersion: null,
      createdAt: '2026-09-02T10:00:00.000Z',
      lastUpdatedAt: '2026-09-02T10:00:00.000Z',
      phase: 'completed',
      events: [],
      eventCount: 0,
      eventsTruncated: false,
      integrityIssueCount: 0,
      sandbox: 'read-only',
      checkpoints: [],
      peerMessages: [],
      ...(continuesFrom === undefined
        ? {}
        : { continuesFrom: { ...continuesFrom, checkpointEpoch: 1 } })
    }
  }

  const first = turn('m1', 'check the google stock price')
  const second = turn('m2', 'cant you look it up for me?', { missionId: 'm1', reason: 'follow-up' })
  const third = turn('m3', 'what about yesterday?', { missionId: 'm2', reason: 'follow-up' })
  const byId = new Map([first, second, third].map((mission) => [mission.missionId, mission] as const))

  it('walks a reply back to every earlier turn, oldest first', () => {
    expect(conversationTurns(third, byId).map((entry) => entry.prompt)).toEqual([
      'check the google stock price',
      'cant you look it up for me?',
      'what about yesterday?'
    ])
  })

  it('is just itself for a first turn', () => {
    expect(conversationTurns(first, byId).map((entry) => entry.missionId)).toEqual(['m1'])
  })

  it('does not walk a route switch, which is a handoff and keeps its divider', () => {
    const handed = turn('m4', 'briefing text', { missionId: 'm1', reason: 'route-switch' })
    const withHandoff = new Map([...byId, ['m4', handed] as const])
    expect(conversationTurns(handed, withHandoff).map((entry) => entry.missionId)).toEqual(['m4'])
  })

  it('stops at a missing or cyclic link rather than spinning', () => {
    const orphan = turn('m9', 'reply', { missionId: 'gone', reason: 'follow-up' })
    expect(conversationTurns(orphan, new Map([['m9', orphan]])).map((e) => e.missionId)).toEqual(['m9'])
    const a = turn('a', 'a', { missionId: 'b', reason: 'follow-up' })
    const b = turn('b', 'b', { missionId: 'a', reason: 'follow-up' })
    const cyclic = new Map([['a', a], ['b', b]] as const)
    expect(conversationTurns(a, cyclic).length).toBeLessThanOrEqual(2)
  })

  it('draws no handoff divider across an ordinary reply', () => {
    expect(stitchedHandoff(second, byId)).toBeUndefined()
  })
})

describe('whether a finished run can be replied to', () => {
  it('names the session a reply would resume', () => {
    expect(resumableSessionOf([startedEvent('thread-7'), event('run.completed', {})])).toBe('thread-7')
  })

  it('has nothing to resume when the run failed before its runtime started', () => {
    // What a start failure looks like: the host recorded the failure and the
    // runtime never opened a session. A reply here would be refused by the
    // host, so the shell must send it as a new mission instead.
    expect(resumableSessionOf([event('run.failed', { kind: 'process-failed', message: 'Codex CLI is not ready.' })]))
      .toBeUndefined()
    expect(resumableSessionOf([])).toBeUndefined()
  })

  it('ignores an empty session id rather than treating it as one', () => {
    expect(resumableSessionOf([startedEvent()])).toBeUndefined()
  })
})

describe('which words a turn shows', () => {
  const mission = (
    missionId: string,
    prompt: string,
    continuesFrom?: { readonly missionId: string; readonly reason: 'route-switch' | 'follow-up' }
  ): PublicRecoveredMission => ({
    missionId,
    runId: `run_${missionId}`,
    prompt,
    runtime: 'codex',
    model: 'account-default',
    resolvedRouteId: 'codex-account:default',
    cliVersion: null,
    sandbox: 'read-only',
    phase: 'completed',
    createdAt: NOW,
    lastUpdatedAt: NOW,
    integrityIssueCount: 0,
    events: [],
    peerMessages: [],
    ...(continuesFrom === undefined
      ? {}
      : { continuesFrom: { ...continuesFrom, checkpointEpoch: 1 } })
  } as unknown as PublicRecoveredMission)

  const index = (missions: readonly PublicRecoveredMission[]) =>
    new Map(missions.map((held) => [held.missionId, held]))

  it('shows a reply the words that were typed for it, not the opening line', () => {
    const first = mission('m1', 'Audit the config')
    const reply = mission('m2', 'Now fix the two you found', { missionId: 'm1', reason: 'follow-up' })
    expect(typedPrompt(reply, index([first, reply]))).toBe('Now fix the two you found')
  })

  it('shows a handed-over mission the words a person typed, not the briefing written for it', () => {
    const first = mission('m1', 'Audit the config')
    const handed = mission('m2', 'You are continuing a mission…', { missionId: 'm1', reason: 'route-switch' })
    expect(typedPrompt(handed, index([first, handed]))).toBe('Audit the config')
  })

  it('reaches back through a handoff but stops at the reply above it', () => {
    // A → handed over → B → replied to → C. C's own words are C's.
    const a = mission('m1', 'Audit the config')
    const b = mission('m2', 'You are continuing a mission…', { missionId: 'm1', reason: 'route-switch' })
    const c = mission('m3', 'Now fix the two you found', { missionId: 'm2', reason: 'follow-up' })
    const byId = index([a, b, c])
    expect(typedPrompt(c, byId)).toBe('Now fix the two you found')
    expect(typedPrompt(b, byId)).toBe('Audit the config')
  })

  it('keeps the mission own words when the one it continues is gone', () => {
    const orphan = mission('m2', 'You are continuing a mission…', { missionId: 'm_missing', reason: 'route-switch' })
    expect(typedPrompt(orphan, index([orphan]))).toBe('You are continuing a mission…')
  })
})

describe('the routes this person has actually run', () => {
  const ran = (missionId: string, runtime: string, model: string, lastUpdatedAt: string) => ({
    missionId,
    runId: `run_${missionId}`,
    prompt: 'x',
    runtime,
    model,
    resolvedRouteId: `${runtime}-account:default`,
    cliVersion: null,
    sandbox: 'read-only',
    phase: 'completed',
    createdAt: lastUpdatedAt,
    lastUpdatedAt,
    integrityIssueCount: 0,
    events: [],
    peerMessages: []
  } as unknown as PublicRecoveredMission)

  it('lists each route once, newest first', () => {
    const routes = recentlyUsedRoutes([
      ran('m1', 'codex', 'gpt-5', '2026-09-01T00:00:00.000Z'),
      ran('m2', 'cursor', 'composer-2.5', '2026-09-02T00:00:00.000Z'),
      ran('m3', 'codex', 'gpt-5', '2026-09-03T00:00:00.000Z')
    ])
    expect(routes).toEqual(['codex:gpt-5', 'cursor:composer-2.5'])
  })

  it('says nothing when nothing has been run', () => {
    expect(recentlyUsedRoutes([])).toEqual([])
  })
})
