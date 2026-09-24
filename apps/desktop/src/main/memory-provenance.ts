import { stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

import { citedPaths } from '../shared/memory.js'

/**
 * WHETHER A MEMORY'S FILES MOVED ON WITHOUT IT (A1.3).
 *
 * A memory that names a file -- "the retry logic lives in src/net/fetch.ts"
 * -- is a claim about that file as it was when the memory was written. Once
 * the file changes, the claim may not hold, and a teammate briefed with it
 * acts on it anyway. Copilot checks a memory's citations before it uses one
 * (the harness review's survey: measured PR merge rate 90% with that memory,
 * 83% without); this is the cross-runtime version, done at brief time on
 * this side, because none of the CLIs can be taught to do it.
 *
 * Only the files the memory NAMES, inside the folder the run stands in: a
 * path that leaves the folder, or does not exist there, says nothing. And
 * "may be out of date", never "wrong": a file changes for many reasons, and
 * the memory is still briefed -- the teammate is told what to check.
 */

/** A file this much newer than the memory counts as changed after it: a save a second later is the same moment. */
const GRACE_MS = 2000
/** At most this many cited files are checked per memory. */
const MAX_CITED = 5

export type StatFile = (path: string) => Promise<{ readonly mtimeMs: number }>

export async function changedSince(
  folder: string,
  text: string,
  writtenAt: string,
  statFile: StatFile = stat
): Promise<readonly string[]> {
  const written = Date.parse(writtenAt)
  if (Number.isNaN(written)) return []
  const checked = await Promise.all(
    citedPaths(text)
      .slice(0, MAX_CITED)
      .map(async (cited) => {
        const full = resolve(folder, cited)
        const inside = relative(folder, full)
        if (inside.length === 0 || inside.startsWith('..') || isAbsolute(inside)) return undefined
        const seen = await statFile(full).catch(() => undefined)
        return seen !== undefined && seen.mtimeMs > written + GRACE_MS ? cited : undefined
      })
  )
  return checked.filter((path): path is string => path !== undefined)
}
