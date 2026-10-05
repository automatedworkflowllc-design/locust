import type { ProfileCounts, ProfileRestoreOutcome } from '../../shared/ipc.js'

/**
 * WHAT A BACKUP HOLDS, IN WORDS (0.614). The person's own nouns, the ones with
 * something in them, in the order they would ask about: "6 teammates, 1
 * routine, 106 memories and 186 conversations". Nothing at all says so.
 */
export function countsLine(counts: ProfileCounts): string {
  const parts: [number, string, string][] = [
    [counts.teammates, 'teammate', 'teammates'],
    [counts.routines, 'routine', 'routines'],
    [counts.memories, 'memory', 'memories'],
    [counts.rules, 'saved approval', 'saved approvals'],
    [counts.groups, 'group', 'groups'],
    [counts.rooms, 'room', 'rooms'],
    [counts.compares, 'comparison', 'comparisons'],
    [counts.conversations, 'conversation', 'conversations']
  ]
  const said = parts.filter(([count]) => count > 0).map(([count, one, many]) => `${String(count)} ${count === 1 ? one : many}`)
  if (said.length === 0) return 'nothing yet'
  if (said.length === 1) return said[0]!
  return `${said.slice(0, -1).join(', ')} and ${said.at(-1)!}`
}

/** The last part of a path, as a person reads a folder's name. */
export function folderName(path: string): string {
  return path.split(/[\\/]+/).filter((part) => part.length > 0).at(-1) ?? path
}

/** What a backup did, in one sentence. */
export function backedUpLine(result: { readonly folder: string; readonly counts: ProfileCounts }, size: string): string {
  return `Backed up ${countsLine(result.counts)} (${size}) to "${folderName(result.folder)}".`
}

/** What the last restore did, said once after the restart it needed. */
export function restoreNoticeLine(outcome: ProfileRestoreOutcome): string {
  if (!outcome.ok) return `The restore was not applied, and nothing here changed. ${outcome.reason ?? ''}`.trim()
  const what = outcome.counts === undefined ? 'the backup' : countsLine(outcome.counts)
  const aside = outcome.aside === undefined ? '' : ` What was here before is kept in "${folderName(outcome.aside)}", in Locust's profile folder.`
  return `Restored ${what} from "${folderName(outcome.folder)}".${aside}`
}
