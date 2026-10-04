/**
 * What the cover's glass says while work runs (0.610): who is working, and
 * who waits on you -- "CODEX WORKING · CASPER WAITING ON YOU" (Colin's
 * mockup, 2026-10-04). Waiting first: it is the one that needs the person.
 * Two names at most; past that, counts, so the line fits the glass.
 * Nothing running and nothing waiting: undefined, and the glass says its claim.
 */
export function glassStatus(working: readonly string[], waiting: readonly string[]): string | undefined {
  const parts: string[] = []
  if (working.length + waiting.length === 0) return undefined
  if (working.length + waiting.length <= 2) {
    for (const name of waiting) parts.push(`${name} waiting on you`)
    for (const name of working) parts.push(`${name} working`)
    return parts.join(' · ')
  }
  if (waiting.length > 0) parts.push(`${String(waiting.length)} waiting on you`)
  if (working.length > 0) parts.push(`${String(working.length)} working`)
  return parts.join(' · ')
}
