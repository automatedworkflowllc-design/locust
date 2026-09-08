/**
 * What to say when Locust cannot write its own receipts.
 *
 * The durable local ledger is the product's central claim: every mission is
 * recorded, and the record can be checked afterwards. The one moment that
 * claim breaks was the one moment nothing was designed. The card that did
 * appear said, in the same breath:
 *
 *   "Mission held — receipts could not be written"
 *   "The run was stopped rather than continued without a durable record."
 *
 * Held and stopped are not the same thing, and the host does the second one:
 * `codex-mission.ts` aborts the process and clears the mission. Stopping is
 * the RIGHT behaviour -- a run that kept going would be doing work nobody
 * could later prove happened -- but calling it "held" is the app being loose
 * about the exact claim it exists to keep.
 *
 * So this file writes the honest version, and splits it the way the design
 * pass asks: what is SAFE, and what is AT RISK. The split is only worth
 * drawing because it is genuinely knowable. The ledger is append-only, so
 * everything already written is intact by construction; what is at risk is
 * only ever the part after the last successful write.
 *
 * Nothing here guesses at a checkpoint number. The design's mock says "paused
 * at ck_14"; the renderer does not have that number when a live write fails,
 * and a made-up one on the card whose whole subject is trustworthy records
 * would be the worst possible place to invent something.
 */

export interface LedgerFailureRow {
  readonly tone: 'safe' | 'risk'
  readonly label: string
  readonly text: string
}

/**
 * The rows the card draws.
 *
 * `checkpoints` is the count from a recovered mission when there is one, and
 * undefined during a live run -- in which case the safe row says what is true
 * without a number rather than dressing up a blank.
 */
export function ledgerFailureRows(checkpoints: number | undefined): readonly LedgerFailureRow[] {
  return [
    {
      tone: 'safe',
      label: 'Safe',
      text:
        checkpoints === undefined
          ? 'Everything written before the failure. The ledger only ever appends, so what reached the disk is intact and this mission can be reopened from it.'
          : `The ${String(checkpoints)} checkpoint${checkpoints === 1 ? '' : 's'} already written. The ledger only ever appends, so what reached the disk is intact and this mission can be reopened from it.`
    },
    {
      tone: 'risk',
      label: 'At risk',
      text: 'Anything the runtime did after the last successful write. It was not recorded, so Locust cannot tell you what it was — check the folder yourself before trusting this turn.'
    },
    {
      tone: 'risk',
      label: 'Not undone',
      text: 'Files the run already changed are still changed. Stopping the run stops new work; it does not roll back finished work.'
    }
  ]
}

/**
 * The sentence under the title.
 *
 * `reason` is the host's own message. It is quoted rather than replaced: the
 * host knows whether this was a full disk, a permission, or a locked file, and
 * this module does not.
 */
export function ledgerFailureSentence(reason: string | undefined): string {
  const said = reason?.trim()
  return said === undefined || said.length === 0
    ? 'Locust could not write this mission to its durable local ledger, so the run was stopped rather than continued without a record of it.'
    : `${said} The run was stopped rather than continued without a record of it.`
}
