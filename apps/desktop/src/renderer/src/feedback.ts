import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { turnText } from './missionView.js'

/**
 * A conversation as plain text, for the Send feedback box (main/report-
 * problem.ts): what the person asked, what the teammate said, and how each
 * turn ended when it did not end well -- the part a report is usually about.
 * Words only: no file contents, no command output, no paths the teammate
 * read. The box says it will include "this conversation", and this is it.
 */
export function conversationText(
  turns: readonly { readonly prompt: string; readonly events: readonly NormalizedRuntimeEvent[] }[],
  speaker: string
): string {
  const gap = String.fromCharCode(10, 10)
  return turns
    .map((turn) => {
      const said = turnText(turn.events).trim()
      const lines = [`You: ${turn.prompt.trim()}`, `${speaker}: ${said.length > 0 ? said : '(nothing said)'}`]
      const ending = endingOf(turn.events)
      if (ending !== undefined) lines.push(`(${ending})`)
      return lines.join(gap)
    })
    .join(gap)
}

/** How a turn ended, when that is worth saying: failed or stopped, and why. */
function endingOf(events: readonly NormalizedRuntimeEvent[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === undefined) continue
    if (event.type === 'run.failed') {
      const why = typeof event.payload.message === 'string' ? event.payload.message.trim() : ''
      return why.length > 0 ? `the turn failed: ${why}` : 'the turn failed'
    }
    if (event.type === 'run.cancelled') return 'the turn was stopped'
    if (event.type === 'run.completed') return undefined
  }
  return undefined
}
