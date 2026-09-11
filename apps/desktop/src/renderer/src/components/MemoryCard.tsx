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
  /** The turn it was learned on: the card is drawn under that turn. */
  readonly missionId: string
}

export function memoryCardSummary(lines: readonly MemoryCardLine[]): string {
  const kept = lines.filter((line) => line.status === 'kept')
  const proposed = lines.filter((line) => line.status === 'proposed')
  const by = lines[0]?.by ?? 'A teammate'
  const things = (n: number): string => `${String(n)} thing${n === 1 ? '' : 's'}`
  const parts: string[] = []
  if (kept.length > 0) parts.push(`remembered ${things(kept.length)}`)
  if (proposed.length > 0) parts.push(`wants to remember ${things(proposed.length)}`)
  return `${by} ${parts.join(' and ')}`
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
              <span>{line.text}</span>
              {line.status === 'proposed' && <span className="lc-rail__meta"> · waiting for you on the Memory screen</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
