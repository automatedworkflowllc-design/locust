import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, resolve } from 'node:path'

import { workspaceIdFor } from './workspace.js'

/**
 * EVERY FOLDER LOCUST HAS WORKED IN, BY ID AND PATH (0.458).
 *
 * Colin, 2026-09-29: "Just make it work exactly like Claude code ... Claude
 * allows you to switch work folder but also has projects grouped." A
 * conversation belongs to a folder, and the sidebar lists every folder's
 * conversations under its name (docs/PLAN-2026-09-29-FOLDERS-LIKE-CLAUDE-CODE.md).
 *
 * A mission records its folder only as `workspaceId` -- a hash of the path --
 * so the path has to be kept somewhere to continue a conversation there. This
 * is that somewhere: `folders.json`, written whenever a folder is worked in.
 * A folder from before it existed is recovered from the conversation's own
 * record (`recoverFolderPath`).
 */

/** A folder by path, with the id and name memory and the brief know it by. */
export interface FolderContext {
  readonly path: string
  readonly id: string
  readonly name: string
}

export interface KnownFolder {
  readonly id: string
  readonly path: string
  /** The folder's own name, as the sidebar heads its group. */
  readonly name: string
  /** When a conversation was last started or opened there; absent for one only recovered. */
  readonly lastUsedAt?: string
}

interface FoldersFile {
  readonly schemaVersion: 1
  readonly folders: readonly KnownFolder[]
}

export function folderName(path: string): string {
  return basename(path) || path
}

/**
 * A folder's path, from any absolute paths a conversation's record holds.
 *
 * The id is a hash of the folder's path, so whichever of those paths -- or a
 * folder above one of them -- hashes to it IS the folder. A run's tool calls
 * name files by absolute path often enough that this found 5 of the 6 folders
 * in Colin's history (2026-09-29). Nothing is guessed: no match, no path.
 */
export function recoverFolderPath(id: string, text: string): string | undefined {
  const tried = new Set<string>()
  for (const found of text.matchAll(/[A-Za-z]:(?:\\\\|\\|\/)[^"\s<>|*?\r\n]+|\/(?:Users|home|Volumes|mnt|opt|srv|tmp|var)\/[^"\s<>|*?\r\n]+/g)) {
    let path = found[0].replace(/\\\\/g, '\\')
    if (/^[A-Za-z]:/.test(path)) path = path.replace(/\//g, '\\')
    for (;;) {
      if (!tried.has(path)) {
        tried.add(path)
        if (workspaceIdFor(path) === id) return path
      }
      const parent = /^[A-Za-z]:/.test(path) ? windowsParent(path) : dirname(path)
      if (parent === undefined || parent === path) break
      path = parent
    }
  }
  return undefined
}

function windowsParent(path: string): string | undefined {
  const cut = path.replace(/\\+$/, '').lastIndexOf('\\')
  if (cut <= 2) return undefined
  return path.slice(0, cut)
}

export interface FolderRegistry {
  list(): Promise<readonly KnownFolder[]>
  pathOf(id: string): Promise<string | undefined>
  /** A folder worked in now: kept, and marked as just used. */
  use(path: string): Promise<KnownFolder>
  /** Folders found, not used: kept without touching when each was last used. */
  learn(found: readonly { readonly id: string; readonly path: string }[]): Promise<void>
}

export function createFolderRegistry(options: { readonly file: string; readonly now?: () => Date }): FolderRegistry {
  const now = options.now ?? (() => new Date())
  let held: KnownFolder[] | undefined
  const read = async (): Promise<KnownFolder[]> => {
    if (held !== undefined) return held
    try {
      const parsed = JSON.parse(await readFile(options.file, 'utf8')) as Partial<FoldersFile>
      held = (Array.isArray(parsed.folders) ? parsed.folders : []).filter(
        (entry): entry is KnownFolder =>
          typeof entry === 'object' && entry !== null && typeof entry.id === 'string' && typeof entry.path === 'string' && isAbsolute(entry.path)
      ).map((entry) => ({ ...entry, name: folderName(entry.path) }))
    } catch {
      held = []
    }
    return held
  }
  // One write at a time, whole or not at all.
  let writing = Promise.resolve()
  const save = (folders: KnownFolder[]): Promise<void> => {
    held = folders
    writing = writing.then(async () => {
      await mkdir(dirname(options.file), { recursive: true })
      const body: FoldersFile = { schemaVersion: 1, folders }
      await writeFile(`${options.file}.tmp`, `${JSON.stringify(body, null, 2)}\n`, 'utf8')
      await rename(`${options.file}.tmp`, options.file)
    }).catch(() => undefined)
    return writing
  }
  return {
    list: async () => [...(await read())].sort((a, b) => (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? '')),
    pathOf: async (id) => (await read()).find((entry) => entry.id === id)?.path,
    async use(path) {
      const full = resolve(path)
      const entry: KnownFolder = { id: workspaceIdFor(full), path: full, name: folderName(full), lastUsedAt: now().toISOString() }
      await save([...(await read()).filter((one) => one.id !== entry.id), entry])
      return entry
    },
    async learn(found) {
      const current = await read()
      const fresh = found.filter((one) => !current.some((entry) => entry.id === one.id))
      if (fresh.length === 0) return
      await save([...current, ...fresh.map((one) => ({ id: one.id, path: one.path, name: folderName(one.path) }))])
    }
  }
}
