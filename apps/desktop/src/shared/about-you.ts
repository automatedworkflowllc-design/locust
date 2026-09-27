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

/** The brief's paragraph. Defanged: it is quoted to a runtime, and it is the person's text, not instructions to the protocol. */
export function aboutYouSection(text: string): string {
  return [
    ABOUT_YOU_HEADING,
    defangProtocolBlocks(text.trim()),
    'Work the way this says unless the person asks for something else in the conversation. It is theirs: never rewrite it, and do not quote it back to them unless they ask.'
  ].join('\n')
}
