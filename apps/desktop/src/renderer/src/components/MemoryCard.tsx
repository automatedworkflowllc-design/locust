import type { ReactElement } from 'react'
import { useState } from 'react'

import { Icon } from './Icon.js'

/**
 * What a conversation taught the team, folded the way tool activity is:
 * one quiet line ("Wren remembered 2 things"), the lines under it on a
 * click. Colin, 2026-09-05, on seeing them drawn as warning diagnostics:
 * "maybe change to a dropdown for memory like a tool call? or how claude
 * does it?" -- Claude Code prints "Saved 2 memories"; this is that, with
 * the memories one click away.
 *
 * Read from the memory list itself (each memory names the conversation it
 * came from), so the card is there whenever the thread is, not only while
 * a notice is in flight.
 */
export interface MemoryCardLine {
  readonly by: string
  readonly text: string
  readonly status: 'kept' | 'proposed'
  /** It replaced an earlier memory under the same name, rather than adding one. */
  readonly updated?: boolean
  /** The turn it was learned on: the card is drawn under that turn. */
  readonly missionId: string
  /** A proposal to change, forget or merge kept memories, not a new one (0.315, A1.2). */
  readonly change?: 'rewrite' | 'forget' | 'merge'
}

export function memoryCardSummary(lines: readonly MemoryCardLine[]): string {
  const kept = lines.filter((line) => line.status === 'kept' && line.updated !== true)
  const proposed = lines.filter((line) => line.status === 'proposed')
  // Said by kind: "wants to remember" would misname a proposal to change or
  // to forget something the person already had (0.315).
  const proposedNew = proposed.filter((line) => line.change === undefined)
  const proposedChanges = proposed.filter((line) => line.change === 'rewrite')
  const proposedForgets = proposed.filter((line) => line.change === 'forget')
  const proposedMerges = proposed.filter((line) => line.change === 'merge')
  const rewritten = lines.filter((line) => line.updated === true && line.status === 'kept')
  // Everyone whose lines these are, not the first line's writer for all of
  // them (A1.6, reported #21).
  const names = [...new Set(lines.map((line) => line.by))]
  const by = names.length === 0 ? 'A teammate' : names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]!}`
  const things = (n: number): string => `${String(n)} thing${n === 1 ? '' : 's'}`
  const parts: string[] = []
  if (kept.length > 0) parts.push(`remembered ${things(kept.length)}`)
  // "Updated", not "remembered": this one replaced something the person may
  // already have read. Said in the person's words rather than the store's --
  // nobody thinks of it as an upsert.
  if (rewritten.length > 0) parts.push(`updated ${things(rewritten.length)} it already knew`)
  if (proposedNew.length > 0) parts.push(`wants to remember ${things(proposedNew.length)}`)
  if (proposedChanges.length > 0) parts.push(`wants to change ${things(proposedChanges.length)} it already knew`)
  if (proposedForgets.length > 0) parts.push(`wants to forget ${things(proposedForgets.length)}`)
  if (proposedMerges.length > 0) parts.push(`wants to merge ${String(proposedMerges.length)} set${proposedMerges.length === 1 ? '' : 's'} of memories`)
  // A proposal needs a person, and until 2026-09-13 the sentence that said so
  // lived on a second notice above this card -- which is the redundancy that
  // notice was removed for. The card is the only surface for memory now, so
  // the ACTION has to be on its collapsed face rather than a click inside it.
  const summary = `${by} ${parts.join(' and ')}`
  if (proposed.length === 0) return summary
  return proposedNew.length === proposed.length ? `${summary} — keep or forget it on the Memory screen` : `${summary} — answer it on the Memory screen`
}

export function MemoryCard({ lines }: { readonly lines: readonly MemoryCardLine[] }): ReactElement | null {
  const [open, setOpen] = useState(false)
  if (lines.length === 0) return null
  return (
    // A note, not a card.
    //
    // "What this conversation taught the team" is a fact about something that
    // has already happened, and it needs nothing from anybody -- which is the
    // definition of the note register in this thread, not the card one. Cards
    // are for things that block you or things that are terminal (design
    // review, 2026-09-06). The disclosure stays; only the border goes.
    <div className="lc-memorycard">
      <button type="button" className="lc-activity" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon name="spark" size={14} />
        <span>{memoryCardSummary(lines)}</span>
        <span className="lc-activity__chev is-alone" aria-hidden="true">
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
        </span>
      </button>
      {open && (
        <ul className="lc-memorycard__list">
          {lines.map((line, index) => (
            <li key={`${String(index)}-${line.text}`} className={`lc-memorycard__line${line.status === 'proposed' ? ' is-proposed' : ''}`}>
              <span>
                {line.change === 'forget'
                  ? `Forget: ${line.text}`
                  : line.change === 'rewrite'
                    ? `Change to: ${line.text}`
                    : line.change === 'merge'
                      ? `Merge into: ${line.text}`
                      : line.text}
              </span>
              {line.status === 'proposed' && <span className="lc-rail__meta"> · waiting for you on the Memory screen</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
