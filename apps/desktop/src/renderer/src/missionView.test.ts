import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import type { PublicRecoveredMission } from '../../shared/ipc.js'
import { describe, expect, it } from 'vitest'

import {
  activitySummary,
  assistantMessages,
  buildSignalRail,
  buildThread,
  cancellationSummary,
  peerGroups,
  rootMission,
  stitchedHandoff,
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
    continuesFrom: { missionId: 'mission_1', checkpointEpoch: 1 }
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
    const orphan = mission({ missionId: 'mission_3', continuesFrom: { missionId: 'mission_gone', checkpointEpoch: 1 } })
    expect(rootMission(orphan, new Map([['mission_3', orphan]]))).toBe(orphan)
    expect(stitchedHandoff(orphan, new Map([['mission_3', orphan]]))).toBeUndefined()
    const a = mission({ missionId: 'a', continuesFrom: { missionId: 'b', checkpointEpoch: 1 } })
    const b = mission({ missionId: 'b', continuesFrom: { missionId: 'a', checkpointEpoch: 1 } })
    expect(rootMission(a, new Map([['a', a], ['b', b]]))).toBeDefined()
  })
})
