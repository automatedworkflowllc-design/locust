import type { MissionApproval, MissionLedger, RecoveredMission } from '@teammate/mission-store'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

/**
 * A CARD'S ANSWER THE LEDGER REFUSED IS TRIED AGAIN, THEN SAID (0.587).
 *
 * Since 0.576 every card answered is appended to the mission as its own
 * record, un-awaited so the run is never held. The write's failure was
 * swallowed, so the saved record's closing claim -- "every card answered on
 * this turn, with who answered it" -- could read complete when the host knew
 * it was not (QA's Q2).
 *
 * The answer cannot be noted in the record while the run is live: a run's
 * events arrive numbered by its adapter, and the ledger refuses any event out
 * of sequence -- a host note slipped in mid-run would take the number the
 * adapter's next event carries, and THAT event would be refused. So a refused
 * answer waits for the run to end (`createUnwrittenAnswers`, a run-end step):
 * the write is tried once more, since a disk that was busy is often free by
 * then; still refused, a note goes after the run's last event, where the
 * export prints it under "How it ended" and counts it in the Recorded line.
 *
 * One exception: a turn written before the ledger held cards (schema < 20)
 * refuses the write by design, and the export already says such a turn
 * cannot show cards; nothing is remembered.
 */
export const CANNOT_HOLD_CARDS = /cannot hold approvals/i

export const APPROVAL_NOT_RECORDED = 'host.approval-not-recorded'

export function approvalNotRecordedNote(input: {
  readonly mission: Pick<RecoveredMission, 'events' | 'metadata'>
  readonly runId: string
  readonly missionId: string
  /** The card's kind and the answer given, named in the note. */
  readonly kind: string
  readonly answer: string
  /** The ledger's own words for the failure. */
  readonly why: string
  readonly now?: () => Date
}): NormalizedRuntimeEvent | undefined {
  if (CANNOT_HOLD_CARDS.test(input.why)) return undefined
  // The ledger requires contiguous sequences: one past the mission's last.
  const sequence = (input.mission.events.at(-1)?.sequence ?? 0) + 1
  const firstLine = input.why.split(/\r?\n/)[0]?.trim() ?? ''
  return {
    id: `${input.runId}:approval-not-recorded:${String(sequence)}`,
    runId: input.runId,
    missionId: input.missionId,
    sequence,
    type: 'adapter.diagnostic',
    occurredAt: (input.now ?? (() => new Date()))().toISOString(),
    sourceAdapter: input.mission.metadata.runtime,
    payload: {
      level: 'warning',
      code: APPROVAL_NOT_RECORDED,
      message: `The answer to a card (${input.kind}, ${input.answer}) could not be written to this record: ${firstLine.length > 0 ? firstLine : 'the ledger refused the write'}`,
      terminal: false,
      evidence: { redacted: true }
    }
  } as NormalizedRuntimeEvent
}

export interface UnwrittenAnswers {
  /** The ledger refused this answer's record; it is tried again when the run ends. */
  remember(missionId: string, approval: MissionApproval, why: string): void
  /** A run-end step: writes what was remembered, or says in the record that it could not. */
  onRunEnded(mission: { readonly missionId: string }): Promise<void>
  /** How many answers wait for this mission's end. */
  pending(missionId: string): number
}

/** Bounds, so a ledger that refuses everything cannot grow the host's memory without end. */
const MAX_PER_MISSION = 50
const MAX_MISSIONS = 200
/** The ledger's word when another writer took the sequence read a moment ago. */
const SEQUENCE_TAKEN = /sequence is invalid/i
const TAIL_ATTEMPTS = 3

export function createUnwrittenAnswers(options: {
  readonly ledger: Pick<MissionLedger, 'appendApproval' | 'appendEvents' | 'getMission'>
  readonly now?: () => Date
}): UnwrittenAnswers {
  const waiting = new Map<string, { readonly approval: MissionApproval; readonly why: string }[]>()
  return {
    remember(missionId, approval, why) {
      if (CANNOT_HOLD_CARDS.test(why)) return
      const list = waiting.get(missionId) ?? []
      if (list.length >= MAX_PER_MISSION) return
      list.push({ approval, why })
      waiting.set(missionId, list)
      while (waiting.size > MAX_MISSIONS) {
        const oldest = waiting.keys().next().value
        if (oldest === undefined) break
        waiting.delete(oldest)
      }
    },
    pending: (missionId) => waiting.get(missionId)?.length ?? 0,
    async onRunEnded(mission) {
      const list = waiting.get(mission.missionId)
      if (list === undefined) return
      waiting.delete(mission.missionId)
      let lastError: unknown
      for (const { approval, why } of list) {
        let stillWhy = why
        try {
          await options.ledger.appendApproval(mission.missionId, approval)
          continue
        } catch (error) {
          stillWhy = error instanceof Error ? error.message : String(error)
        }
        // Still refused: say so in the record, after the run's last event. Another
        // run-end writer may take the tail between the read and the write; the
        // ledger refuses before writing anything, so the tail is read again.
        for (let attempt = 1; attempt <= TAIL_ATTEMPTS; attempt += 1) {
          const held = await options.ledger.getMission(mission.missionId)
          if (held === undefined) break
          const note = approvalNotRecordedNote({
            mission: held, runId: held.metadata.runId, missionId: mission.missionId,
            kind: approval.kind, answer: approval.answer, why: stillWhy, ...(options.now === undefined ? {} : { now: options.now })
          })
          if (note === undefined) break
          try {
            await options.ledger.appendEvents(mission.missionId, [note])
            lastError = undefined
            break
          } catch (error) {
            lastError = error
            if (!SEQUENCE_TAKEN.test(error instanceof Error ? error.message : String(error))) break
          }
        }
      }
      // Noted in the run-end log by the caller; nothing else can be done for it.
      if (lastError !== undefined) throw lastError
    }
  }
}
