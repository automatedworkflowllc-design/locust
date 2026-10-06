import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import type { ReconciledCheckpoint } from '@teammate/mission-store'
import { reconcileMission } from '@teammate/mission-store'
import { describe, expect, it } from 'vitest'

import { composeHandoffPrompt, howTurnEnded, MAX_HANDOFF_PROMPT_LENGTH, NOTICE_BUDGET, OPTIONAL_SECTION_NAMES, omissionNotice } from './handoff.js'

/**
 * A2.11 (reported #13): A RUNTIME SWITCH IS TOLD WHAT HAPPENED, IN WORDS.
 *
 * Two gaps in the brief a new runtime starts from. Its "settled actions"
 * were the provider's item ids -- `call_8f2c...` -- which say nothing about the
 * work; and only the last turn was carried, so a long conversation arrived
 * as its latest ask alone.
 */
function checkpoint(overrides: Partial<ReconciledCheckpoint> = {}): ReconciledCheckpoint {
  return {
    missionId: 'mission_prior',
    epoch: 2,
    reason: 'route-switch',
    resumeSafety: 'safe',
    safetyReason: 'settled',
    createdAt: '2026-09-05T03:00:00.000Z',
    unsettledActions: [],
    settledActions: [],
    assistantSummary: '',
    ...overrides
  } as unknown as ReconciledCheckpoint
}

describe('settled actions', () => {
  it('are named by what they did, from the ledger’s own start events', () => {
    const events = [
      { id: 'e1', runId: 'r', missionId: 'm', sequence: 1, type: 'tool.started', occurredAt: 'x', sourceAdapter: 'codex', payload: { itemId: 'call_8f2c', toolKind: 'command', name: 'npm test' } },
      { id: 'e2', runId: 'r', missionId: 'm', sequence: 2, type: 'tool.completed', occurredAt: 'x', sourceAdapter: 'codex', payload: { itemId: 'call_8f2c' } },
      // Its start was not kept: counted, never shown as an id.
      { id: 'e3', runId: 'r', missionId: 'm', sequence: 3, type: 'tool.completed', occurredAt: 'x', sourceAdapter: 'codex', payload: { itemId: 'call_orphan' } }
    ] as unknown as NormalizedRuntimeEvent[]
    const reconciled = reconcileMission(
      { metadata: { missionId: 'm', runId: 'r' }, events, issues: [] } as unknown as Parameters<typeof reconcileMission>[0],
      { epoch: 1, reason: 'route-switch', now: () => new Date() } as unknown as Parameters<typeof reconcileMission>[1]
    )
    expect(reconciled.settledNames).toEqual(['command: npm test'])
    const prompt = composeHandoffPrompt('Fix the tests.', reconciled, 'Codex CLI', 'Carry on.')!.prompt
    expect(prompt).toContain('- command: npm test')
    expect(prompt).toContain('- 1 other action whose details were not recorded')
    expect(prompt).not.toContain('call_8f2c')
    expect(prompt).not.toContain('call_orphan')
  })

  it('from a checkpoint written before names existed are counted, not listed as ids', () => {
    const prompt = composeHandoffPrompt('Fix the tests.', checkpoint({ settledActions: ['call_a', 'call_b'] }), 'Codex CLI')!.prompt
    expect(prompt).toContain('- 2 actions whose details were not recorded')
    expect(prompt).not.toContain('call_a')
  })
})

describe('settled actions, as Antigravity records them (0.567)', () => {
  // Its adapter names a tool twice (`toolKind` and `name` are both
  // `run_command`) and keeps what it ran in `command`: the shape of Colin's
  // W7 ledger, whose brief to Codex read `run_command: run_command` forty times.
  const reconcile = (events: unknown[]) => reconcileMission(
    { metadata: { missionId: 'm', runId: 'r' }, events, issues: [] } as unknown as Parameters<typeof reconcileMission>[0],
    { epoch: 1, reason: 'route-switch', now: () => new Date() } as unknown as Parameters<typeof reconcileMission>[1]
  )
  const tool = (sequence: number, itemId: string, toolKind: string, command?: string) => [
    { id: `s${String(sequence)}`, runId: 'r', missionId: 'm', sequence, type: 'tool.started', occurredAt: 'x', sourceAdapter: 'antigravity', payload: { itemId, toolKind, name: toolKind, ...(command === undefined ? {} : { command }), phase: 'started' } },
    { id: `c${String(sequence)}`, runId: 'r', missionId: 'm', sequence: sequence + 1, type: 'tool.completed', occurredAt: 'x', sourceAdapter: 'antigravity', payload: { itemId, toolKind, name: toolKind, phase: 'completed' } }
  ]

  it('are named by the command run and the file read or written, never the tool twice', () => {
    const reconciled = reconcile([
      ...tool(1, 'tool_2', 'run_command', 'git status -sb'),
      ...tool(3, 'tool_4', 'view_file', 'docs/PLAN.md'),
      ...tool(5, 'tool_6', 'write_to_file', 'apps/desktop/src/shared/routine-inputs.ts'),
      ...tool(7, 'tool_8', 'manage_task')
    ])
    expect(reconciled.settledNames).toEqual([
      'run_command: git status -sb',
      'view_file: docs/PLAN.md',
      'write_to_file: apps/desktop/src/shared/routine-inputs.ts',
      'manage_task'
    ])
    const prompt = composeHandoffPrompt('Build W7.', reconciled, 'Antigravity', 'keep working')!.prompt
    expect(prompt).toContain('- write_to_file: apps/desktop/src/shared/routine-inputs.ts')
    expect(prompt).not.toContain('run_command: run_command')
  })

  it('past the most recent forty, the rest are said to be earlier, not unrecorded', () => {
    const reconciled = reconcile(Array.from({ length: 62 }, (_, at) => tool(at * 2 + 1, `tool_${String(at)}`, 'run_command', `step ${String(at)}`)).flat())
    expect(reconciled.settledNames).toHaveLength(40)
    expect(reconciled.settledNames?.at(-1)).toBe('run_command: step 61')
    const prompt = composeHandoffPrompt('Build W7.', reconciled, 'Antigravity', 'keep working')!.prompt
    expect(prompt).toContain('- and 22 earlier actions, not listed here')
    expect(prompt).not.toContain('whose details were not recorded')
  })
})

