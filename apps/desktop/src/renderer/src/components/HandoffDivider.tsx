import type { ReactElement } from 'react'

import type { MissionRuntimeId } from '@teammate/runtime-adapters'

import { runtimeDisplayName } from '../../../shared/runtimes.js'
import { leftOutInWords } from '../handoffPreview.js'

const RUNTIME_LABEL: Readonly<Record<string, string>> = {
  codex: 'Codex',
  claude: 'Claude Code',
  omniroute: 'OmniRoute'
}

/**
 * The seam between two runtimes working the same problem.
 *
 * This is the one place the thread shows a boundary the durable record insists
 * on: a mission holds ONE runtime, so a switch is genuinely two missions with a
 * reconciliation between them. The divider is where that fact stops being an
 * implementation detail and becomes the honest answer to "who did what".
 *
 * It states the number of actions left in doubt rather than a reassuring
 * summary, because that is the number a person needs in order to decide how
 * much to trust what comes after the line.
 */
export function HandoffDivider({
  from,
  to,
  at,
  unsettledCount,
  omittedBriefing,
  leftOutByYou = []
}: {
  readonly from: MissionRuntimeId
  readonly to: MissionRuntimeId
  readonly at: string | undefined
  readonly unsettledCount: number
  readonly omittedBriefing: readonly string[]
  /** What the person chose to leave out of it (0.527): their choice, so said plainly, not as a warning. */
  readonly leftOutByYou?: readonly string[]
}): ReactElement {
  // Every runtime by its name. Only three were listed, so a switch to
  // OpenCode read "Codex -> opencode" (drive-runtime-switch, packaged 0.309).
  const fromLabel = RUNTIME_LABEL[from] ?? runtimeDisplayName(from) ?? from
  const toLabel = RUNTIME_LABEL[to] ?? runtimeDisplayName(to) ?? to

  return (
    <div className="lc-handoff" role="separator" aria-label={`Handed off from ${fromLabel} to ${toLabel}`}>
      <span className="lc-handoff__rule lc-handoff__rule--start" />
      <div className="lc-handoff__body">
        <span className="lc-handoff__title">
          <span className="lc-handoff__from">{fromLabel}</span>
          <span className="lc-handoff__arrow" aria-hidden="true">
            →
          </span>
          <span className="lc-handoff__to">{toLabel}</span>
          {at !== undefined && <span className="lc-handoff__time">· {at}</span>}
        </span>
        <span className="lc-handoff__note">
          {unsettledCount === 0
            ? `Nothing was in flight, so ${toLabel} picked up from a clean stop.`
            : `${unsettledCount} action${unsettledCount === 1 ? '' : 's'} had started and never reported back. ${toLabel} was told to check ${unsettledCount === 1 ? 'it' : 'them'} before building on ${unsettledCount === 1 ? 'it' : 'them'}.`}
        </span>
        {omittedBriefing.length > 0 && (
          /*
            Said out loud rather than hidden: the next runtime is working from
            less than the whole story, and only the person can tell whether the
            missing part mattered.
          */
          <span className="lc-handoff__note lc-tone-amber">
            {`Left out of the summary to fit: ${leftOutInWords(omittedBriefing)}.`}
          </span>
        )}
        {leftOutByYou.length > 0 && (
          <span className="lc-handoff__note">{`You left out ${leftOutInWords(leftOutByYou)}.`}</span>
        )}
      </div>
      <span className="lc-handoff__rule lc-handoff__rule--end" />
    </div>
  )
}
