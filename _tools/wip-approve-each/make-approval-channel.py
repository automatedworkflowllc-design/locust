import io, os, sys
root = sys.argv[1]
src = os.path.join(root, 'apps/desktop/src/main/app-server-mission.ts')
lines = io.open(src, encoding='utf-8').read().split('\n')

# The helper block, verbatim with its comments: from the constants above
# `approvalKindFor` to the line before `createAppServerMissionService`'s doc.
start = next(i for i, l in enumerate(lines) if l.startswith('const MAX_APPROVAL_DETAIL'))
while start > 0 and (lines[start - 1].startswith(' *') or lines[start - 1].startswith('/*') or lines[start - 1].startswith('//')):
    start -= 1
end = next(i for i, l in enumerate(lines) if l.startswith('export function createAppServerMissionService'))
while end > 0 and (lines[end - 1].startswith(' *') or lines[end - 1].startswith('/*') or lines[end - 1].startswith('//') or lines[end - 1].strip() == ''):
    end -= 1
helpers = '\n'.join(lines[start:end]).rstrip() + '\n'
assert 'export function approvalKindFor' in helpers
assert 'export function withFileChanges' in helpers
assert 'export function questionsOf' in helpers
assert 'createAppServerMissionService' not in helpers

header = '''import { randomUUID } from 'node:crypto'

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

'''

factory = '''
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
'''

out = os.path.join(root, 'apps/desktop/src/main/approval-channel.ts')
io.open(out, 'w', encoding='utf-8', newline='').write(header + helpers + factory)

# PeerRecordError moves to the module whose records it is about.
pe = os.path.join(root, 'apps/desktop/src/main/peer-exchange.ts')
s = io.open(pe, encoding='utf-8').read()
assert 'PeerRecordError' not in s
s = s.rstrip('\n') + '''

/**
 * A mission that could not record the messages it was shown. Raised before
 * anything runs on them: a mission must not run on messages its own record
 * cannot name.
 */
export class PeerRecordError extends Error {}
'''
io.open(pe, 'w', encoding='utf-8', newline='').write(s)
print('approval-channel.ts written; PeerRecordError moved to peer-exchange')
