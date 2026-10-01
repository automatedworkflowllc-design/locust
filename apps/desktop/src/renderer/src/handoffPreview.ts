import type { HandoffPreview } from '../../shared/ipc.js'

/**
 * WHAT A REPLY ON ANOTHER RUNTIME CARRIES, in words, before it is sent (0.517).
 *
 * Product ideas, round four: the brief a new runtime starts from is made of
 * sections and drops whole ones to fit, and nobody saw that until after the
 * switch -- if then. The composer now says it under the box while the reply
 * is being written, from the host's own composition (HANDOFF_PREVIEW_CHANNEL),
 * in the person's words rather than the section names.
 */
const PART: Readonly<Record<string, string>> = {
  earlier: 'the earlier messages',
  settled: 'the steps it finished',
  summary: 'its last reply'
}

function part(name: string, preview: Extract<HandoffPreview, { readonly kind: 'switch' }>): string | undefined {
  if (name === 'task') return preview.taskClipped ? 'the start of the task' : preview.taskByFile ? 'the task, as a file' : 'the task'
  if (name === 'unsettled') {
    const count = preview.unsettledCount
    return count === 0 ? undefined : `${String(count)} ${count === 1 ? 'step' : 'steps'} that never reported back`
  }
  return PART[name]
}

function list(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) ?? ''}`
}

/**
 * What a brief left out, in the same words (0.519): for the divider after a
 * switch, which named the sections ("summary, earlier") instead.
 */
export function leftOutInWords(names: readonly string[]): string {
  const words = names.map((name) => (name === 'unsettled' ? 'the steps that never reported back' : name === 'task' ? 'part of the task' : PART[name] ?? name))
  return list(words)
}

/** The sections a person may leave out (0.527); mirrors main/handoff.ts DROPPABLE_SECTION_NAMES. */
const DROPPABLE: ReadonlySet<string> = new Set(['earlier', 'settled', 'summary'])

/** One section of the brief, in the person's words, and whether they may leave it out. */
export interface BriefPart {
  readonly name: string
  readonly words: string
  readonly droppable: boolean
}

/**
 * THE BRIEF AS PARTS (0.527, "with a way to drop a section"): what it carries,
 * each with whether it may be left out, what did not fit, and what the person
 * chose to leave out -- so the composer can put a control on each.
 */
export type HandoffPreviewParts =
  | { readonly kind: 'refused'; readonly line: string }
  | { readonly kind: 'parts'; readonly carried: readonly BriefPart[]; readonly leftToFit: readonly string[]; readonly leftByYou: readonly BriefPart[] }

export function handoffPreviewParts(preview: HandoffPreview | undefined): HandoffPreviewParts | undefined {
  if (preview === undefined || preview.kind === 'same') return undefined
  if (preview.kind === 'refused') return { kind: 'refused', line: `Not sent as it is: ${preview.message}` }
  const named = (name: string): BriefPart | undefined => {
    const words = part(name, preview)
    return words === undefined ? undefined : { name, words, droppable: DROPPABLE.has(name) }
  }
  return {
    kind: 'parts',
    carried: preview.kept.flatMap((name) => named(name) ?? []),
    leftToFit: preview.omitted.flatMap((name) => part(name, preview) ?? []),
    // An older host sends no list: nothing was chosen.
    leftByYou: (preview.leftOutByYou ?? []).flatMap((name) => named(name) ?? [])
  }
}

/** The line under the box, or undefined when there is nothing to add to the note above it. */
export function handoffPreviewLine(preview: HandoffPreview | undefined): string | undefined {
  const parts = handoffPreviewParts(preview)
  if (parts === undefined) return undefined
  if (parts.kind === 'refused') return parts.line
  const said = [`It carries ${list(parts.carried.map((entry) => entry.words))}.`]
  if (parts.leftToFit.length > 0) said.push(`Left out to fit: ${list(parts.leftToFit)}.`)
  if (parts.leftByYou.length > 0) said.push(`You left out ${list(parts.leftByYou.map((entry) => entry.words))}.`)
  return said.join(' ')
}

/** The list joined as the line joins it, for a part rendered on its own. */
export function joinerBefore(index: number, count: number): string {
  if (index === 0) return ''
  return index === count - 1 ? ' and ' : ', '
}
