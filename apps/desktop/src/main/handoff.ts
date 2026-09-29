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
/** One earlier turn of the conversation, oldest first (A2.11). */
export interface EarlierTurn {
  readonly asked: string
  readonly answered: string | undefined
}

/** How much of each earlier turn is quoted: enough to say what it was, not to re-read it. */
const ASKED_CHARS = 240
const ANSWERED_CHARS = 360

function clipped(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1).trimEnd()}\u2026`
}

function sectionsFor(
  originalPrompt: string,
  checkpoint: ReconciledCheckpoint,
  fromRuntime: string,
  next?: string,
  earlier: readonly EarlierTurn[] = []
): readonly { readonly name: string; readonly text: string }[] {
  /*
   * SAID AS IT HAPPENED (QA-2026-09-29 round 2, N4). A person who replied on
   * another runtime after a clean finish -- nothing in flight -- got "another
   * agent started and stopped partway through. The original task was:" over
   * the LATEST turn's words. A capable model reads past it; a small free one
   * may redo "the original task". A stop mid-work keeps the old words.
   */
  const clean = next !== undefined && next.trim().length > 0 && checkpoint.unsettledActions.length === 0
  const sections: { readonly name: string; readonly text: string }[] = [
    {
      name: 'task',
      text: clean
        ? `You are taking over this conversation from another agent (${fromRuntime}), which finished its last turn. The last thing it was asked was:\n\n${originalPrompt}`
        : `You are continuing work that another agent (${fromRuntime}) started and stopped partway through. The original task was:\n\n${originalPrompt}`
    }
  ]

  /*
   * A2.11 (reported #13): the turns BEFORE the one handed over. A switch
   * carried only the last turn, so a runtime taking over a long conversation
   * knew the latest ask and nothing of how the work got there. Each is what
   * was asked and the start of what came back -- enough to know what was
   * already settled with the person, not a transcript.
   */
  if (earlier.length > 0) {
    sections.push({
      name: 'earlier',
      text:
        'Earlier in this conversation, oldest first:\n'
        + bullets(earlier.map((turn) => `Asked: "${clipped(turn.asked, ASKED_CHARS)}"${turn.answered === undefined || turn.answered.trim().length === 0 ? ' -- no reply was recorded.' : ` -- answered: "${clipped(turn.answered, ANSWERED_CHARS)}"`}`))
    })
  }

  if (checkpoint.unsettledActions.length > 0) {
    sections.push({
      name: 'unsettled',
      text:
        'These actions STARTED and never reported back. Whether each took effect is unknown. '
        + 'Check the current state before you redo or build on any of them:\n'
        + bullets(checkpoint.unsettledActions.map((action) => `${action.toolKind}: ${action.name}`))
    })
  }

  /*
   * A2.11 (reported #13): named by what they did. This listed the item ids
   * -- `call_8f2c...`, a provider's handle -- which told the next runtime
   * nothing about the work. An action whose start the ledger did not keep is
   * counted, never shown as an id.
   */
  if (checkpoint.settledActions.length > 0) {
    const names = checkpoint.settledNames ?? []
    const unnamed = checkpoint.settledActions.length - names.length
    sections.push({
      name: 'settled',
      text:
        'These actions reported finishing before the stop:\n'
        + [
          ...(names.length === 0 ? [] : [bullets(names)]),
          ...(unnamed > 0 ? [`- ${String(unnamed)} ${names.length === 0 ? '' : 'other '}${unnamed === 1 ? 'action' : 'actions'} whose details were not recorded`] : [])
        ].join('\n')
    })
  }

  const summary = checkpoint.assistantSummary.trim()
  if (summary.length > 0) {
    sections.push({
      name: 'summary',
      text: `What the previous agent said it had done:\n\n${summary}`
    })
  }

  // The person's own next instruction, when the continuation is a reply
  // rather than a rescue. It goes LAST so it reads as the latest word, and
  // it is never dropped: a continuation that lost the instruction it was
  // started for would be a run pointed at the wrong task. `task` is kept for
  // the same reason, so this is the second never-dropped section, and the
  // budget accounts for both.
  if (next !== undefined && next.trim().length > 0) {
    sections.push({
      name: 'next',
      text: `The person now asks:\n\n${next.trim()}`
    })
  }

  return sections
}

export function composeHandoffPrompt(
  originalPrompt: string,
  checkpoint: ReconciledCheckpoint,
  fromRuntime: string,
  /**
   * The person's next instruction, for a continuation that is a reply on a
   * different runtime after the earlier run stopped (0.21.2 QA, P2: a
   * provider switch after a quota failure used to start a stranger with no
   * memory of the files or the task).
   */
  next?: string,
  /** The conversation's turns before the one handed over, oldest first (A2.11). */
  earlier: readonly EarlierTurn[] = []
): HandoffBriefing | undefined {
  const sections = [...sectionsFor(originalPrompt, checkpoint, fromRuntime, next, earlier)]
  // Reserve room for the omission notice UP FRONT whenever a section could be
  // dropped. Charging for it only at the first drop is too late: by then the
  // mandatory task section has already claimed the space, and it cannot be
  // shrunk to make room, so the assembled prompt overflows and the whole
  // handoff is refused. Under-using 120 characters when nothing is dropped is
  // the cheap side of that trade.
  const budget = MAX_HANDOFF_PROMPT_LENGTH - (sections.length > 1 ? NOTICE_BUDGET : 0)
  // The task and the person's next words are charged FIRST: they are never
  // optional, and a section added ahead of them in the reading order (the
  // earlier turns) must never be what squeezes them out. Then the optional
  // ones, most important first -- the earlier turns are the first to go.
  let mandatory = sections.filter((section) => section.name === 'task' || section.name === 'next')
  let used = mandatory.reduce((sum, section, index) => sum + section.text.length + (index === 0 ? 0 : 2), 0)
  /*
   * A LONG TASK IS CLIPPED, NOT REFUSED (QA-2026-09-29 round 2, R18). A task
   * and a reply that each fit the composer -- 3,900 and 3,900 -- were
   * refused together, exactly when the person was switching runtimes
   * because of a limit. The person's new words are kept whole; the ORIGINAL
   * task gives up its end, and the briefing says how much.
   */
  if (used > budget) {
    const task = mandatory.find((section) => section.name === 'task')
    const over = used - budget
    // Only beside the person's new words: a rescue with no reply has the task
    // as its only instruction, and half a task is a run on the wrong one.
    if (task === undefined || !mandatory.some((section) => section.name === 'next')) return undefined
    const clipNotice = (cut: number): string => `\n\n[The original task continues for ${String(cut)} more characters that did not fit here. Ask the person if the part above is not enough.]`
    const room = task.text.length - over - clipNotice(task.text.length).length
    if (room < 200) return undefined
    const clipped = { ...task, text: `${task.text.slice(0, room).trimEnd()}${clipNotice(task.text.length - room)}` }
    const index = sections.indexOf(task)
    sections.splice(index, 1, clipped)
    mandatory = mandatory.map((section) => (section === task ? clipped : section))
    used = mandatory.reduce((sum, section, at) => sum + section.text.length + (at === 0 ? 0 : 2), 0)
    if (used > budget) return undefined
  }
  const keptNames = new Set(mandatory.map((section) => section.name))
  const omitted: string[] = []
  for (const name of KEEP_ORDER) {
    const section = sections.find((entry) => entry.name === name)
    if (section === undefined) continue
    const cost = section.text.length + 2
    if (used + cost > budget) {
      omitted.push(name)
      continue
    }
    keptNames.add(name)
    used += cost
  }
  const kept = sections.filter((section) => keptNames.has(section.name)).map((section) => section.text)
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
export const OPTIONAL_SECTION_NAMES = ['unsettled', 'settled', 'summary', 'earlier'] as const
/** The optional sections in the order they are kept: the first one given up is the last here. */
const KEEP_ORDER = OPTIONAL_SECTION_NAMES

export function omissionNotice(omitted: readonly string[]): string {
  return `(Some handoff detail did not fit and was left out: ${omitted.join(', ')}.)`
}
