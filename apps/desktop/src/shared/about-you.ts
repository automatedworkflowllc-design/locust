import { defangProtocolBlocks } from './protocolTags.js'

/**
 * ABOUT YOU: a standing note every teammate reads (0.423).
 *
 * From the Hindsight evaluation (plan, "AFTER THE FRESH-EYES CHECK", 1):
 * its "mental model" is a standing answer about the person -- how they like
 * to work -- read before every task. Kept the Locust way: the person writes
 * it on the Memory screen, every teammate is given it, and no teammate
 * changes it. It is the person's own words, so it is given whatever the
 * memory mode says: switching teammate memory off does not silence the
 * person.
 *
 * Claude Code's user memory (~/.claude/CLAUDE.md) is the same idea for one
 * agent; this is it for a team of them, on every runtime.
 */
export const MAX_ABOUT_YOU = 1500

/** The note as stored: trimmed text within the limit, or undefined for none or anything malformed. */
export function parsedAboutYou(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (text.length === 0) return undefined
  return text.length > MAX_ABOUT_YOU ? text.slice(0, MAX_ABOUT_YOU) : text
}

export const ABOUT_YOU_HEADING = 'About the person you work for, in their own words:'

/**
 * How a teammate suggests a line for the note (0.424): one line in its
 * memory block. The person is always asked -- whatever the memory mode --
 * because the note is theirs.
 */
export const ABOUT_YOU_OP = 'about you :: one sentence for the person\'s own About-you note (how they like to work), which they decide whether to add'

/** The brief's paragraph. Defanged: it is quoted to a runtime, and it is the person's text, not instructions to the protocol. */
export function aboutYouSection(text: string): string {
  return [
    ABOUT_YOU_HEADING,
    defangProtocolBlocks(text.trim()),
    'Work the way this says unless the person asks for something else in the conversation. It is theirs: never rewrite it, and do not quote it back to them unless they ask.',
    // MEASURED (0.424 drive): with a placeholder -- "about you :: the
    // sentence" -- Claude Haiku wrote "numbers :: always present in table
    // format", which reads as nothing. The form is named word for word, with
    // a real sentence in it.
    'If you learn something lasting about how they like to work that it does not say, suggest one sentence for it at the very end of your reply, in exactly this form -- the words "about you ::" and then your sentence:',
    '<locust-memory>',
    'about you :: Prefers a one-line summary before any detail.',
    '</locust-memory>',
    'Only a line that starts "about you ::" is read as a suggestion for this note. They decide; it is never added without them.'
  ].join('\n')
}

/** A line a teammate suggested for the note, waiting for the person (0.424). */
export interface AboutYouSuggestion {
  readonly id: string
  readonly text: string
  /** The teammate's name, as it was when they suggested it. */
  readonly by: string
  readonly at: string
}

export const MAX_ABOUT_YOU_SUGGESTIONS = 10
export const MAX_ABOUT_YOU_SUGGESTION = 300

/** Suggestions as stored: well-formed entries only, newest last, at most ten. */
export function parsedAboutYouSuggestions(value: unknown): readonly AboutYouSuggestion[] | undefined {
  if (!Array.isArray(value)) return undefined
  const kept = value.flatMap((entry): AboutYouSuggestion[] => {
    if (typeof entry !== 'object' || entry === null) return []
    const record = entry as Record<string, unknown>
    if (typeof record.id !== 'string' || !/^ays_[A-Za-z0-9-]{1,64}$/.test(record.id)) return []
    if (typeof record.text !== 'string' || record.text.trim().length === 0) return []
    if (typeof record.by !== 'string' || typeof record.at !== 'string' || Number.isNaN(Date.parse(record.at))) return []
    return [{ id: record.id, text: record.text.trim().slice(0, MAX_ABOUT_YOU_SUGGESTION), by: record.by.slice(0, 80), at: record.at }]
  })
  return kept.length === 0 ? undefined : kept.slice(-MAX_ABOUT_YOU_SUGGESTIONS)
}

/** The note with a suggested line added at its end, within the note's limit. */
export function withSuggestion(note: string | undefined, line: string): string {
  const base = (note ?? '').trim()
  const joined = base.length === 0 ? line.trim() : `${base}\n${line.trim()}`
  return joined.slice(0, MAX_ABOUT_YOU)
}
