import { randomUUID } from 'node:crypto'

import type { AppServerRequest, JsonValue, NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import type {
  CodexMissionUpdate,
  MissionApprovalAnswer,
  MissionApprovalDecision,
  MissionApprovalKind,
  MissionApprovalRequest,
  MissionQuestion,
  MissionQuestionOption
} from '../shared/ipc.js'
import { approvalPatchFrom } from './approval-patch.js'
import { relativeToFolder } from '../shared/approval-patch.js'
import type { FileChangeRecord } from './approval-patch.js'

/**
 * The approval channel: what a runtime asks a person mid-run, and what the
 * person answers.
 *
 * This used to live inside a second mission service that existed for one
 * mode -- Approve-each ran on `codex app-server` because it was the only
 * transport that could stop and ask, and everything else ran on `codex exec`.
 * Since 0.65.0 every Codex mode runs on app-server through the one mission
 * loop, so the service that duplicated that loop for one mode is gone, and
 * the only thing Approve-each still needs of its own is this: a handler for
 * the server's requests, a registry of what is waiting on the person, and the
 * two rules below about matching an answer to what was asked.
 *
 * Nothing here knows about processes or ledgers. It is handed a run's ids and
 * the file changes it has announced, and it hands back a request handler.
 */

const MAX_APPROVAL_DETAIL = 4_000
const MAX_PENDING_APPROVALS = 16

/** What the protocol's approval methods mean in the product's own words. */
export function approvalKindFor(method: string): MissionApprovalKind | undefined {
  if (method === 'item/commandExecution/requestApproval') return 'command'
  if (method === 'item/fileChange/requestApproval') return 'file-change'
  if (method === 'item/tool/requestUserInput') return 'question'
  return undefined
}

function bounded(value: unknown): string {
  if (typeof value !== 'string') return ''
  const single = value.replace(/\s+/g, ' ').trim()
  return single.length > MAX_APPROVAL_DETAIL ? `${single.slice(0, MAX_APPROVAL_DETAIL - 1)}…` : single
}

/**
 * Turn a protocol approval request into something a person can decide about.
 * A card that cannot say WHAT would happen is not an approval, it is a dare.
 */
export function describeApproval(request: AppServerRequest):
  | {
      readonly kind: MissionApprovalKind
      readonly summary: string
      readonly detail: string
      readonly cwd: string | null
      readonly questions?: readonly MissionQuestion[]
    }
  | undefined {
  const kind = approvalKindFor(request.method)
  if (kind === undefined) return undefined
  const params = (typeof request.params === 'object' && request.params !== null ? request.params : {}) as Record<
    string,
    unknown
  >
  const cwd = typeof params.cwd === 'string' ? params.cwd : null

  if (kind === 'command') {
    const command = bounded(params.command)
    return {
      kind,
      summary: command.length > 0 ? 'Run a command' : 'Run a command it did not describe',
      detail: command,
      cwd
    }
  }
  if (kind === 'file-change') {
    const changes = Array.isArray(params.changes) ? params.changes.length : undefined
    return {
      kind,
      summary: changes === undefined ? 'Change files' : `Change ${changes} file${changes === 1 ? '' : 's'}`,
      // The diff itself is not shown here: it can be enormous, and the card's
      // job is to say what is about to happen, not to be a diff viewer.
      detail: bounded(params.summary ?? params.explanation ?? ''),
      cwd
    }
  }
  /*
   * A question, read the way the protocol actually sends it.
   *
   * This looked for singular `params.question`, `params.prompt` or
   * `params.message`. The request carries a `questions` ARRAY -- each entry
   * with `id`, `header`, `question`, `isOther`, `isSecret` and nullable
   * `options` -- so none of the three ever matched and the card drew "Answer a
   * question" with nothing under it. Verified against the schema codex-cli
   * 0.153.0 generates for itself (Astra, 2026-09-09).
   *
   * The singular keys are still read, last, because a request that carries one
   * costs nothing to honour and this build should not be the reason a question
   * goes unshown twice.
   */
  const questions = questionsOf(params)
  const first = questions[0]
  const detail =
    first !== undefined
      ? bounded(first.question)
      : bounded(params.question ?? params.prompt ?? params.message ?? '')
  return {
    kind,
    summary:
      questions.length > 1 ? `Answer ${String(questions.length)} questions` : 'Answer a question',
    detail,
    cwd,
    questions
  }
}

/** How many questions one request may carry, and how many options each may offer. */
const MAX_QUESTIONS = 12
const MAX_OPTIONS = 24

/** The `questions` array, defensively: a malformed entry is dropped, not guessed at. */
export function questionsOf(params: Record<string, unknown>): readonly MissionQuestion[] {
  const raw = Array.isArray(params.questions) ? params.questions : []
  const questions: MissionQuestion[] = []
  for (const entry of raw.slice(0, MAX_QUESTIONS)) {
    if (typeof entry !== 'object' || entry === null) continue
    const value = entry as Record<string, unknown>
    // An answer is filed under the id. Without one there is nowhere to put the
    // person's reply, so the question cannot be answered and is not offered.
    const id = typeof value.id === 'string' ? value.id : undefined
    const text = bounded(value.question)
    if (id === undefined || id.length === 0 || text.length === 0) continue
    const options: MissionQuestionOption[] = []
    for (const option of Array.isArray(value.options) ? value.options.slice(0, MAX_OPTIONS) : []) {
      if (typeof option !== 'object' || option === null) continue
      const shape = option as Record<string, unknown>
      const label = bounded(shape.label)
      // The label IS the identity: the protocol gives options no id or index,
      // and the server matches a returned string against the labels it sent.
      // An option with no label cannot be chosen, so it is not drawn.
      if (label.length === 0) continue
      options.push({
        label,
        description: typeof shape.description === 'string' ? bounded(shape.description) : null
      })
    }
    questions.push({
      id,
      header: typeof value.header === 'string' ? bounded(value.header) : null,
      question: text,
      options,
      isOther: value.isOther === true,
      isSecret: value.isSecret === true
    })
  }
  return questions
}

/** The protocol decision for each of the product's three authorization answers. */
export function protocolDecisionFor(decision: MissionApprovalDecision): string {
  if (decision === 'approve-once') return 'accept'
  // Session-scoped, never durable: a forever-grant is a Settings decision, not
  // one to take mid-run under time pressure.
  if (decision === 'approve-always') return 'acceptForSession'
  return 'reject'
}

/**
 * The protocol result for one answer, whichever kind it is.
 *
 * A question is answered, an action is authorized, and they do not share a
 * payload. `item/tool/requestUserInput` wants
 *
 *     { answers: { <questionId>: { answers: [ "<literal label or free text>" ] } } }
 *
 * and a decision is not a member of that type. Locust sent one anyway, for all
 * three buttons: the server logs the deserialization failure, substitutes an
 * EMPTY answer map, and tells the model the person said nothing. Whatever they
 * had chosen was discarded on the way (Astra, 2026-09-09, from the version-
 * matched upstream handler).
 *
 * An option is identified by its LITERAL LABEL. The protocol gives options no
 * id and no index, and the server matches the strings it gets back against the
 * labels it sent -- so sending `"3"` for the third option answers with the
 * string "3".
 */
export function protocolAnswerFor(answer: MissionApprovalAnswer): JsonValue {
  if ('answers' in answer) {
    const answers: Record<string, JsonValue> = {}
    for (const [questionId, given] of Object.entries(answer.answers)) {
      // An empty list is a question the person left alone. Sent as an empty
      // array rather than omitted, so "asked and not answered" and "never
      // asked" stay distinguishable on the wire.
      answers[questionId] = { answers: [...given] }
    }
    return { answers }
  }
  return { decision: protocolDecisionFor(answer.decision) }
}

/**
 * A fileChange item's tool rows carry the change itself.
 *
 * The app-server normaliser writes "N file change(s)" as the row's command
 * and no patch, so after an APPROVED edit the activity fold read "Codex CLI
 * did not report the change" beside a row for a file whose diff the
 * approval card had just shown (seen driving the app, 2026-09-05). The
 * item's `changes` are remembered by id for the approval; the same record
 * gives the row its paths and its patch.
 */
export function withFileChanges(
  events: readonly NormalizedRuntimeEvent[],
  changesByItem: ReadonlyMap<string, readonly FileChangeRecord[]>,
  workspacePath: string
): readonly NormalizedRuntimeEvent[] {
  return events.map((event) => {
    if (event.type !== 'tool.started' && event.type !== 'tool.completed' && event.type !== 'tool.failed') return event
    const payload = event.payload as { readonly itemId?: string; readonly toolKind?: string; readonly command?: string; readonly patch?: unknown }
    if (payload.toolKind !== 'fileChange' || payload.itemId === undefined) return event
    const changes = changesByItem.get(payload.itemId)
    if (changes === undefined || changes.length === 0) return event
    const patch = approvalPatchFrom(changes, workspacePath)
    const paths = changes.map((change) => relativeToFolder(change.path, workspacePath)).join('\n')
    return {
      ...event,
      payload: {
        ...payload,
        command: paths,
        ...(patch === undefined ? {} : { patch })
      }
    } as NormalizedRuntimeEvent
  })
}

/** What a request handler needs to know about the run it is answering for. */
export interface ApprovalRun {
  readonly runId: string
  readonly missionId: string
  /** Where the run works; a card's paths are shown relative to it. */
  readonly cwd: string
  /**
   * File changes the run has announced, by item id, so a file-change card
   * can carry the diff Codex attached to the item the approval is about.
   */
  readonly changesByItem: ReadonlyMap<string, readonly FileChangeRecord[]>
}

export interface ApprovalChannel {
  /** The `onRequest` for one run: raises the card and waits for the answer. */
  requestHandlerFor(run: ApprovalRun): (request: AppServerRequest) => Promise<JsonValue>
  /** The person's answer. False when nothing was waiting under that id. */
  decide(answer: MissionApprovalAnswer): boolean
  /** The run is over: refuse whatever it was still asking, so no card waits forever. */
  release(runId: string): void
  readonly pendingCount: number
}

export interface ApprovalChannelOptions {
  readonly emitApproval: (request: MissionApprovalRequest) => void
  /** Notices about a request that was refused without reaching the person. */
  readonly emitUpdate?: (update: CodexMissionUpdate) => void
  readonly createId?: () => string
  readonly now?: () => Date
}

export function createApprovalChannel(options: ApprovalChannelOptions): ApprovalChannel {
  const createId = options.createId ?? randomUUID
  const now = options.now ?? (() => new Date())

  interface Pending {
    readonly runId: string
    readonly missionId: string
    /**
     * What the runtime asked for, kept so an answer can be checked against it.
     *
     * A question takes answers and an action takes a decision, and the server
     * validates neither -- it deserializes, fails silently, and substitutes an
     * empty answer. So the pairing is enforced here, and that needs the kind
     * to still be in hand when the person replies.
     */
    readonly kind: MissionApprovalKind
    readonly resolve: (value: JsonValue) => void
  }
  const approvals = new Map<string, Pending>()

  const release = (runId: string): void => {
    for (const [approvalId, pending] of approvals) {
      if (pending.runId !== runId) continue
      approvals.delete(approvalId)
      pending.resolve({ decision: 'reject' })
    }
  }

  return {
    requestHandlerFor(run) {
      const { runId, missionId } = run
      return async (request) => {
        const refuse = (why: string): JsonValue => {
          options.emitUpdate?.({ kind: 'relay-notice', runId, missionId, message: why })
          return { decision: 'reject' }
        }
        const described = describeApproval(request)
        if (described === undefined) {
          return refuse(
            `Locust denied a request it does not recognise (${request.method}) because it could not say what would happen. This build is older than the runtime's protocol.`
          )
        }
        if (approvals.size >= MAX_PENDING_APPROVALS) {
          return refuse(
            `Locust denied an action because ${String(MAX_PENDING_APPROVALS)} approvals are already waiting on you. Answer some of them and ask again.`
          )
        }
        const approvalId = `ap_${createId()}`
        const requestParams = (typeof request.params === 'object' && request.params !== null ? request.params : {}) as Record<string, unknown>
        const itemId = typeof requestParams.itemId === 'string' ? requestParams.itemId : undefined
        const changes = described.kind === 'file-change' && itemId !== undefined ? run.changesByItem.get(itemId) : undefined
        const patch = approvalPatchFrom(changes, run.cwd)
        return await new Promise<JsonValue>((resolve) => {
          approvals.set(approvalId, { runId, missionId, kind: described.kind, resolve })
          options.emitApproval({
            approvalId,
            runId,
            missionId,
            runtime: 'codex',
            kind: described.kind,
            ...(described.questions === undefined || described.questions.length === 0
              ? {}
              : { questions: described.questions }),
            ...(requestParams.isBlocking === false ? { blocking: false } : {}),
            summary: changes !== undefined && changes.length > 0 ? `Change ${String(changes.length)} file${changes.length === 1 ? '' : 's'}` : described.summary,
            detail: described.detail,
            cwd: described.cwd,
            requestedAt: now().toISOString(),
            ...(patch === undefined ? {} : { patch: { text: patch.text, added: patch.added, removed: patch.removed, truncated: patch.truncated } })
          })
        })
      }
    },

    decide(answer) {
      const pending = approvals.get(answer.approvalId)
      // An unknown or already-answered id is ignored rather than throwing: a
      // double-click on the card must not take the run down.
      if (pending === undefined) return false
      approvals.delete(answer.approvalId)
      /*
       * A question's answer must not reach a command's request, or the reverse.
       *
       * The two payloads are different types, and the server does not validate
       * which one it got -- it deserializes, fails quietly, and substitutes an
       * empty answer. So the pairing is checked HERE, where both the pending
       * request's kind and the answer's shape are in hand.
       */
      const answering = 'answers' in answer
      if (answering !== (pending.kind === 'question')) {
        options.emitUpdate?.({
          kind: 'relay-notice',
          runId: pending.runId,
          missionId: pending.missionId,
          message: answering
            ? 'Locust did not send that answer: it belongs to a question, and the runtime was waiting on an authorization.'
            : 'Locust did not send that decision: the runtime asked a question, which is answered rather than approved.'
        })
        // Refused rather than forwarded. Resolving with the wrong shape is
        // exactly what discarded the person's answer before.
        pending.resolve(protocolAnswerFor({ approvalId: answer.approvalId, decision: 'deny' }))
        return false
      }
      pending.resolve(protocolAnswerFor(answer))
      return true
    },

    release,

    get pendingCount() {
      return approvals.size
    }
  }
}
