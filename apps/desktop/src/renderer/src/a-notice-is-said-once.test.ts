import { describe, expect, it } from 'vitest'

import { buildThread, foldNoticeKeys, isSetupNote, latestSetupNotes } from './missionView.js'
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
const REMARK = 'The model is answering from a fallback region.'
const turn = (extra: string | undefined) => [
  event('run.started', {}),
  event('adapter.diagnostic', { code: 'codex.item_notice', level: 'warning', terminal: false, message: SKILLS }),
  event('adapter.diagnostic', { code: 'codex.item_notice', level: 'warning', terminal: false, message: REMARK }),
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
    expect(noticesOf(buildThread(turn(undefined), { running: false }))).toEqual([REMARK])
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

  it('is said once a conversation -- Colin: "Once per convo"', () => {
    const warn = (percent: number) =>
      event('route.limit_detected', { kind: 'temporary-rate-limit', message: `You've used ${String(percent)}% of your 7-day window · resets 2026-09-28T07:00:00.000Z`, evidence: { redacted: false } })
    const answer = (percent: number) => [
      event('run.started', {}),
      warn(percent),
      event('message.delta', { itemId: 'm', operation: 'replace', text: 'Done.', final: true }),
      event('run.completed', {})
    ]
    const limitsOf = (items: ReturnType<typeof buildThread>) => items.filter((item) => item.type === 'limit')
    const first = buildThread(answer(56), { running: false })
    expect(limitsOf(first)).toHaveLength(1)
    const second = buildThread(answer(58), { running: false, saidBefore: new Set(foldNoticeKeys(first)) })
    expect(limitsOf(second)).toHaveLength(0)
  })

  it('never hides a limit actually reached', () => {
    const first = buildThread(
      [event('run.started', {}), event('route.limit_detected', { kind: 'temporary-rate-limit', message: "You've used 90% of your 5-hour window", evidence: { redacted: false } }), event('run.completed', {})],
      { running: false }
    )
    const reached = buildThread(
      [event('run.started', {}), event('route.limit_detected', { kind: 'quota-exhausted', message: '5-hour window 100% used · resets 2026-09-23T20:00:00.000Z', evidence: { redacted: false } }), event('run.completed', {})],
      { running: false, saidBefore: new Set(foldNoticeKeys(first)) }
    )
    expect(reached.filter((item) => item.type === 'limit')).toHaveLength(1)
  })
})

/*
 * A CLI'S REMARK ABOUT ITS OWN SETUP IS NOT IN THE CONVERSATION AT ALL (0.308).
 *
 * "Skill descriptions were shortened..." and "Codex is ignoring 1
 * unrecognized configuration setting ... (the path to your config.toml)"
 * sat at the foot of every Codex turn's fold, the person's path with them,
 * on a room of two captured for the site (2026-09-23). They are about the
 * CLI: its row in Settings > Runtimes says them.
 */
describe("a CLI's remark about its own setup", () => {
  const IGNORING = 'Codex is ignoring 1 unrecognized configuration setting. Check for typos or deprecated settings. user (config.toml): `computer_use.windows.always_allowed_app_ids` is ignored.'

  it('is known for what it is, and nothing else is', () => {
    expect(isSetupNote(SKILLS)).toBe(true)
    expect(isSetupNote(IGNORING)).toBe(true)
    expect(isSetupNote('Codex is ignoring 2 unrecognized configuration settings.')).toBe(true)
    expect(isSetupNote('Reconnecting... 2/5')).toBe(false)
    expect(isSetupNote(REMARK)).toBe(false)
  })

  it('never reaches a turn, not even the first', () => {
    const notices = noticesOf(buildThread(turn(undefined), { running: false }))
    expect(notices.some((notice) => isSetupNote(notice))).toBe(false)
  })

  it("is what its runtime's row in Settings shows, from its newest run", () => {
    const run = (at: string, messages: readonly string[]) => ({
      runtime: 'codex',
      createdAt: at,
      events: messages.map((message) => event('adapter.diagnostic', { code: 'codex.item_notice', level: 'warning', terminal: false, message }))
    })
    const notes = latestSetupNotes([run('2026-09-23T10:00:00.000Z', [SKILLS]), run('2026-09-23T12:00:00.000Z', [IGNORING, SKILLS, IGNORING]), run('2026-09-23T11:00:00.000Z', [REMARK])])
    expect(notes.get('codex')).toEqual([IGNORING, SKILLS])
    expect(notes.has('claude')).toBe(false)
  })
})
