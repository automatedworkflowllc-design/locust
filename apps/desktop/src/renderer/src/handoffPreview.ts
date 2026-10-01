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

/** The line under the box, or undefined when there is nothing to add to the note above it. */
export function handoffPreviewLine(preview: HandoffPreview | undefined): string | undefined {
  if (preview === undefined || preview.kind === 'same') return undefined
  if (preview.kind === 'refused') return `Not sent as it is: ${preview.message}`
  const carried = preview.kept.flatMap((name) => part(name, preview) ?? [])
  const left = preview.omitted.flatMap((name) => part(name, preview) ?? [])
  const parts = [`It carries ${list(carried)}.`]
  if (left.length > 0) parts.push(`Left out to fit: ${list(left)}.`)
  return parts.join(' ')
}
