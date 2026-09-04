import type { PublicMissionCheckpoint, PublicRecoveredMission } from '../../shared/ipc.js'

/**
 * Whether an interrupted mission can be picked up, and what to say about it.
 *
 * The ledger has written checkpoints since the beginning and the receipt has
 * reported them; what has never existed is the affordance. An interrupted
 * mission is currently a dead record you can read, which is the worst of both
 * worlds -- the app kept everything needed to continue and then offered no way
 * to.
 *
 * The whole decision is which of three things is true, and the product's rule
 * is that the two failures must NOT be collapsed. `unsafe` says the ledger
 * cannot be trusted to describe what happened; `approval-required` says the
 * ledger is trustworthy and reports an action whose outcome is unknowable from
 * here. Offering a cheerful "Resume" on the first would be the app claiming to
 * continue from a record it has already said is incomplete.
 */

export type ResumeOffer =
  | {
      readonly kind: 'resume'
      /** The checkpoint a new run would continue from. */
      readonly epoch: number
      /** When the mission stopped, ISO. */
      readonly at: string
      readonly note: string
    }
  | {
      readonly kind: 'resume-with-doubt'
      readonly epoch: number
      readonly at: string
      readonly note: string
      /** Named so a person can look for them before saying go. */
      readonly unverified: readonly string[]
    }
  | {
      readonly kind: 'refused'
      readonly note: string
    }

/**
 * The checkpoint a resume would start from: the newest one written. Earlier
 * epochs describe states the mission has already moved past, and continuing
 * from one would redo work the ledger says was finished.
 */
export function resumePoint(
  checkpoints: readonly PublicMissionCheckpoint[]
): PublicMissionCheckpoint | undefined {
  let newest: PublicMissionCheckpoint | undefined
  for (const checkpoint of checkpoints) {
    if (newest === undefined || checkpoint.epoch > newest.epoch) newest = checkpoint
  }
  return newest
}

/**
 * What to offer for a mission, if anything.
 *
 * The phase alone is not enough, and finding that out took running it. Two
 * things a person would both call "it got interrupted" land in DIFFERENT
 * phases, and neither is the one the design's wording suggests:
 *
 *   closing the app mid-run   the host cancels the run on the way out, so the
 *                             mission is recorded `cancelled` -- and a
 *                             `shutdown` checkpoint IS written.
 *   the process dying         nothing runs on the way out, so the mission has
 *                             no terminal record and reads `interrupted` --
 *                             with no checkpoint at all.
 *
 * So keying on `interrupted` alone produced a feature that could essentially
 * never fire: the phase that qualified never had a checkpoint, and the phase
 * that had one never qualified.
 *
 * The checkpoint's own reason is what separates them honestly. `shutdown`
 * means the app closed underneath the work, which is the case the design
 * names. A person who pressed Stop leaves a `manual` checkpoint or none, and
 * offering to undo THAT would be the app arguing with a decision they made on
 * purpose. Completed has nothing to resume, and a failed run needs its failure
 * understood rather than papered over. Each of those still has the composer.
 */
export function resumeOffer(mission: {
  readonly phase: PublicRecoveredMission['phase']
  readonly checkpoints: readonly PublicMissionCheckpoint[]
  readonly integrityIssueCount: number
}): ResumeOffer | undefined {
  const point = resumePoint(mission.checkpoints)
  const stoppedByShutdown = mission.phase === 'cancelled' && point?.reason === 'shutdown'
  if (mission.phase !== 'interrupted' && !stoppedByShutdown) return undefined

  if (point === undefined) {
    // Nothing was written before the stop, so there is no state to continue
    // from. Said out loud rather than shown as an absent button, because a
    // missing control is indistinguishable from a broken one.
    return {
      kind: 'refused',
      note: 'This mission stopped before any checkpoint was written, so there is no recorded point to continue from.'
    }
  }

  // Recovery reporting an issue outranks whatever the checkpoint concluded:
  // the checkpoint is itself read from the file that could not be read whole.
  if (point.resumeSafety === 'unsafe' || mission.integrityIssueCount > 0) {
    return {
      kind: 'refused',
      note: `${point.safetyReason} Continuing from a record the app cannot vouch for would build on work it cannot describe.`
    }
  }

  if (point.resumeSafety === 'approval-required') {
    return {
      kind: 'resume-with-doubt',
      epoch: point.epoch,
      at: point.createdAt,
      note: point.safetyReason,
      unverified: point.unsettledActions.map((action) => action.name)
    }
  }

  return { kind: 'resume', epoch: point.epoch, at: point.createdAt, note: point.safetyReason }
}
