import { faceLabel } from './faceState.js'
import type { TeammateStatusView } from './status.js'
import { agoLabel } from './teammateWork.js'

/** What a team card says beside the name, in which colour, and how it is read aloud. */
export interface TeamCardState {
  readonly word: string
  readonly tone: 'live' | 'amber' | 'red' | 'muted'
  readonly spoken: string
}

const lowerFirst = (text: string): string => (/^[A-Z][a-z]/.test(text) ? `${text.charAt(0).toLowerCase()}${text.slice(1)}` : text)

/**
 * "3h ago", from the same thresholds as `agoLabel` ("3 hours ago"). The tag
 * sits beside the name in a card a third of the row wide, where "last worked
 * 3 hours ago" was cut to "last worked 3 ho…" (the first dev frame of this
 * change); the full phrase is what the card reads aloud.
 */
export function compactAgo(iso: string, now: Date = new Date()): string | undefined {
  const spoken = agoLabel(iso, now)
  if (spoken === undefined || spoken === 'just now') return spoken
  const parts = /^(\d+) (minute|hour|day|week)s? ago$/.exec(spoken)
  if (parts === null) return spoken
  return `${parts[1]!}${parts[2]!.charAt(0)} ago`
}

/**
 * THE STATE ON A TEAM CARD (0.606). A card said "working" or nothing, so a
 * teammate waiting on an answer, one blocked on a sign-in and one idle since
 * Tuesday all read the same, and the cards read as static -- the critique
 * Colin nodded at on 2026-10-04. The same fact the sidebar face and the
 * header already draw (`teammateStatusView`) is said once more where a
 * person looks for who to talk to: the live word (working, thinking,
 * replying) in the live colour, "waiting on you" in amber, the sign-in or
 * install in red, and, idle, when they last worked.
 */
export function teamCardState(view: TeammateStatusView | undefined, lastAt: string | undefined, now = new Date()): TeamCardState | undefined {
  if (view === undefined) return undefined
  if (view.status === 'blocked') {
    const word = lowerFirst(view.label.replace(/ — checking again$/, ''))
    return { word, tone: view.tone === 'amber' ? 'amber' : 'red', spoken: word }
  }
  if (view.status === 'approval-needed') return { word: 'waiting on you', tone: 'amber', spoken: 'waiting on you' }
  if (view.status === 'working') {
    const word = faceLabel(view.activity)
    return { word, tone: 'live', spoken: `${word} now` }
  }
  const ago = lastAt === undefined ? undefined : agoLabel(lastAt, now)
  if (ago === undefined) return { word: 'no work yet', tone: 'muted', spoken: 'no work yet' }
  return { word: compactAgo(lastAt!, now) ?? ago, tone: 'muted', spoken: `last worked ${ago}` }
}
