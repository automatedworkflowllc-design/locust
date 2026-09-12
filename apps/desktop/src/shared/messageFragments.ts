import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

/**
 * A reply is ONE thing that happened, not the thousand pieces it arrived in.
 *
 * Every runtime streams prose as `message.delta` events carrying a few
 * characters each, which the thread concatenates by `itemId`. Both places
 * that hold a mission's events also BOUND them -- the renderer keeps the last
 * 500 while a run is live, the history projection keeps the first and the
 * last 499 on reload -- and both were counting fragments as if each were a
 * separate happening. Keeping the newest 500 of 1251 fragments keeps the END
 * of the reply.
 *
 * MEASURED 2026-09-11 on Colin's own ledger (mission 645f02a4, Cursor): 4853
 * characters on disk, 1954 on screen. The reply began `195-205B** (from
 * $180-190B)` -- an unopened bold, a sentence with no front, and nothing to
 * say anything was missing. He watched it happen live in a room the same
 * evening: "im currently watching it eat text from the beginning".
 *
 * So a fragment is folded into the message it belongs to as it arrives, and
 * what the caps then bound is messages and tool calls -- things that really
 * did happen separately. A reply of any length is one event either way, which
 * is both the truthful count and what makes those caps safe.
 */

/**
 * The running form, for a live run: fold an arriving fragment into the
 * message it continues, or add it if it starts one.
 *
 * It merges with the last fragment of the SAME message wherever that sits,
 * not only when it is last in the array -- a tool call between two fragments
 * would otherwise start a second event for one message, and enough of those
 * is the same cap problem again.
 */
export function withMessageDelta(
  events: readonly NormalizedRuntimeEvent[],
  arriving: NormalizedRuntimeEvent
): readonly NormalizedRuntimeEvent[] {
  if (arriving.type !== 'message.delta') return [...events, arriving]
  const { itemId, operation, text, final } = arriving.payload
  let at = -1
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const held = events[index]
    if (held?.type === 'message.delta' && held.payload.itemId === itemId) {
      at = index
      break
    }
  }
  if (at < 0) return [...events, arriving]
  const held = events[at]
  if (held?.type !== 'message.delta') return [...events, arriving]
  const next = [...events]
  next[at] = {
    ...held,
    payload: {
      ...held.payload,
      operation: 'replace',
      text: operation === 'replace' ? text : `${held.payload.text}${text}`,
      final
    }
  }
  return next
}

/**
 * The whole-record form, for a mission read back from the ledger.
 *
 * The joined event keeps the FIRST fragment's identity -- id, sequence,
 * occurredAt -- so the array stays ordered by time and keys stay stable
 * across a reload. It takes `final` from the LAST fragment, because whether
 * the message ended is the last fragment's news.
 *
 * A message that arrived whole is not rewritten, down to its `append`: only
 * one that was actually split is rebuilt, so the ledger's own record passes
 * through wherever joining is not needed.
 */
export function joinMessageFragments(
  events: readonly NormalizedRuntimeEvent[]
): readonly NormalizedRuntimeEvent[] {
  const joined = new Map<string, { text: string; final: boolean; pieces: number }>()
  for (const event of events) {
    if (event.type !== 'message.delta') continue
    const { itemId, operation, text, final } = event.payload
    const held = joined.get(itemId)
    joined.set(itemId, {
      text: operation === 'replace' ? text : `${held?.text ?? ''}${text}`,
      final,
      pieces: (held?.pieces ?? 0) + 1
    })
  }
  if (![...joined.values()].some((message) => message.pieces > 1)) return events

  const emitted = new Set<string>()
  const dense: NormalizedRuntimeEvent[] = []
  for (const event of events) {
    if (event.type !== 'message.delta') {
      dense.push(event)
      continue
    }
    const { itemId } = event.payload
    if (emitted.has(itemId)) continue
    emitted.add(itemId)
    const whole = joined.get(itemId)
    if (whole === undefined || whole.pieces === 1) {
      dense.push(event)
      continue
    }
    dense.push({
      ...event,
      payload: { ...event.payload, operation: 'replace', text: whole.text, final: whole.final }
    })
  }
  return dense
}
