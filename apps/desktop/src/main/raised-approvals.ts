import type { MissionApprovalRequest } from '../shared/ipc.js'

/**
 * The cards the host has raised and not yet seen answered (0.599).
 *
 * The record of a conversation is written from this map when an answer
 * arrives (`recordAnswer` reads the card's words from it), and "don't ask
 * again" on a card looks the card up here. It used to keep the last 64 cards
 * RAISED, answered or not, so past 64 open cards the oldest unanswered one was
 * forgotten: its answer, when it came, went unrecorded, and a rule from it
 * said the card was no longer waiting (review 10/04, S4). An answered card now
 * leaves the moment its answer is recorded, so the cap counts only cards still
 * waiting, and the one that goes past the cap is the oldest of those.
 */
export interface RaisedApproval {
  readonly request: MissionApprovalRequest
  readonly teammateId?: string
}

export const MAX_RAISED_APPROVALS = 64

export interface RaisedApprovals {
  remember(request: MissionApprovalRequest, teammateId?: string): void
  get(approvalId: string): RaisedApproval | undefined
  /** Its answer is recorded: the card is no longer waiting. */
  forget(approvalId: string): void
  readonly size: number
}

export function createRaisedApprovals(keep: number = MAX_RAISED_APPROVALS): RaisedApprovals {
  const raised = new Map<string, RaisedApproval>()
  return {
    remember(request, teammateId) {
      raised.delete(request.approvalId)
      raised.set(request.approvalId, { request, ...(teammateId === undefined ? {} : { teammateId }) })
      // Every entry is a card still waiting; past the cap the oldest waiting one goes.
      while (raised.size > keep) raised.delete(raised.keys().next().value as string)
    },
    get(approvalId) {
      return raised.get(approvalId)
    },
    forget(approvalId) {
      raised.delete(approvalId)
    },
    get size() {
      return raised.size
    }
  }
}
