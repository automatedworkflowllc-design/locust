import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import type { MissionLedger } from '@teammate/mission-store'

import type { MissionApprovalRequest } from '../shared/ipc.js'
import { createCascadeApi, pendingQuestionIn, questionInteraction } from './antigravity-cascade.js'
import type { AntigravityQuestionResponse, CascadeApi, CascadePost } from './antigravity-cascade.js'
import type { AntigravityHost } from './antigravity-host.js'
import { createAntigravityMissionService } from './antigravity-mission.js'
import { approvalAnswerFrom } from './approval-channel.js'

/**
 * A QUESTION ANTIGRAVITY ASKS IS ASKED IN LOCUST, AND ANSWERED THERE.
 *
 * Yurt's beta run, 2026-09-23: an Antigravity teammate called `ask_question`,
 * Antigravity drew the card in its own window, and Locust showed the question
 * only as a row among the folded tool calls. Colin: "he was hung up while
 * waiting on this answer since the google question wasnt popping up in our
 * chat". He answered it in Antigravity -- and that answer, read back off the
 * step, is what these fixtures are cut from (GetCascadeTrajectorySteps on the
 * conversation Yurt's drive opened, trimmed to what is read).
 */

const CONVERSATION = 'ec3897f1-dc20-44a5-bf84-e9de9f183ea0'
const TRAJECTORY = '90cfc6a4-467b-438e-9beb-3752d4bc4b89'
const QUESTION =
  'How would you like to organize this folder (currently containing [README.md](file:///c:/Users/<home>/Documents/antigravtest/README.md) and [hello.txt](file:///c:/Users/<home>/Documents/antigravtest/hello.txt))?'
const OPTIONS = [
  { id: '1', text: 'Standard Project Layout — Move documentation to `docs/` and data/source files to `src/`' },
  { id: '2', text: 'By File Type — Group files by extension into dedicated directories such as `markdown/` and `text/`' },
  { id: '3', text: 'Root with Scratch / Examples — Keep README.md at the root and move test files into a `scratch/` or `examples/` folder' },
  { id: '4', text: 'Flat Minimalist Layout — Retain all files at the root directory without subdirectories, using structured prefixes' }
]

