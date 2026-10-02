import { readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import type { CopyBringIn, CopyChanges } from './compare-copies.js'
import { bringInCopy, copyChanges, makeCompareCopy, removeNamedCopy } from './compare-copies.js'

/**
 * A ROUTINE THAT WORKS IN A COPY (0.533).
 *
 * Sol's 0.528 pass, as an office user: "I would not trust a file routine's
 * no-change description after seeing it create files." A routine that may
 * change files can now work in a copy of the folder instead: its steps run
 * there, and when it finishes, what it changed waits under Routines for the
 * person to Keep (written into the folder, refused if they have since changed
 * the same files) or Discard. Nothing lands in the folder before that.
 *
 * The copy is Compare's (compare-copies.ts): the folder as it is, uncommitted
 * work included, without what is rebuilt or fetched (dependencies, build
 * output, git's own store), and refused for a folder too big to copy. One copy
 * per routine, under `~/.locust/routines`, made fresh for each run; beside it,
 * the folder it came from, so Keep knows where to write even after a restart.
 */
export const ROUTINE_COPY_ROOT = join(homedir(), '.locust', 'routines')

const nameFor = (routineId: string): string => {
  if (!/^rt_[A-Za-z0-9]{1,40}$/.test(routineId)) throw new Error('That routine cannot name a copy.')
  return routineId
}
const sourceFile = (root: string, routineId: string): string => join(root, `${nameFor(routineId)}.source.json`)

export interface RoutineCopies {
  /** A fresh copy of `folder` for this routine's run; any earlier one is removed first. */
  make(routineId: string, folder: string): Promise<string>
  path(routineId: string): string
  /** The folder the copy was made from. */
  source(routineId: string): Promise<string | undefined>
  changes(routineId: string): Promise<CopyChanges>
  keep(routineId: string): Promise<CopyBringIn>
  discard(routineId: string): Promise<void>
}

export function createRoutineCopies(root: string = ROUTINE_COPY_ROOT): RoutineCopies {
  const source = async (routineId: string): Promise<string | undefined> => {
    const read = await readFile(sourceFile(root, routineId), 'utf8').catch(() => undefined)
    if (read === undefined) return undefined
    const folder = (JSON.parse(read) as { readonly folder?: unknown }).folder
    return typeof folder === 'string' && folder.length > 0 ? folder : undefined
  }
  return {
    async make(routineId, folder) {
      const name = nameFor(routineId)
      await removeNamedCopy(name, root)
      const path = await makeCompareCopy({ name, folder, root })
      await writeFile(sourceFile(root, routineId), JSON.stringify({ folder: resolve(folder) }), 'utf8')
      return path
    },
    path: (routineId) => join(root, nameFor(routineId)),
    source,
    changes: (routineId) => copyChanges({ name: nameFor(routineId), root }),
    async keep(routineId) {
      const folder = await source(routineId)
      if (folder === undefined) throw new Error('Where this copy came from is not recorded, so it cannot be kept.')
      return bringInCopy({ name: nameFor(routineId), folder, root })
    },
    async discard(routineId) {
      await removeNamedCopy(nameFor(routineId), root)
      await rm(sourceFile(root, routineId), { force: true })
    }
  }
}
