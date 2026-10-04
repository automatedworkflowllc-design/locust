/**
 * A2.9: THE OVERLAP NOTE (ECC's TCAS -- two aircraft told about each other).
 *
 * Two teammates working in one folder can each change the same file, a run
 * apart, and neither is told: the second edit lands on top of the first and
 * the brief it starts from says nothing about it. The host already reads
 * every writing run's folder before and after (`observed`, A2.17). This keeps
 * what it read, per folder and teammate, for a few hours, and a teammate's
 * next brief names the files another teammate changed that they changed too.
 *
 * Held in memory on purpose: it is a heads-up about the last few hours, not
 * a record. A restart forgets it, and the ledger still has every change.
 */

/** How long a change counts as recent. */
export const OVERLAP_WINDOW_MS = 6 * 60 * 60 * 1000
/** Files named per teammate in the note; the rest are counted. */
const NAMED_PER_TEAMMATE = 8

export interface RecentEdits {
  /** A writing run, read by the host, changed these paths in this folder. */
  record(input: { readonly folder: string; readonly teammateId: string; readonly name: string; readonly paths: readonly string[]; readonly at: Date }): void
  /**
   * The note for a teammate about to start in this folder: the files another
   * teammate changed there recently that this one also changed recently.
   * Undefined when there is none.
   */
  overlapFor(input: { readonly folder: string; readonly teammateId: string; readonly now: Date }): string | undefined
}

interface Edits {
  name: string
  readonly paths: Map<string, number>
}

/** One key per folder, whatever the spelling Windows allows for it. */
function folderKey(folder: string): string {
  const slashed = folder.replace(/\\/g, '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? slashed.toLowerCase() : slashed
}

function ago(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  if (minutes < 60) return minutes === 1 ? 'a minute ago' : `${String(minutes)} minutes ago`
  const hours = Math.round(minutes / 60)
  return hours === 1 ? 'an hour ago' : `${String(hours)} hours ago`
}

export function createRecentEdits(options: { readonly windowMs?: number } = {}): RecentEdits {
  const windowMs = options.windowMs ?? OVERLAP_WINDOW_MS
  const folders = new Map<string, Map<string, Edits>>()

  const recent = (edits: Edits | undefined, now: number): Map<string, number> => {
    const kept = new Map<string, number>()
    if (edits === undefined) return kept
    for (const [path, at] of edits.paths) {
      if (now - at <= windowMs && at <= now + 60_000) kept.set(path, at)
      else edits.paths.delete(path)
    }
    return kept
  }

  return {
    record(input) {
      if (input.paths.length === 0) return
      const key = folderKey(input.folder)
      const byTeammate = folders.get(key) ?? new Map<string, Edits>()
      folders.set(key, byTeammate)
      const edits = byTeammate.get(input.teammateId) ?? { name: input.name, paths: new Map<string, number>() }
      edits.name = input.name
      for (const path of input.paths) edits.paths.set(path, input.at.getTime())
      byTeammate.set(input.teammateId, edits)
    },

    overlapFor(input) {
      const byTeammate = folders.get(folderKey(input.folder))
      if (byTeammate === undefined) return undefined
      const now = input.now.getTime()
      const mine = recent(byTeammate.get(input.teammateId), now)
      if (mine.size === 0) return undefined
      const lines: string[] = []
      for (const [teammateId, edits] of byTeammate) {
        if (teammateId === input.teammateId) continue
        const theirs = recent(edits, now)
        const both = [...theirs].filter(([path]) => mine.has(path)).sort((a, b) => b[1] - a[1])
        if (both.length === 0) continue
        const named = both.slice(0, NAMED_PER_TEAMMATE).map(([path]) => path)
        const more = both.length - named.length
        lines.push(`${edits.name} changed ${named.join(', ')}${more > 0 ? ` and ${String(more)} more` : ''} (last ${ago(now - both[0]![1])})`)
      }
      if (lines.length === 0) return undefined
      return [
        'Files you changed recently in this folder were also changed by another teammate since, or around the same time -- read their change before you edit these again, so neither of you undoes the other:',
        ...lines.map((line) => `- ${line}.`)
      ].join('\n')
    }
  }
}