const stepInfo = (stepIndex: number): Record<string, unknown> => ({ trajectoryId: TRAJECTORY, stepIndex, metadataIndex: 3, cascadeId: CONVERSATION })
/** The steps from 7 while the question waited: the call that asked, and the step holding for the answer. */
const WAITING = {
  steps: [
    { type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE', status: 'CORTEX_STEP_STATUS_DONE', metadata: { sourceTrajectoryStepInfo: stepInfo(7) } },
    {
      type: 'CORTEX_STEP_TYPE_ASK_QUESTION',
      // Its last transition before the answer, as recorded on the step.
      status: 'CORTEX_STEP_STATUS_RUNNING',
      metadata: { toolAction: 'Asking folder organization preference', sourceTrajectoryStepInfo: stepInfo(8) },
      askQuestion: { questions: [{ question: QUESTION, options: OPTIONS }] }
    }
  ]
}
/** What Antigravity's own window sent when Colin picked the first option, read back off the step. */
const IDE_ANSWER = {
  trajectoryId: TRAJECTORY,
  stepIndex: 8,
  askQuestion: { responses: [{ question: QUESTION, options: OPTIONS, selectedOptionIds: ['1'] }] }
}
const ANSWERED = {
  steps: [
    WAITING.steps[0],
    {
      ...WAITING.steps[1],
      status: 'CORTEX_STEP_STATUS_DONE',
      completedInteractions: [{ request: { askQuestion: { questions: [{ question: QUESTION, options: OPTIONS }] } }, response: IDE_ANSWER }]
    }
  ]
}

describe("Antigravity's waiting question, read off its own server", () => {
  it('is the step holding for an answer, with the ids an answer has to name', () => {
    expect(pendingQuestionIn(WAITING, 7)).toEqual({
      trajectoryId: TRAJECTORY,
      stepIndex: 8,
      action: 'Asking folder organization preference',
      questions: [{ question: QUESTION, options: OPTIONS, multiSelect: false }]
    })
  })

  it('is nothing once answered', () => {
    expect(pendingQuestionIn(ANSWERED, 7)).toBeUndefined()
    expect(pendingQuestionIn({ steps: [] }, 7)).toBeUndefined()
    expect(pendingQuestionIn('not a response', 7)).toBeUndefined()
  })
})

describe('the answer Locust sends', () => {
  const pending = pendingQuestionIn(WAITING, 7)!

  it("is exactly the one Antigravity's own window sent for the same choice", () => {
    expect(questionInteraction(CONVERSATION, pending, [{ selectedOptionIds: ['1'] }])).toEqual({ cascadeId: CONVERSATION, interaction: IDE_ANSWER })
  })

  it('carries words written in, and a skip, the way the card offers them', () => {
    const written = questionInteraction(CONVERSATION, pending, [{ selectedOptionIds: [], writeIn: '  keep it flat, but add a docs folder ' }])
    expect(written).toMatchObject({ interaction: { askQuestion: { responses: [{ selectedOptionIds: [], writeInResponse: 'keep it flat, but add a docs folder' }] } } })
    const skipped = questionInteraction(CONVERSATION, pending, [{ selectedOptionIds: [], skipped: true }])
    expect(skipped).toMatchObject({ interaction: { askQuestion: { responses: [{ selectedOptionIds: [], skipped: true }] } } })
  })
})

describe('talking to the server', () => {
  const host = (ports: readonly number[]): AntigravityHost => ({
    executablePath: 'C:\\lang\\language_server.exe',
    version: '2.15.1',
    address: `localhost:${String(ports[0])}`,
    csrfToken: '60843f52-6d41-4d97-9b31-53157a780b5e',
    projects: new Map(),
    ports
  })

  it("uses the plain-HTTP port, passing over the TLS one's refusal, and sends the CLI's token", async () => {
    const asked: { port: number; method: string; token: string }[] = []
    const post: CascadePost = async (port, method, _body, token) => {
      asked.push({ port, method, token })
      return port === 57058
        ? { status: 400, text: 'Client sent an HTTP request to an HTTPS server.\n' }
        : { status: 200, text: JSON.stringify(WAITING) }
    }
    const api = createCascadeApi(host([57058, 57059]), post)
    expect(await api.pendingQuestion(CONVERSATION, 7)).toMatchObject({ trajectoryId: TRAJECTORY, stepIndex: 8 })
    expect(asked.map((call) => call.port)).toEqual([57058, 57059])
    expect(asked.every((call) => call.method === 'GetCascadeTrajectorySteps' && call.token === '60843f52-6d41-4d97-9b31-53157a780b5e')).toBe(true)
    // And remembers it.
    await api.pendingQuestion(CONVERSATION, 7)
    expect(asked.map((call) => call.port).slice(2)).toEqual([57059])
  })

  it("says why when Antigravity refuses the answer, in the server's own words", async () => {
    const post: CascadePost = async () => ({ status: 400, text: JSON.stringify({ code: 'failed_precondition', message: 'step 8 is not waiting for an interaction' }) })
    const api = createCascadeApi(host([57059]), post)
    await expect(api.answerQuestion(CONVERSATION, pendingQuestionIn(WAITING, 7)!, [{ selectedOptionIds: ['1'] }])).rejects.toThrow('step 8 is not waiting for an interaction')
  })
})

// ---------------------------------------------------------------------------
// The mission service: raises the card, answers it, and takes it down.

const WORKSPACE = 'C:\\work\\pebble'
const HOME = 'C:\\Users\\dev'

const record = (value: Record<string, unknown>): string => JSON.stringify(value)
const USER = record({ step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', created_at: '2026-09-23T04:42:52Z', content: '<USER_REQUEST>\nAsk me to choose.\n</USER_REQUEST>' })
const ASKS = record({
  step_index: 7,
  source: 'MODEL',
  type: 'PLANNER_RESPONSE',
  status: 'DONE',
  created_at: '2026-09-23T04:43:02Z',
  tool_calls: [
    {
      name: 'ask_question',
      args: {
        questions: JSON.stringify([{ is_multi_select: false, options: OPTIONS.map((option) => option.text), question: QUESTION }]),
        toolAction: JSON.stringify('Asking folder organization preference'),
        toolSummary: JSON.stringify('Folder organization options')
      }
    }
  ]
})
const ANSWER_ARRIVES = record({ step_index: 8, source: 'MODEL', type: 'GENERIC', status: 'DONE', created_at: '2026-09-23T04:43:04Z', content: `Created At: 2026-09-23T00:43:04-04:00\nCompleted At: 2026-09-23T00:44:07-04:00\nA1: ${OPTIONS[0]!.text}` })

function fakeLedger(): MissionLedger {
  return {
    createMission: async () => undefined,
    appendEvents: async () => undefined,
    appendHostFailure: async () => undefined,
    getMission: async () => undefined,
    appendPeerLinks: async () => undefined, appendEditCheck: async () => undefined, appendApproval: async () => undefined
  } as unknown as MissionLedger
}

function fakeCascade(pending: boolean): CascadeApi & { answers: AntigravityQuestionResponse[][]; looks: number } {
  const fake = {
    answers: [] as AntigravityQuestionResponse[][],
    looks: 0,
    pendingQuestion: async (_conversationId: string, fromStep: number) => {
      fake.looks += 1
      return pending ? pendingQuestionIn(WAITING, fromStep) : undefined
    },
    answerQuestion: async (_conversationId: string, _pending: unknown, responses: readonly AntigravityQuestionResponse[]) => {
      fake.answers.push([...responses])
    },
    // No gaps in these transcripts, so nothing is asked for.
    plannerTexts: async () => []
  }
  return fake
}

function harness(cascade: CascadeApi, options: { readonly idleTimeoutMs?: number } = {}) {
  const transcript = { lines: [USER] }
  const raised: MissionApprovalRequest[] = []
  const withdrawn: string[] = []
  const notices: string[] = []
  let ids = 0
  const service = createAntigravityMissionService({
    workspacePath: WORKSPACE,
    ledger: fakeLedger(),
    probe: async () => ({
      executablePath: 'C:\\lang\\language_server.exe',
      version: '2.15.1',
      address: 'localhost:57058',
      csrfToken: '60843f52-6d41-4d97-9b31-53157a780b5e',
      projects: new Map([['c:/work/pebble', 'daf0f8ec-bb8e-49e8-a445-954eb0a62d0f']]),
      ports: [57058, 57059]
    }),
    emitEvent: () => undefined,
    agentApi: () => ({ newConversation: async () => CONVERSATION, sendMessage: async () => undefined }),
    readTranscript: async () => transcript.lines.join('\n'),
    home: HOME,
    createId: () => String(++ids),
    now: () => new Date('2026-09-23T04:42:50Z'),
    pollMs: 5,
    notify: ({ message }) => notices.push(message),
    emitApproval: (request) => raised.push(request),
    withdrawApproval: (approvalId) => withdrawn.push(approvalId),
    cascadeApi: () => cascade,
    questionLookups: 3,
    ...(options.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: options.idleTimeoutMs })
  })
  return { service, transcript, raised, withdrawn, notices }
}

const settle = async (ticks = 12): Promise<void> => {
  for (let i = 0; i < ticks; i += 1) await new Promise((resolve) => setTimeout(resolve, 10))
}

describe('a teammate on Antigravity that asks', () => {
  it("raises Locust's question card: the question in words, its options, a skip, and who is asking", async () => {
    const cascade = fakeCascade(true)
    const { service, transcript, raised } = harness(cascade)
    const run = await service.start('Ask me to choose.', undefined, {})
    transcript.lines.push(ASKS)
    await settle()
    expect(raised).toHaveLength(1)
    const card = raised[0]!
    expect(card).toMatchObject({ runId: run.runId, missionId: run.missionId, runtime: 'antigravity', kind: 'question', blocking: true, skippable: true, summary: 'Asking folder organization preference' })
    expect(card.answerIn).toBeUndefined()
    // The markdown links read as the words they show.
    expect(card.questions?.[0]?.question).toBe('How would you like to organize this folder (currently containing README.md and hello.txt)?')
    expect(card.questions?.[0]?.options.map((option) => option.label)).toEqual(OPTIONS.map((option) => option.text))
    expect(card.questions?.[0]?.isOther).toBe(true)
    await service.dispose()
  })

  it('answers it through Antigravity: the option picked, by its id', async () => {
    const cascade = fakeCascade(true)
    const { service, transcript, raised } = harness(cascade)
    await service.start('Ask me to choose.', undefined, {})
    transcript.lines.push(ASKS)
    await settle()
    const ok = await service.decide({ approvalId: raised[0]!.approvalId, answers: { '0': [OPTIONS[0]!.text] } })
    expect(ok).toBe(true)
    expect(cascade.answers).toEqual([[{ selectedOptionIds: ['1'] }]])
    // Once only: a double click does not answer twice.
    expect(await service.decide({ approvalId: raised[0]!.approvalId, answers: { '0': [OPTIONS[1]!.text] } })).toBe(false)
    await service.dispose()
  })

  it('sends words written in, and Skip as a skip', async () => {
    const cascade = fakeCascade(true)
    const { service, transcript, raised } = harness(cascade)
    await service.start('Ask me to choose.', undefined, {})
    transcript.lines.push(ASKS)
    await settle()
    await service.decide({ approvalId: raised[0]!.approvalId, answers: { '0': ['keep it flat'] } })
    expect(cascade.answers[0]).toEqual([{ selectedOptionIds: [], writeIn: 'keep it flat' }])
    await service.dispose()

    const second = fakeCascade(true)
    const other = harness(second)
    await other.service.start('Ask me to choose.', undefined, {})
    other.transcript.lines.push(ASKS)
    await settle()
    await other.service.decide({ approvalId: other.raised[0]!.approvalId, answers: { '0': [] } })
    expect(second.answers[0]).toEqual([{ selectedOptionIds: [], skipped: true }])
    await other.service.dispose()
  })

  it("takes the card down when it was answered in Antigravity's own window", async () => {
    const { service, transcript, raised, withdrawn } = harness(fakeCascade(true))
    await service.start('Ask me to choose.', undefined, {})
    transcript.lines.push(ASKS)
    await settle()
    transcript.lines.push(ANSWER_ARRIVES)
    await settle()
    expect(withdrawn).toEqual([raised[0]!.approvalId])
    await service.dispose()
  })

  it('never takes a run that is waiting on the person for one that went quiet', async () => {
    const { service, transcript, raised, notices } = harness(fakeCascade(true), { idleTimeoutMs: 40 })
    const run = await service.start('Ask me to choose.', undefined, {})
    transcript.lines.push(ASKS)
    await settle(20)
    expect(raised).toHaveLength(1)
    expect(service.has(run.runId)).toBe(true)
    expect(notices.some((message) => /might|without reporting/i.test(message))).toBe(false)
    await service.dispose()
  })

  it("still shows the question when the waiting step cannot be found -- and says to answer it in Antigravity", async () => {
    const cascade = fakeCascade(false)
    const { service, transcript, raised } = harness(cascade)
    await service.start('Ask me to choose.', undefined, {})
    transcript.lines.push(ASKS)
    await settle(20)
    expect(cascade.looks).toBe(3)
    expect(raised).toHaveLength(1)
    expect(raised[0]).toMatchObject({ answerIn: 'Antigravity', kind: 'question' })
    expect(raised[0]!.skippable).toBeUndefined()
    // There is nothing here to answer it with.
    expect(await service.decide({ approvalId: raised[0]!.approvalId, answers: { '0': [OPTIONS[0]!.text] } })).toBe(false)
    await service.dispose()
  })

  it('takes the card down when the run ends with it still up', async () => {
    const { service, transcript, raised, withdrawn } = harness(fakeCascade(true))
    const run = await service.start('Ask me to choose.', undefined, {})
    transcript.lines.push(ASKS)
    await settle()
    service.cancel(run.runId)
    await settle(4)
    expect(withdrawn).toEqual([raised[0]!.approvalId])
  })

  it('says so in the thread when Antigravity would not take the answer, and keeps the card', async () => {
    const cascade = fakeCascade(true)
    cascade.answerQuestion = async () => {
      throw new Error('step 8 is not waiting for an interaction')
    }
    const { service, transcript, raised, notices, withdrawn } = harness(cascade)
    await service.start('Ask me to choose.', undefined, {})
    transcript.lines.push(ASKS)
    await settle()
    expect(await service.decide({ approvalId: raised[0]!.approvalId, answers: { '0': [OPTIONS[0]!.text] } })).toBe(false)
    expect(notices.some((message) => message.includes('step 8 is not waiting for an interaction') && message.includes("Antigravity's own window"))).toBe(true)
    expect(withdrawn).toEqual([])
    await service.dispose()
  })
})

describe('what the card sends reaches the service', () => {
  it("forwards a question's answers, which used to be dropped as a denial", () => {
    expect(approvalAnswerFrom({ approvalId: 'ap_1', answers: { '0': ['Standard Project Layout'] } })).toEqual({ approvalId: 'ap_1', answers: { '0': ['Standard Project Layout'] } })
    expect(approvalAnswerFrom({ approvalId: 'ap_1', answers: { '0': [] } })).toEqual({ approvalId: 'ap_1', answers: { '0': [] } })
  })

  it('refuses answers that are not lists of words, and a message with no id', () => {
    expect(approvalAnswerFrom({ approvalId: 'ap_1', answers: { '0': [3] } })).toBeUndefined()
    expect(approvalAnswerFrom({ approvalId: 'ap_1', answers: ['yes'] })).toBeUndefined()
    expect(approvalAnswerFrom({ answers: { '0': ['x'] } })).toBeUndefined()
  })

  it('is what the decide handler reads, and Antigravity is asked too', () => {
    const source = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8')
    const at = source.indexOf('ipcMain.handle(MISSION_APPROVAL_DECIDE_CHANNEL')
    const handler = source.slice(at, at + 1400)
    expect(at).toBeGreaterThan(-1)
    expect(handler).toContain('approvalAnswerFrom(answer)')
    // Through the one funnel (0.521), which asks Antigravity too.
    expect(handler).toContain('answerApproval(decided)')
    expect(source).toContain('codexMissions.decide(answer) || permissionHost.decide(answer) || (await antigravityMissions.decide(answer))')
  })

  it('still reads anything but a recognized decision as a denial', () => {
    expect(approvalAnswerFrom({ approvalId: 'ap_1', decision: 'approve-once' })).toEqual({ approvalId: 'ap_1', decision: 'approve-once' })
    expect(approvalAnswerFrom({ approvalId: 'ap_1', decision: 'yes please' })).toEqual({ approvalId: 'ap_1', decision: 'deny' })
    expect(approvalAnswerFrom({ approvalId: 'ap_1' })).toEqual({ approvalId: 'ap_1', decision: 'deny' })
  })
})
