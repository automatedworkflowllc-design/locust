import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { RuntimeBinaryFacts, RuntimeFactsCache } from '@teammate/runtime-adapters'

/**
 * What each runtime's CLI said about itself, kept between launches.
 *
 * `--version` and `--help` are functions of the file on disk: the same file
 * prints the same thing every time, and on Colin's machine that is 0.5-1.6 s
 * per runtime of a sweep that runs at every launch (Fable's probing review,
 * #4). Discovery decides what is still true -- it fingerprints the files a
 * launch touches and only asks this for a fingerprint it has -- so this is a
 * dumb map, in memory while the app runs and on disk between runs.
 *
 * READ-THROUGH, WRITE-BEHIND. A lookup must be synchronous because discovery
 * asks it in the middle of a sweep, so the file is read ONCE at startup and
 * writes are queued rather than awaited. Losing a write costs one extra
 * probe next launch, which is exactly what this file is an optimisation
 * against -- so nothing here is allowed to fail loudly.
 */

/**
 * How many binaries are remembered.
 *
 * Eight runtimes, and a fingerprint changes on every CLI update, so entries
 * accumulate one per update per runtime. A few hundred covers years of
 * updates and stays a file worth rewriting. When it is full the oldest
 * entries go, because the newest fingerprints are the ones on disk now.
 */
export const MAX_REMEMBERED_BINARIES = 200
const SCHEMA_VERSION = 1 as const
const FILE_NAME = 'runtime-facts.json'

interface StoredEntry {
  readonly fingerprint: string
  readonly versionText: string
  readonly capabilityText: string
  /** When this was learned, so the cap drops the oldest. */
  readonly at: number
}

export interface RuntimeFactsStore extends RuntimeFactsCache {
  /** Read the file. Called once, before the first sweep; failure is empty. */
  load(): Promise<void>
  /**
   * Settle whatever is still being written. Nothing in the app awaits this
   * -- a lost write costs one probe -- but a test that reads the file back
   * needs a moment it can name, and sleeping for one is how a test becomes
   * flaky.
   */
  settled(): Promise<void>
  /** For the tests and the log: how many binaries are remembered. */
  size(): number
}

/**
 * Untrusted on read, like every other file in the profile. An entry that is
 * not the right shape is dropped rather than parsed loosely -- a version
 * string that is not a string would otherwise reach `parseRuntimeVersion`.
 */
function parseEntries(text: string): readonly StoredEntry[] {
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch {
    return []
  }
  if (typeof value !== 'object' || value === null) return []
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== SCHEMA_VERSION) return []
  if (!Array.isArray(record.binaries)) return []
  const entries: StoredEntry[] = []
  for (const raw of record.binaries as unknown[]) {
    if (typeof raw !== 'object' || raw === null) continue
    const entry = raw as Record<string, unknown>
    if (typeof entry.fingerprint !== 'string' || entry.fingerprint.length === 0) continue
    if (typeof entry.versionText !== 'string') continue
    if (typeof entry.capabilityText !== 'string') continue
    const at = typeof entry.at === 'number' && Number.isFinite(entry.at) ? entry.at : 0
    entries.push({ fingerprint: entry.fingerprint, versionText: entry.versionText, capabilityText: entry.capabilityText, at })
    if (entries.length >= MAX_REMEMBERED_BINARIES) break
  }
  return entries
}

export function createRuntimeFactsStore(options: {
  readonly rootDirectory: string
  /** Test seam, so a cap test does not depend on the wall clock. */
  readonly now?: () => number
}): RuntimeFactsStore {
  const path = join(options.rootDirectory, FILE_NAME)
  const now = options.now ?? Date.now
  const held = new Map<string, StoredEntry>()
  let writing: Promise<void> = Promise.resolve()
  let queued = false

  /*
   * ONE write for any number of changes made before it runs.
   *
   * A sweep records a fact per runtime, and this wrote the whole file once
   * per fact. Harmless at seven, but the cap test wrote two hundred and
   * twenty files in a row and was still writing them when the test tried to
   * clean up (ENOTEMPTY) -- a queue that grows with the work rather than
   * with the number of distinct states. The flag is cleared when the write
   * BEGINS, so a fact recorded while one is in flight still schedules the
   * next one.
   */
  const flush = (): void => {
    if (queued) return
    queued = true
    // Queued behind whatever is already writing: two sweeps finishing
    // together must not interleave a temp file with a rename.
    writing = writing
      .catch(() => undefined)
      .then(async () => {
        queued = false
        // Newest last, so the cap below drops the oldest.
        const binaries = [...held.values()].sort((left, right) => left.at - right.at).slice(-MAX_REMEMBERED_BINARIES)
        const temp = `${path}.${String(process.pid)}.tmp`
        await writeFile(temp, JSON.stringify({ schemaVersion: SCHEMA_VERSION, binaries }), 'utf8')
        await rename(temp, path)
      })
      .catch(() => {
        // A cache that cannot be written is a cache that is not used next
        // launch. Nothing above this needs to know.
      })
  }

  return {
    settled(): Promise<void> {
      // Twice: the write in flight, and the one its own changes scheduled.
      return writing.catch(() => undefined).then(() => writing).catch(() => undefined)
    },
    async load(): Promise<void> {
      const text = await readFile(path, 'utf8').catch(() => undefined)
      if (text === undefined) return
      for (const entry of parseEntries(text)) held.set(entry.fingerprint, entry)
    },
    get(fingerprint): RuntimeBinaryFacts | undefined {
      const entry = held.get(fingerprint)
      return entry === undefined ? undefined : { versionText: entry.versionText, capabilityText: entry.capabilityText }
    },
    set(fingerprint, facts): void {
      const existing = held.get(fingerprint)
      if (existing?.versionText === facts.versionText && existing.capabilityText === facts.capabilityText) return
      held.set(fingerprint, { fingerprint, versionText: facts.versionText, capabilityText: facts.capabilityText, at: now() })
      // Bounded in memory as well as on disk: this map lives for the whole
      // session, and a session that reinstalls a CLI repeatedly would
      // otherwise grow it without limit.
      if (held.size > MAX_REMEMBERED_BINARIES) {
        const oldest = [...held.values()].sort((left, right) => left.at - right.at).slice(0, held.size - MAX_REMEMBERED_BINARIES)
        for (const entry of oldest) held.delete(entry.fingerprint)
      }
      flush()
    },
    size(): number {
      return held.size
    }
  }
}
