import { describe, expect, it } from 'vitest'

import { buildThread, foldNoticeKeys } from './missionView.js'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

/**
 * A RUNTIME'S REMARK ABOUT ITSELF IS SAID ONCE A CONVERSATION.
 *
 * Codex opens every turn with a note on its own setup -- "Skill descriptions
 * were shortened to fit the skills context budget" -- and each turn's fold
 * carried it at its foot, so a five-turn conversation said it five times
 * (Yurt's beta report, 2026-09-23, #10).
 */
let sequence = 0
function event(type: string, payload: unknown): NormalizedRuntimeEvent {
  sequence += 1
  return {
    id: `run:${String(sequence)}`,
    runId: 'run',
    sequence,
    occurredAt: new Date(Date.UTC(2026, 8, 23, 9, sequence)).toISOString(),
    sourceAdapter: 'codex',
    type,
    payload
  } as unknown as NormalizedRuntimeEvent
}

const SKILLS = 'Skill descriptions were shortened to fit the skills context budget.'
const turn = (extra: string | undefined) => [
  event('run.started', {}),
  event('adapter.diagnostic', { code: 'codex.item_notice', level: 'warning', terminal: false, message: SKILLS }),
  ...(extra === undefined ? [] : [event('adapter.diagnostic', { code: 'codex.item_notice', level: 'warning', terminal: false, message: extra })]),
  event('tool.started', { itemId: 'a', toolKind: 'read', name: 'read', command: 'README.md', phase: 'started' }),
  event('tool.completed', { itemId: 'a', toolKind: 'read', name: 'read', command: 'README.md', phase: 'completed' }),
  event('run.completed', {})
]

const noticesOf = (items: ReturnType<typeof buildThread>): readonly string[] => {
  const activity = items.find((item) => item.type === 'activity')
  return activity?.type === 'activity' ? (activity.notices ?? []).map((notice) => notice.message) : []
}

describe("a runtime's remark about itself", () => {
  it('is carried by the first turn that heard it', () => {
    expect(noticesOf(buildThread(turn(undefined), { running: false }))).toEqual([SKILLS])
  })

  it('is not said again by a later turn, while a new remark still is', () => {
    const first = buildThread(turn(undefined), { running: false })
    const second = buildThread(turn('The sandbox was reset.'), { running: false, saidBefore: new Set(foldNoticeKeys(first)) })
    expect(noticesOf(second)).toEqual(['The sandbox was reset.'])
  })
})

describe('a usage warning', () => {
  it('is one line a run, the newest figure, where the first one stood', () => {
    const warn = (percent: number) =>
      event('route.limit_detected', { kind: 'temporary-rate-limit', message: `You've used ${String(percent)}% of your 7-day window · resets 2026-09-28T07:00:00.000Z`, evidence: { redacted: false } })
    const events = [
      event('run.started', {}),
      warn(55),
      event('message.delta', { itemId: 'm', operation: 'replace', text: 'A scratch project.', final: true }),
      warn(56),
      event('run.completed', {})
    ]
    const limits = buildThread(events, { running: false }).filter((item) => item.type === 'limit')
    expect(limits).toHaveLength(1)
    expect(limits[0]?.type === 'limit' ? limits[0].message : '').toMatch(/56%/)
  })
})
