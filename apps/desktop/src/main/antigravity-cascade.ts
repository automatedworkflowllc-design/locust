import http from 'node:http'

import type { AntigravityHost } from './antigravity-host.js'

/**
 * ANTIGRAVITY'S OWN SERVER, SPOKEN TO DIRECTLY -- for the one thing the
 * `agentapi` CLI cannot do: answer a question its agent asked.
 *
 * Yurt, beta-testing on 2026-09-23, sat on an Antigravity run that had
 * called its `ask_question` tool: Antigravity drew the card in its own
 * window, and Locust showed the question only as a row inside the folded
 * tool calls. Colin: "he was hung up while waiting on this answer since the
 * google question wasnt popping up in our chat". Colin answered it in
 * Antigravity, and that answer is what showed the way.
 *
 * On 2026-09-08 this looked unreachable: the CLI has three commands, and
 * `send-message` arrives as a SYSTEM_MESSAGE rather than as the answer
 * (docs/FINDING-antigravity-ask-question.md). But the IDE does not use the
 * CLI. It answers through the language server's Connect service -- the same
 * process, the same CSRF token Locust already reads off its command line --
 * with `HandleCascadeUserInteraction`. Measured against Antigravity 2.15.1:
 *
 * - The server listens on two loopback ports: one TLS, one plain HTTP. Both
 *   speak Connect with JSON bodies and `x-codeium-csrf-token`; the plain one
 *   needs no certificate exception. The TLS port answers a plain request
 *   with 400 "Client sent an HTTP request to an HTTPS server".
 * - The message shapes are read from the descriptors compiled into
 *   `language_server.exe`: `HandleCascadeUserInteractionRequest {cascade_id,
 *   interaction}`, `CascadeUserInteraction {trajectory_id, step_index, oneof
 *   ... ask_question = 22}`, `AskQuestionInteraction {responses, cancelled}`,
 *   `AskQuestionEntry {question, options, is_multi_select,
 *   selected_option_ids, write_in_response, skipped}`.
 * - The ids those need are not in the transcript. The trajectory id differs
 *   from the conversation id, and the options carry ids ("1".."4") that the
 *   tool call does not. Both come from `GetCascadeTrajectorySteps`, which
 *   returns the waiting ASK_QUESTION step with its options and its
 *   `sourceTrajectoryStepInfo`.
 * - The answer Colin gave in the IDE is on that step as
 *   `completedInteractions[0].response`, and it is exactly the interaction
 *   `questionInteraction` builds (a-question-antigravity-asks.test.ts holds
 *   the two against each other).
 *
 * Reverse-engineered, like everything else on this route: a build of
 * Antigravity that changes it makes the lookup come back empty, and the card
 * then says to answer in Antigravity's own window, as it did before.
 */

const SERVICE = '/exa.language_server_pb.LanguageServerService/'
/** A trajectory can be long; the steps after a question are a handful. */
const RESPONSE_LIMIT = 8 * 1024 * 1024
const CALL_TIMEOUT_MS = 5_000

/** A step in one of these states is over; any other is still going, or waiting. */
const FINISHED = new Set([
  'CORTEX_STEP_STATUS_DONE',
  'CORTEX_STEP_STATUS_ERROR',
  'CORTEX_STEP_STATUS_CANCELED',
  'CORTEX_STEP_STATUS_CLEARED',
  'CORTEX_STEP_STATUS_HALTED',
  'CORTEX_STEP_STATUS_INTERRUPTED',
  'CORTEX_STEP_STATUS_INVALID'
])

export interface AntigravityQuestionOption {
  readonly id: string
  readonly text: string
}

export interface AntigravityAskedQuestion {
  readonly question: string
  readonly options: readonly AntigravityQuestionOption[]
  readonly multiSelect: boolean
}

/** The step waiting on the person, with the ids an answer has to name. */
export interface AntigravityPendingQuestion {
  readonly trajectoryId: string
  readonly stepIndex: number
  /** What the agent said it was doing, "Asking folder organization preference". */
  readonly action: string | undefined
  readonly questions: readonly AntigravityAskedQuestion[]
}

/** One question's answer: options chosen, words written in, or neither. */
export interface AntigravityQuestionResponse {
  readonly selectedOptionIds: readonly string[]
  readonly writeIn?: string
  readonly skipped?: boolean
}

export interface CascadeApi {
  /** The ask_question step waiting on the person, at or after `fromStep`; undefined when there is none. */
  pendingQuestion(conversationId: string, fromStep: number): Promise<AntigravityPendingQuestion | undefined>
  /** Answer it. Throws, saying why, when Antigravity did not take the answer. */
  answerQuestion(conversationId: string, pending: AntigravityPendingQuestion, responses: readonly AntigravityQuestionResponse[]): Promise<void>
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): string | undefined => (typeof value === 'string' && value.length > 0 ? value : undefined)

/**
 * The waiting question in a `GetCascadeTrajectorySteps` response, newest
 * first. A step that has finished, or already carries a completed
 * interaction, has been answered.
 */
