import { readdir, stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'

/**
 * FOLDER WATCHERS (0.522), for routines that run "on a new file"
 * (shared/routine-schedule.ts). Product ideas, Bloks note item 2: "when a
 * file lands in this folder, ask this teammate". The rules, each one a way
 * this could go wrong:
 *
 *   - The first look is a BASELINE: what is in the folder then starts
 *     nothing. A watcher made over a folder of 400 files does not run 400
 *     times.
 *   - A new file counts once it has STOPPED CHANGING for `SETTLE_MS`: a
 *     download or a copy in progress is not yet the file.
 *   - At most `MAX_FIRES_PER_HOUR` runs an hour, per routine: a folder a
 *     teammate itself writes into cannot set off a loop.
 *   - Files arriving together go to ONE run, named together.
 *   - Top level only, no hidden or temporary names (".x", "~$x", "x.tmp",
 *     "x.crdownload", "x.part"), and only inside the project folder.
 *
 * Polled, not `fs.watch`: a poll every `POLL_MS` is the same on every
 * platform and every file system, including a synced or network folder
 * where watch events are not delivered.
 */
export const POLL_MS = 10_000
export const SETTLE_MS = 20_000
export const MAX_FIRES_PER_HOUR = 6
const MAX_ENTRIES = 2_000
const MAX_PENDING = 20

const PASSING = /^(\.|~\$)|\.(tmp|temp|crdownload|part|partial|download)$/i

interface Watched {
  readonly folder: string
  /** Names seen: the baseline, and every file since that settled. */
  readonly seen: Set<string>
  /** New names still changing: their size and time when last looked at, and since when they held. */
  readonly settling: Map<string, { size: number; mtimeMs: number; since: number }>
  /** Settled new files, waiting for a run. */
  pending: string[]
  /** When each run this hour started. */
  fires: number[]
  baselined: boolean
}

export interface FileArrivals {
  /** Look at every watched folder; the routines to watch are given each time. */
  poll(watching: readonly { readonly routineId: string; readonly folder: string }[], now?: number): Promise<void>
  /** The settled new files a routine may run for now, or none (none waiting, or its hour is full). */
  ready(routineId: string, now?: number): readonly string[]
  /** A run started for these files. */
  fired(routineId: string, files: readonly string[], now?: number): void
}

/** The watched folder, absolute, when it is inside the project; undefined otherwise. */
export function watchedPath(projectFolder: string, folder: string): string | undefined {
  const root = resolve(projectFolder)
  const path = resolve(root, folder)
  return path.startsWith(root + sep) ? path : undefined
}

export function createFileArrivals(options: { readonly projectFolder: string }): FileArrivals {
  const byRoutine = new Map<string, Watched>()
  return {
    async poll(watching, now = Date.now()) {
      // A routine no longer watching -- removed, or its schedule changed -- is forgotten.
      for (const routineId of [...byRoutine.keys()]) {
        const still = watching.find((entry) => entry.routineId === routineId)
        if (still === undefined || still.folder !== byRoutine.get(routineId)?.folder) byRoutine.delete(routineId)
      }
      for (const { routineId, folder } of watching) {
        const path = watchedPath(options.projectFolder, folder)
        if (path === undefined) continue
        const watched = byRoutine.get(routineId) ?? { folder, seen: new Set(), settling: new Map(), pending: [], fires: [], baselined: false }
        byRoutine.set(routineId, watched)
        let names: string[]
        try {
          names = (await readdir(path, { withFileTypes: true }))
            .filter((entry) => entry.isFile() && !PASSING.test(entry.name))
            .map((entry) => entry.name)
            .slice(0, MAX_ENTRIES)
        } catch {
          // Not there yet: a folder made later is watched from the moment it appears.
          if (!watched.baselined) continue
          names = []
        }
        if (!watched.baselined) {
          for (const name of names) watched.seen.add(name)
          watched.baselined = true
          continue
        }
        for (const name of names) {
          if (watched.seen.has(name)) continue
          const measured = await stat(join(path, name)).catch(() => undefined)
          if (measured === undefined) continue
          const held = watched.settling.get(name)
          if (held === undefined || held.size !== measured.size || held.mtimeMs !== measured.mtimeMs) {
            watched.settling.set(name, { size: measured.size, mtimeMs: measured.mtimeMs, since: now })
            continue
          }
          if (now - held.since < SETTLE_MS) continue
          watched.settling.delete(name)
          watched.seen.add(name)
          if (watched.pending.length < MAX_PENDING) watched.pending.push(name)
        }
        // A name that went away while settling is let go.
        for (const name of [...watched.settling.keys()]) if (!names.includes(name)) watched.settling.delete(name)
      }
    },
    ready(routineId, now = Date.now()) {
      const watched = byRoutine.get(routineId)
      if (watched === undefined || watched.pending.length === 0) return []
      watched.fires = watched.fires.filter((at) => now - at < 3_600_000)
      return watched.fires.length >= MAX_FIRES_PER_HOUR ? [] : [...watched.pending]
    },
    fired(routineId, files, now = Date.now()) {
      const watched = byRoutine.get(routineId)
      if (watched === undefined) return
      watched.pending = watched.pending.filter((name) => !files.includes(name))
      watched.fires.push(now)
    }
  }
}

/** What step 1 is told, before its own words: the files, by name, inside the folder. */
export function arrivalNote(folder: string, files: readonly string[]): string {
  const where = folder.replace(/\\/g, '/')
  const named = files.map((name) => `${where}/${name}`).join(', ')
  return files.length === 1
    ? `A new file just arrived: ${named}. This run is for it.`
    : `${String(files.length)} new files just arrived: ${named}. This run is for them.`
}
