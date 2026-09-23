import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * What changed in the build you are running, from the file that says so.
 *
 * Colin, 2026-09-17, asked whether a changelog exists on GitHub, in the app
 * and on the site. It existed in one place: `CHANGELOG.md` in the private
 * repo, written for someone using Locust and readable by nobody outside it.
 * The app never said what changed at all -- it downloaded a new version,
 * installed it at quit, and started up looking identical.
 *
 * So the file ships WITH the app (an extraResource beside the icon) and is
 * read from disk rather than fetched. That is the same posture as everything
 * else here: no network, nothing to be rate-limited, and the notes match the
 * bytes that are running because they were packaged together.
 */

/**
 * The heading each entry opens with: `## 0.176.0 - 2026-09-17`. The builds
 * before 0.44 were written with a dash of another width (`## 0.43.6 —
 * 2026-09-07`), and the hyphen-only pattern folded all 117 of them into the
 * build above -- invisible while only the running build's entry was read,
 * and a third of What's new once the whole file was.
 */
const ENTRY = /^##\s+([0-9]+\.[0-9]+\.[0-9]+)\s*(?:[-–—]\s*(\S+))?\s*$/
/**
 * A build a person should be told about when they arrive on it: an HTML
 * comment on its own line, so GitHub and the site show nothing for it.
 */
const BIG = /^\s*<!--\s*big\s*-->\s*$/i
/** A group inside an entry, the way Claude Code's What's new groups: `### New`. */
const GROUP = /^###\s+(.+?)\s*$/

/**
 * One group of an entry's changes. Entries written before the groups have one
 * group with no label -- the history is left as it was written, not guessed at.
 */
export interface ChangelogGroup {
  /** "New", "Improved", "Fixed". */
  readonly label?: string
  /** Markdown. */
  readonly text: string
}

export interface ChangelogEntry {
  readonly version: string
  /** The date on the heading, when it carries one. */
  readonly date?: string
  /** The entry's body, markdown, without its heading or its big mark. */
  readonly body: string
  /** Marked `<!-- big -->`: the home screen says so, once, to someone arriving on it. */
  readonly big: boolean
  readonly groups: readonly ChangelogGroup[]
}

/**
 * Every entry in the file, newest first -- which is the order it is written
 * in, so this preserves rather than sorts. A version string is not a number
 * and sorting it would be a second opinion about which build is newer.
 */
export function entries(text: string): readonly ChangelogEntry[] {
  const lines = text.split(String.fromCharCode(10))
  const found: ChangelogEntry[] = []
  let open: { version: string; date?: string; body: string[] } | undefined
  for (const line of lines) {
    const heading = ENTRY.exec(line)
    if (heading !== null) {
      if (open !== undefined) found.push(closed(open))
      open = {
        version: heading[1] ?? '',
        ...(heading[2] === undefined ? {} : { date: heading[2] }),
        body: []
      }
      continue
    }
    if (open !== undefined) open.body.push(line)
  }
  if (open !== undefined) found.push(closed(open))
  return found
}

function closed(open: { version: string; date?: string; body: string[] }): ChangelogEntry {
  const newline = String.fromCharCode(10)
  const kept = open.body.filter((line) => !BIG.test(line))
  const groups: { label?: string; lines: string[] }[] = [{ lines: [] }]
  for (const line of kept) {
    const heading = GROUP.exec(line)
    if (heading !== null) {
      groups.push({ label: heading[1] ?? '', lines: [] })
      continue
    }
    groups[groups.length - 1]!.lines.push(line)
  }
  return {
    version: open.version,
    ...(open.date === undefined ? {} : { date: open.date }),
    body: kept.join(newline).trim(),
    big: kept.length !== open.body.length,
    groups: groups
      .map((group) => ({ ...(group.label === undefined ? {} : { label: group.label }), text: group.lines.join(newline).trim() }))
      .filter((group) => group.text.length > 0)
  }
}

/**
 * The big builds a person has not been shown: newer than the one they last
 * saw, up to the one running, newest first.
 *
 * Nothing on a first install -- there is no "before" to catch up on, and the
 * first screen has its own job. Nothing when the version they saw is not in
 * this file (a downgrade, a build from elsewhere): a splash about the wrong
 * builds is worse than none.
 */
export function splashEntries(all: readonly ChangelogEntry[], seen: string | undefined, current: string): readonly ChangelogEntry[] {
  if (seen === undefined || seen === current) return []
  const from = all.findIndex((entry) => entry.version === current)
  const to = all.findIndex((entry) => entry.version === seen)
  if (from < 0 || to <= from) return []
  return all.slice(from, to).filter((entry) => entry.big)
}

/** The entry for one version, or nothing when the file does not carry it. */
export function entryFor(text: string, version: string): ChangelogEntry | undefined {
  return entries(text).find((entry) => entry.version === version)
}

/**
 * Where the file is: beside the app's other resources once packaged, and at
 * the repository root in development. Both are tried, because a development
 * run is the one a person is most likely to be looking at while changing it.
 */
export function changelogPaths(resourcesPath: string, appPath: string): readonly string[] {
  return [join(resourcesPath, 'CHANGELOG.md'), join(appPath, '..', '..', 'CHANGELOG.md')]
}

export async function readChangelog(paths: readonly string[]): Promise<string | undefined> {
  for (const path of paths) {
    try {
      return await readFile(path, 'utf8')
    } catch {
      // The next candidate, or nothing: a missing changelog is a build
      // without one, not a reason to fail a launch.
    }
  }
  return undefined
}
