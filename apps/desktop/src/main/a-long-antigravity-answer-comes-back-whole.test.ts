import { describe, expect, it } from 'vitest'

import type { MissionLedger } from '@teammate/mission-store'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import { plannerTextsIn } from './antigravity-cascade.js'
import type { CascadeApi } from './antigravity-cascade.js'
import { createAntigravityMissionService } from './antigravity-mission.js'

/**
 * A LONG ANTIGRAVITY ANSWER COMES BACK WHOLE (0.389).
 *
 * Colin, 2026-09-27, over a Chief of Staff answer on Flash: "slight bug" --
 * "1066 bytes the runtime did not keep" in the middle of it. Antigravity's
 * transcript keeps part of a long record; its language server keeps the step
 * whole, and the run now asks it before anything is recorded.
 */
const CONVERSATION = 'ec3897f1-dc20-44a5-bf84-e9de9f183ea0'
const BEFORE = 'Accessibility & Engine Core: Implements Windows High Contrast mode (`forced-colors: acti'
const AFTER = '/kill-switch recommendations due 2026-11-16 and municipal AI hearing developments.'
const WHOLE = `${BEFORE}ve\`) across the shell and every card, and owns the${AFTER}`

const record = (value: Record<string, unknown>): string => JSON.stringify(value)
const USER = record({ step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', created_at: '2026-09-27T04:42:52Z', content: '<USER_REQUEST>\nWho takes what?\n</USER_REQUEST>' })
const answer = (content: string): string =>
  record({ step_index: 12, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: '2026-09-27T04:44:52Z', content })

/** What the server's GetCascadeTrajectorySteps holds for step 12, in its own shape. */
const STEPS = {
  steps: [
    {
      type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
      status: 'CORTEX_STEP_STATUS_DONE',
      plannerResponse: { response: WHOLE, modifiedResponse: WHOLE, messageId: 'bot-1' }
    },
    { type: 'CORTEX_STEP_TYPE_USER_INPUT', status: 'CORTEX_STEP_STATUS_DONE' }
  ]
}

function fakeLedger(): MissionLedger {
  return {
    createMission: async () => undefined,
    appendEvents: async () => undefined,
    appendHostFailure: async () => undefined,
    getMission: async () => undefined,
    appendPeerLinks: async () => undefined,
    appendEditCheck: async () => undefined, appendApproval: async () => undefined
  } as unknown as MissionLedger
}

function harness(cascade: CascadeApi, transcriptLines: string[]) {
  const recorded: NormalizedRuntimeEvent[] = []
  let ids = 0
  const service = createAntigravityMissionService({
    workspacePath: 'C:\\work\\pebble',
    ledger: fakeLedger(),
    probe: async () => ({
      executablePath: 'C:\\lang\\language_server.exe',
      version: '2.15.1',
      address: 'localhost:57058',
      csrfToken: '60843f52-6d41-4d97-9b31-53157a780b5e',
      projects: new Map([['c:/work/pebble', 'daf0f8ec-bb8e-49e8-a445-954eb0a62d0f']]),
      ports: [57058]
    }),
    emitEvent: (_runId: string, _missionId: string, event: NormalizedRuntimeEvent) => recorded.push(event),
    agentApi: () => ({ newConversation: async () => CONVERSATION, sendMessage: async () => undefined }),
    readTranscript: async () => transcriptLines.join('\n'),
    home: 'C:\\Users\\dev',
    createId: () => String(++ids),
    now: () => new Date('2026-09-27T04:42:50Z'),
    pollMs: 5,
    notify: () => undefined,
    emitApproval: () => undefined,
    withdrawApproval: () => undefined,
    cascadeApi: () => cascade
  } as never)
  return { service, recorded }
}

const settle = async (ticks = 12): Promise<void> => {
  for (let i = 0; i < ticks; i += 1) await new Promise((resolve) => setTimeout(resolve, 10))
}

const cascadeWith = (texts: () => Promise<readonly string[]>) => {
  const asked: number[] = []
  const cascade: CascadeApi = {
    pendingQuestion: async () => undefined,
    answerQuestion: async () => undefined,
    plannerTexts: async (_conversationId, fromStep) => {
      asked.push(fromStep)
      return texts()
    }
  }
  return { cascade, asked }
}

const answerText = (recorded: readonly NormalizedRuntimeEvent[]): string | undefined => {
  const delta = recorded.find((event) => event.type === 'message.delta')
  return delta?.type === 'message.delta' ? delta.payload.text : undefined
}

describe('a long Antigravity answer', () => {
  it("reads the server's steps as the server writes them", () => {
    expect(plannerTextsIn(STEPS)).toEqual([WHOLE, WHOLE])
    expect(plannerTextsIn({ steps: [{ type: 'CORTEX_STEP_TYPE_GENERIC', plannerResponse: { response: 'x' } }] })).toEqual([])
  })

  it('is recorded whole: the gap in the transcript is filled from the step, asked for from that step on', async () => {
    const { cascade, asked } = cascadeWith(async () => plannerTextsIn(STEPS))
    const { service, recorded } = harness(cascade, [USER, answer(`${BEFORE}\n<truncated 1066 bytes>\n${AFTER}`)])
    await service.start('Who takes what?', undefined, {})
    await settle()
    expect(answerText(recorded)).toBe(WHOLE)
    expect(asked).toEqual([12])
    await service.dispose()
  })

  it('keeps the gap, drawn as before, when the server cannot say', async () => {
    const { cascade } = cascadeWith(async () => {
      throw new Error('Antigravity is not listening.')
    })
    const { service, recorded } = harness(cascade, [USER, answer(`${BEFORE}\n<truncated 1066 bytes>\n${AFTER}`)])
    await service.start('Who takes what?', undefined, {})
    await settle()
    expect(answerText(recorded)).toBe(`${BEFORE}\n<truncated 1066 bytes>\n${AFTER}`)
    await service.dispose()
  })

  it('asks the server nothing when nothing is missing', async () => {
    const { cascade, asked } = cascadeWith(async () => [WHOLE])
    const { service, recorded } = harness(cascade, [USER, answer('A short, whole answer.')])
    await service.start('Who takes what?', undefined, {})
    await settle()
    expect(answerText(recorded)).toBe('A short, whole answer.')
    expect(asked).toEqual([])
    await service.dispose()
  })
})