describe('the earlier turns', () => {
  const earlier = [
    { asked: 'Find why the build is slow.', answered: 'The TypeScript step re-checks every package on each build.' },
    { asked: 'Make it incremental.', answered: undefined }
  ]

  it('are carried, oldest first, each as what was asked and how it was answered', () => {
    const prompt = composeHandoffPrompt('Now add a cache.', checkpoint(), 'Claude Code', 'Carry on.', earlier)!.prompt
    expect(prompt).toContain('Earlier in this conversation, oldest first:\n- Asked: "Find why the build is slow." -- answered: "The TypeScript step re-checks every package on each build."\n- Asked: "Make it incremental." -- no reply was recorded.')
    expect(prompt.indexOf('Earlier in this conversation')).toBeLessThan(prompt.indexOf('The person now asks'))
  })

  it('are clipped, not pasted whole', () => {
    const long = [{ asked: 'x'.repeat(2_000), answered: 'y'.repeat(2_000) }]
    const prompt = composeHandoffPrompt('Go.', checkpoint(), 'Claude Code', undefined, long)!.prompt
    expect(prompt.length).toBeLessThan(1_000)
    expect(prompt).toContain('…')
  })

  it('are the first thing given up when the brief is long, and never push out the person’s words', () => {
    const big = Array.from({ length: 4 }, () => ({ asked: 'a'.repeat(240), answered: 'b'.repeat(360) }))
    const nearFull = 'n'.repeat(MAX_HANDOFF_PROMPT_LENGTH - 1_200)
    const briefing = composeHandoffPrompt('Go.', checkpoint({ assistantSummary: 'I changed tsconfig.' }), 'Claude Code', nearFull, big)!
    expect(briefing).toBeDefined()
    // Since 0.671 the earlier turns give way in part: the newest that fit are kept, the rest counted.
    expect(briefing.omitted).toEqual([])
    expect(briefing.prompt).toMatch(/- \(\d+ earlier turns? (is|are) not listed here\)/)
    expect(briefing.prompt).toContain('I changed tsconfig.')
    expect(briefing.prompt).toContain(`The person now asks:\n\n${nearFull}`)
    expect(briefing.prompt.length).toBeLessThanOrEqual(MAX_HANDOFF_PROMPT_LENGTH)
  })

  it('give way to what the last agent said, when only one of the two fits', () => {
    const turn = [{ asked: 'a'.repeat(240), answered: 'b'.repeat(360) }]
    const summary = 's'.repeat(700)
    // Room for either the summary (~745) or the earlier turn (~680), not both.
    const next = 'n'.repeat(MAX_HANDOFF_PROMPT_LENGTH - NOTICE_BUDGET - 140 - 1_000)
    const briefing = composeHandoffPrompt('Go.', checkpoint({ assistantSummary: summary }), 'Claude Code', next, turn)!
    expect(briefing.omitted).toEqual(['earlier'])
    expect(briefing.prompt).toContain(summary)
  })

  it('fit the notice’s reserve with every optional section named', () => {
    expect(omissionNotice(OPTIONAL_SECTION_NAMES).length + 2).toBeLessThanOrEqual(NOTICE_BUDGET)
  })
})

/**
 * Colin, 2026-10-03: Codex hit its 5-hour limit before answering a teammate,
 * the conversation went to Gemini, and its brief said Codex "finished its last
 * turn". A turn that ended on a limit, a failure or a Stop is said as one.
 */
describe('how the turn handed over ended', () => {
  const ended = (type: string, payload: Record<string, unknown> = {}) => [{ type: 'run.started', payload: {} }, { type, payload }]

  it('says a turn cut off by a usage limit was not finished', () => {
    const said = howTurnEnded(ended('run.failed', { kind: 'quota-exhausted', message: 'You have hit your usage limit.' }))
    expect(said).toBe('its usage limit was reached')
    const prompt = composeHandoffPrompt('Answer Casper.', checkpoint(), 'Codex CLI', 'Carry on.', [], undefined, [], said)!.prompt
    expect(prompt).toContain('whose last turn ended before it finished: its usage limit was reached')
    expect(prompt).not.toContain('which finished its last turn')
  })

  it('still says a completed turn finished', () => {
    expect(howTurnEnded(ended('run.completed'))).toBeUndefined()
    expect(composeHandoffPrompt('Answer Casper.', checkpoint(), 'Codex CLI', 'Carry on.')!.prompt).toContain('which finished its last turn')
    expect(howTurnEnded(ended('run.cancelled'))).toBe('the person stopped it')
  })
})
