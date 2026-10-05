import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { openingEventCount } from './event-window.js'

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
  return withMessageDeltas(events, [arriving])
}

/** A durable batch copies the held array once, preserving fragment semantics. */
export function withMessageDeltas(
  events: readonly NormalizedRuntimeEvent[],
  arrivals: readonly NormalizedRuntimeEvent[],
  cap = Number.POSITIVE_INFINITY,
  onTrim?: () => void
): readonly NormalizedRuntimeEvent[] {
  const next = [...events]
  const append = (event: NormalizedRuntimeEvent): void => {
    next.push(event)
    // Match the live cap after EACH arrival, preserving the opening.
    // A message evicted mid-batch may speak again later in the same batch.
    if (next.length > cap) {
      next.splice(openingEventCount(cap), next.length - cap)
      onTrim?.()
    }
  }
  for (const arriving of arrivals) {
    if (arriving.type !== 'message.delta') {
      append(arriving)
      continue
    }
    const { itemId, operation, text, final } = arriving.payload
    let at = -1
    for (let index = next.length - 1; index >= 0; index -= 1) {
      const held = next[index]
      if (held?.type === 'message.delta' && held.payload.itemId === itemId) {
        at = index
        break
      }
    }
    if (at < 0) {
      append(arriving)
      continue
    }
    const held = next[at]!
    if (held.type !== 'message.delta') continue
    next[at] = {
      ...held,
      payload: {
        ...held.payload,
        operation: 'replace',
        text: operation === 'replace' ? text : `${held.payload.text}${text}`,
        final
      }
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
  interface Built {
    readonly key: string
    readonly at: number
    text: string
    final: boolean
    pieces: number
  }
  const open = new Map<string, Built>()
  const built: Built[] = []
  let changed = false

  events.forEach((event, index) => {
    if (event.type !== 'message.delta') return
    const { itemId, operation, text, final } = event.payload
    const held = open.get(itemId)
    if (held === undefined) {
      const fresh: Built = { key: itemId, at: index, text, final, pieces: 1 }
      open.set(itemId, fresh)
      built.push(fresh)
      return
    }
    if (operation === 'replace') {
      held.text = text
      held.final = final
      held.pieces += 1
      changed = true
      return
    }
    /*
     * THE REPAIR, for records already on disk.
     *
     * A Cursor version that marked nothing had its closing message -- the one
     * carrying the WHOLE text -- appended like any other fragment, so the
     * reply said itself twice and the next reply was welded onto its end. The
     * adapter recognises that message by content now (`cursor-events.ts`),
     * but every conversation recorded before that fix still holds the doubled
     * form, and a ledger is append-only: what is written is written.
     *
     * The reader can apply the same understanding. A fragment that restates
     * exactly what its message has said so far is that message ENDING, not
     * twice as much of it -- so it closes here, and what follows starts a new
     * one. MEASURED on Colin's mission `fd0adba1`, which rendered as one
     * 2872-character block beginning "...for his take.Looking up NVIDIA
     * forward earnings now, then I'll hand the numbers to Yurt for his take.":
     * it recovers as the 88-character preamble and the 2696-character answer
     * that had been welded to it.
     *
     * Same two guards as the adapter, and the second was earned by a test: a
     * long message can arrive as two IDENTICAL halves, so a restatement must
     * cover SEVERAL fragments, not one.
     */
    if (text.length > 1 && held.pieces > 1 && text === held.text) {
      held.final = true
      open.delete(itemId)
      changed = true
      return
    }
    held.text = `${held.text}${text}`
    held.final = final
    held.pieces += 1
    changed = true
  })

  // Nothing was split and nothing was joined, so nothing is rewritten and
  // nothing is copied: a mission whose messages each arrived whole keeps the
  // record the ledger holds, down to its `append`.
  if (!changed) return events

  // A message that was closed by a restatement leaves the next one sharing its
  // itemId. Numbered rather than renamed, so the first keeps the id every
  // other surface already knows and the keys stay stable across a reload.
  const seen = new Map<string, number>()
  const keyed = built.map((message) => {
    const n = (seen.get(message.key) ?? 0) + 1
    seen.set(message.key, n)
    return { message, id: n === 1 ? message.key : `${message.key}#${String(n)}` }
  })

  const byIndex = new Map(keyed.map((entry) => [entry.message.at, entry]))
  const dense: NormalizedRuntimeEvent[] = []
  for (const [index, event] of events.entries()) {
    if (event.type !== 'message.delta') {
      dense.push(event)
      continue
    }
    const entry = byIndex.get(index)
    if (entry === undefined) continue
    if (entry.message.pieces === 1 && entry.id === entry.message.key) {
      dense.push(event)
      continue
    }
    dense.push({
      ...event,
      payload: {
        ...event.payload,
        itemId: entry.id,
        operation: 'replace',
        text: entry.message.text,
        final: entry.message.final
      }
    })
  }
  return dense
}
