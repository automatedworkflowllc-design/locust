import type { ReconciledCheckpoint } from '@teammate/mission-store'

/**
 * The briefing a handed-off mission starts with.
 *
 * A route switch starts a NEW run on a different runtime, and that runtime has
 * no memory of the one before it. Everything it will ever know about the work
 * already done has to be in this string, which makes the composition rules here
 * load-bearing rather than cosmetic.
 *
 * Two rules drive the shape:
 *
 * 1. The unsettled actions are the point. An action that started and never
 *    reported back may or may not have taken effect, and a runtime that assumes
 *    either way can corrupt the workspace -- redoing a completed write, or
 *    building on a write that never landed. The brief tells it to VERIFY.
 *
 * 2. Sections are dropped whole, never truncated mid-sentence, and the brief
 *    says which were dropped. A half-sentence about a half-finished action is
 *    worse than an honest gap, because it reads as complete.
 */

/** Composed prompts must satisfy the same bound the composer enforces. */
export const MAX_HANDOFF_PROMPT_LENGTH = 8_000

export interface HandoffBriefing {
  readonly prompt: string
  /** Section names left out to fit the bound, in the order they were dropped. */
  readonly omitted: readonly string[]
}

function bullets(lines: readonly string[]): string {
  return lines.map((line) => `- ${line}`).join('\n')
}

/**
 * Sections in priority order. The first is never dropped: without the original
 * task the new run has nothing to do, so if it alone will not fit, the handoff
 * is refused upstream rather than started with an empty instruction.
 */
function sectionsFor(
  originalPrompt: string,
  checkpoint: ReconciledCheckpoint,
  fromRuntime: string
): readonly { readonly name: string; readonly text: string }[] {
  const sections: { readonly name: string; readonly text: string }[] = [
    {
      name: 'task',
      text: `You are continuing work that another agent (${fromRuntime}) started and stopped partway through. The original task was:\n\n${originalPrompt}`
    }
  ]

  if (checkpoint.unsettledActions.length > 0) {
    sections.push({
      name: 'unsettled',
      text:
        'These actions STARTED and never reported back. Whether each took effect is unknown. '
        + 'Check the current state before you redo or build on any of them:\n'
        + bullets(checkpoint.unsettledActions.map((action) => `${action.toolKind}: ${action.name}`))
    })
  }

  if (checkpoint.settledActions.length > 0) {
    sections.push({
      name: 'settled',
      text:
        'These actions reported finishing before the stop:\n'
        + bullets(checkpoint.settledActions)
    })
  }

  const summary = checkpoint.assistantSummary.trim()
  if (summary.length > 0) {
    sections.push({
      name: 'summary',
      text: `What the previous agent said it had done:\n\n${summary}`
    })
  }

  return sections
}

export function composeHandoffPrompt(
  originalPrompt: string,
  checkpoint: ReconciledCheckpoint,
  fromRuntime: string
): HandoffBriefing | undefined {
  const sections = sectionsFor(originalPrompt, checkpoint, fromRuntime)
  // Reserve room for the omission notice UP FRONT whenever a section could be
  // dropped. Charging for it only at the first drop is too late: by then the
  // mandatory task section has already claimed the space, and it cannot be
  // shrunk to make room, so the assembled prompt overflows and the whole
  // handoff is refused. Under-using 120 characters when nothing is dropped is
  // the cheap side of that trade.
  const budget = MAX_HANDOFF_PROMPT_LENGTH - (sections.length > 1 ? NOTICE_BUDGET : 0)
  const kept: string[] = []
  const omitted: string[] = []
  let used = 0

  for (const section of sections) {
    // +2 for the blank line that will join this section to the previous one.
    const cost = section.text.length + (kept.length === 0 ? 0 : 2)
    if (used + cost > budget) {
      omitted.push(section.name)
      continue
    }
    kept.push(section.text)
    used += cost
  }

  // The task section is first and is never optional. If it alone overflows, the
  // caller gets nothing rather than a run pointed at a truncated instruction.
  if (!omitted.every((name) => name !== 'task')) return undefined
  if (kept.length === 0) return undefined

  const body = omitted.length === 0
    ? kept.join('\n\n')
    : `${kept.join('\n\n')}\n\n${omissionNotice(omitted)}`

  // No length check on the assembled string, and that is deliberate: it cannot
  // overflow. Every kept section was charged against `budget`, which already
  // holds back NOTICE_BUDGET whenever a notice is possible, and the notice is
  // shorter than that reserve. A runtime guard here would be unreachable --
  // dead code that no test could ever turn red.
  //
  // What keeps the proof true as sections are added is a TEST, not a branch:
  // `omissionNotice(OPTIONAL_SECTION_NAMES)` must fit inside NOTICE_BUDGET, so
  // a fifth section that outgrows the reserve fails the suite instead of
  // silently refusing a handoff at runtime.

  return { prompt: body, omitted }
}

/**
 * Reserved room for the notice. Measured against the longest it can be -- every
 * optional section named -- so budgeting can never overshoot the bound. The
 * two characters a notice costs for its joining blank line are inside it too.
 */
export const NOTICE_BUDGET = 120

/** Every section that may be dropped. Exported so a test can price the worst case. */
export const OPTIONAL_SECTION_NAMES = ['unsettled', 'settled', 'summary'] as const

export function omissionNotice(omitted: readonly string[]): string {
  return `(Some handoff detail did not fit and was left out: ${omitted.join(', ')}.)`
}
