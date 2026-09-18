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

/** The heading each entry opens with: `## 0.176.0 - 2026-09-17`. */
const ENTRY = /^##\s+([0-9]+\.[0-9]+\.[0-9]+)\s*(?:-\s*(\S+))?\s*$/

export interface ChangelogEntry {
  readonly version: string
  /** The date on the heading, when it carries one. */
  readonly date?: string
  /** The entry's body, markdown, without its heading. */
  readonly body: string
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
  return {
    version: open.version,
    ...(open.date === undefined ? {} : { date: open.date }),
    body: open.body.join(String.fromCharCode(10)).trim()
  }
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
