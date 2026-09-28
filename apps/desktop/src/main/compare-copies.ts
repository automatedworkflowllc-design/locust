import { cp, lstat, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'

import type { CompareSlotId } from '../shared/compare.js'

/**
 * A COPY OF THE FOLDER FOR ONE COLUMN OF A COMPARISON (0.443, shared/compare.ts).
 *
 * A comparison answers read-only, and Cursor cannot be held read-only on
 * Windows -- so Grok and Gemini, which reach this machine through Cursor,
 * could not join one (Colin, 2026-09-28: "gemini/grok not selectable on
 * compare?"). Such a column answers in a copy instead, and whatever it
 * touches, the folder is not changed.
 *
 * Where the copy lives is measured, not chosen: never the system temp folder
 * (it sits under AppData, which a `.cursorignore` on this machine blocks --
 * Cursor then cannot read a single file there; memory
 * cursorignore-blinds-appdata), and never inside the folder itself, where the
 * other columns would find a second set of its files. So: `~/.locust/compare`.
 *
 * It is a copy of the folder AS IT IS, uncommitted work included, so every
 * column reads the same files -- not a checkout of the last commit. What is
 * rebuilt or fetched rather than written (dependencies, build output, git's
 * own store) is left out, and a folder too big to copy says so instead.
 */
export const COPY_ROOT = join(homedir(), '.locust', 'compare')
export const MAX_COPY_FILES = 5_000
export const MAX_COPY_BYTES = 250 * 1024 * 1024
const LEFT_OUT = new Set(['.git', '.locust', 'node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build', '.next', 'target', '.cache', '.turbo'])

const safeName = (compareId: string, slot: CompareSlotId): string => {
  if (!/^cmp_[A-Za-z0-9]{1,40}$/.test(compareId)) throw new Error('That comparison cannot name a copy.')
  return `${compareId}-${slot}`
}

/** Files and bytes the copy would hold, stopping as soon as either limit is passed. */
async function measure(folder: string): Promise<{ files: number; bytes: number; over: boolean }> {
  let files = 0
  let bytes = 0
  const walk = async (directory: string): Promise<boolean> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (LEFT_OUT.has(entry.name)) continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!(await walk(path))) return false
      } else if (entry.isFile()) {
        files += 1
        bytes += (await stat(path)).size
        if (files > MAX_COPY_FILES || bytes > MAX_COPY_BYTES) return false
      }
    }
    return true
  }
  const within = await walk(folder)
  return { files, bytes, over: !within }
}

/** The column's copy, made the first time and reused for its follow-ups. */
export async function makeCompareCopy(input: {
  readonly folder: string
  readonly compareId: string
  readonly slot: CompareSlotId
  readonly root?: string
}): Promise<string> {
  const root = input.root ?? COPY_ROOT
  const target = join(root, safeName(input.compareId, input.slot))
  const made = await lstat(target).then((found) => found.isDirectory(), () => false)
  if (made) return target
  const source = resolve(input.folder)
  const size = await measure(source)
  if (size.over) {
    return Promise.reject(
      new Error(`It answers in a copy of the folder, and this folder is too big to copy (more than ${MAX_COPY_FILES.toLocaleString('en-US')} files or ${String(Math.round(MAX_COPY_BYTES / (1024 * 1024)))} MB).`)
    )
  }
  await mkdir(root, { recursive: true })
  await cp(source, target, {
    recursive: true,
    errorOnExist: false,
    filter: (from) => {
      const inside = relative(source, from)
      if (inside.length === 0) return true
      return !inside.split(sep).some((part) => LEFT_OUT.has(part))
    }
  })
  return target
}

/** Every copy a comparison made. Nothing else under the root is touched. */
export async function removeCompareCopies(compareId: string, root: string = COPY_ROOT): Promise<void> {
  if (!/^cmp_[A-Za-z0-9]{1,40}$/.test(compareId)) return
  const names = await readdir(root).catch(() => [] as string[])
  for (const name of names) {
    if (name.startsWith(`${compareId}-`)) await rm(join(root, name), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}