export function pendingQuestionIn(response: unknown, fromStep: number): AntigravityPendingQuestion | undefined {
  const steps = isRecord(response) && Array.isArray(response.steps) ? response.steps : []
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index]
    if (!isRecord(step) || step.type !== 'CORTEX_STEP_TYPE_ASK_QUESTION') continue
    if (typeof step.status === 'string' && FINISHED.has(step.status)) continue
    if (Array.isArray(step.completedInteractions) && step.completedInteractions.length > 0) continue
    const metadata = isRecord(step.metadata) ? step.metadata : {}
    const source = isRecord(metadata.sourceTrajectoryStepInfo) ? metadata.sourceTrajectoryStepInfo : {}
    const trajectoryId = text(source.trajectoryId)
    if (trajectoryId === undefined) continue
    // proto3 JSON leaves a zero out, so a missing index is the offset's own.
    const stepIndex = typeof source.stepIndex === 'number' ? source.stepIndex : fromStep + index
    const asked = isRecord(step.askQuestion) && Array.isArray(step.askQuestion.questions) ? step.askQuestion.questions : []
    const questions = asked.flatMap((entry): AntigravityAskedQuestion[] => {
      if (!isRecord(entry)) return []
      const question = text(entry.question)
      if (question === undefined) return []
      const options = (Array.isArray(entry.options) ? entry.options : []).flatMap((option): AntigravityQuestionOption[] => {
        if (!isRecord(option)) return []
        const id = text(option.id)
        const label = text(option.text)
        return id === undefined || label === undefined ? [] : [{ id, text: label }]
      })
      return [{ question, options, multiSelect: entry.isMultiSelect === true }]
    })
    if (questions.length === 0) continue
    return { trajectoryId, stepIndex, action: text(metadata.toolAction), questions }
  }
  return undefined
}

/**
 * The `HandleCascadeUserInteraction` request that answers `pending`.
 *
 * Each question goes back as the server sent it -- its text and its options
 * with their ids -- with the person's choice beside it: the ids of the
 * options they picked, what they wrote in, or `skipped`. Defaults are left
 * out, as the IDE's own answer leaves them out.
 */
export function questionInteraction(
  conversationId: string,
  pending: AntigravityPendingQuestion,
  responses: readonly AntigravityQuestionResponse[]
): Record<string, unknown> {
  return {
    cascadeId: conversationId,
    interaction: {
      trajectoryId: pending.trajectoryId,
      stepIndex: pending.stepIndex,
      askQuestion: {
        responses: pending.questions.map((question, index) => {
          const response = responses[index] ?? { selectedOptionIds: [], skipped: true }
          const writeIn = response.writeIn?.trim() ?? ''
          return {
            question: question.question,
            options: question.options.map((option) => ({ id: option.id, text: option.text })),
            ...(question.multiSelect ? { isMultiSelect: true } : {}),
            selectedOptionIds: [...response.selectedOptionIds],
            ...(writeIn.length > 0 ? { writeInResponse: writeIn } : {}),
            ...(response.skipped === true ? { skipped: true } : {})
          }
        })
      }
    }
  }
}

export type CascadePost = (port: number, method: string, body: unknown, token: string) => Promise<{ readonly status: number; readonly text: string }>

/** One Connect call over loopback HTTP, bounded in time and size. */
const postJson: CascadePost = (port, method, body, token) =>
  new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: `${SERVICE}${method}`,
        headers: {
          'content-type': 'application/json',
          'connect-protocol-version': '1',
          'x-codeium-csrf-token': token,
          'content-length': Buffer.byteLength(payload)
        },
        timeout: CALL_TIMEOUT_MS
      },
      (response) => {
        let received = ''
        response.setEncoding('utf8')
        response.on('data', (chunk: string) => {
          received += chunk
          if (received.length > RESPONSE_LIMIT) response.destroy(new Error('Antigravity answered with more than Locust reads.'))
        })
        response.on('end', () => resolve({ status: response.statusCode ?? 0, text: received }))
        response.on('error', reject)
      }
    )
    request.on('timeout', () => request.destroy(new Error(`Antigravity did not answer within ${String(CALL_TIMEOUT_MS / 1000)} seconds.`)))
    request.on('error', reject)
    request.end(payload)
  })

/** The TLS port's reply to a plain request: the other port is the one. */
const wrongPort = (result: { readonly status: number; readonly text: string }): boolean =>
  result.status === 400 && /HTTP request to an HTTPS server/i.test(result.text)

/** Why a Connect call failed, in its own words when it gave any. */
function failure(result: { readonly status: number; readonly text: string }): string {
  try {
    const parsed = JSON.parse(result.text) as { message?: unknown; code?: unknown }
    if (typeof parsed.message === 'string' && parsed.message.length > 0) return parsed.message
    if (typeof parsed.code === 'string') return parsed.code
  } catch {
    // Not JSON: say the status.
  }
  return `HTTP ${String(result.status)}`
}

export function createCascadeApi(host: AntigravityHost, post: CascadePost = postJson): CascadeApi {
  const addressPort = Number(host.address.split(':').pop())
  const ports = (): readonly number[] => {
    const known = host.ports ?? []
    return [...new Set([...known, ...(Number.isInteger(addressPort) ? [addressPort] : [])])]
  }
  // The port that last answered, tried first next time.
  let answering: number | undefined

  const call = async (method: string, body: unknown): Promise<unknown> => {
    const order = answering === undefined ? ports() : [answering, ...ports().filter((port) => port !== answering)]
    let last = 'Antigravity is not listening.'
    for (const port of order) {
      let result: { readonly status: number; readonly text: string }
      try {
        result = await post(port, method, body, host.csrfToken)
      } catch (error) {
        last = error instanceof Error ? error.message : String(error)
        continue
      }
      if (wrongPort(result)) continue
      answering = port
      if (result.status !== 200) throw new Error(failure(result))
      if (result.text.trim().length === 0) return {}
      return JSON.parse(result.text) as unknown
    }
    throw new Error(last)
  }

  return {
    async pendingQuestion(conversationId, fromStep) {
      const response = await call('GetCascadeTrajectorySteps', { cascadeId: conversationId, stepOffset: Math.max(0, fromStep) })
      return pendingQuestionIn(response, Math.max(0, fromStep))
    },
    async answerQuestion(conversationId, pending, responses) {
      await call('HandleCascadeUserInteraction', questionInteraction(conversationId, pending, responses))
    }
  }
}
