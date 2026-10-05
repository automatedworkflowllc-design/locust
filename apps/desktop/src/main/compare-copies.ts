import { createHash } from 'node:crypto'
import { cp, lstat, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'

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
 * A drive launches Locust with its own scratch profile (`startDrive`), but
 * copies still landed in the REAL `~/.locust/compare` beside the person's own
 * (2026-10-05). `LOCUST_COMPARE_ROOT`, when set, is that folder instead --
 * drives point it inside their profile so copies go away with it. Unset, it
 * is `~/.locust/compare` as today.
 *
 * It is a copy of the folder AS IT IS, uncommitted work included, so every
 * column reads the same files -- not a checkout of the last commit. What is
 * rebuilt or fetched rather than written (dependencies, build output, git's
 * own store) is left out, and a folder too big to copy says so instead.
 */
export const COMPARE_ROOT_ENV = 'LOCUST_COMPARE_ROOT'

/** Where comparison copies live: `LOCUST_COMPARE_ROOT` when set, else `~/.locust/compare`. */
export function compareRoot(env: NodeJS.ProcessEnv = process.env): string {
  const set = env[COMPARE_ROOT_ENV]?.trim()
  return set !== undefined && set.length > 0 ? set : join(homedir(), '.locust', 'compare')
}

/**
 * Same folder as `compareRoot()` at first read. Prefer `compareRoot()` when the
 * value must follow the environment (tests, and every make/read/keep/remove).
 */
export const COPY_ROOT = compareRoot()
/*
 * Raised 0.555, measured on Colin's folders: a project of 11,339 files and
 * 388 MB was refused at 5,000 and 250 MB. A file over MAX_COPIED_FILE_BYTES
 * (a video, a database, a model) is left out of the copy rather than turning
 * the whole folder away; a folder past these works in place ('folder').
 */
export const MAX_COPY_FILES = 20_000
export const MAX_COPY_BYTES = 1024 * 1024 * 1024
export const MAX_COPIED_FILE_BYTES = 20 * 1024 * 1024
const LEFT_OUT = new Set(['.git', '.locust', 'node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build', '.next', 'target', '.cache', '.turbo'])

const safeName = (compareId: string, slot: CompareSlotId): string => {
  if (!/^cmp_[A-Za-z0-9]{1,40}$/.test(compareId)) throw new Error('That comparison cannot name a copy.')
  return `${compareId}-${slot}`
}

/**
 * WHICH COPY: a comparison's column, or one named outright (0.533: a routine
 * that works in a copy, routine-copy.ts). A named copy is `rt_` and letters,
 * digits or underscores, so it can never climb out of its root.
 */
export type CopyRef = { readonly compareId: string; readonly slot: CompareSlotId } | { readonly name: string }

const nameOf = (ref: CopyRef): string => {
  if ('name' in ref) {
    if (!/^rt_[A-Za-z0-9_]{1,60}$/.test(ref.name)) throw new Error('That copy cannot be named so.')
    return ref.name
  }
  return safeName(ref.compareId, ref.slot)
}

/** Files and bytes the copy would hold, stopping as soon as either limit is passed. */
/** How much a copy may hold; a test passes smaller ones rather than writing 20,000 files. */
export interface CopyLimits {
  readonly files: number
  readonly bytes: number
}
const LIMITS: CopyLimits = { files: MAX_COPY_FILES, bytes: MAX_COPY_BYTES }
const tooBig = (limits: CopyLimits): string => `more than ${limits.files.toLocaleString('en-US')} files or ${String(Math.round(limits.bytes / (1024 * 1024)))} MB`

async function measure(folder: string, limits: CopyLimits): Promise<{ files: number; bytes: number; over: boolean }> {
  let files = 0
  let bytes = 0
  const walk = async (directory: string): Promise<boolean> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (LEFT_OUT.has(entry.name)) continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!(await walk(path))) return false
      } else if (entry.isFile()) {
        const size = (await stat(path)).size
        if (size > MAX_COPIED_FILE_BYTES) continue
        files += 1
        bytes += size
        if (files > limits.files || bytes > limits.bytes) return false
      }
    }
    return true
  }
  const within = await walk(folder)
  return { files, bytes, over: !within }
}

/**
 * Why a comparison here cannot change files, BEFORE anything is sent -- or
 * undefined when the folder can be copied (0.457). The Compare menu was drawn
 * to grey Auto out with a reason and nothing ever gave it one, so a folder too
 * big to copy (Colin's `.claude`, 2026-09-29) took Auto, started two columns,
 * and both came back "could not start" with a Try again that could only fail
 * the same way.
 */
export async function copyRefusal(folder: string, limits: CopyLimits = LIMITS): Promise<string | undefined> {
  const size = await measure(resolve(folder), limits).catch(() => ({ over: true }))
  return size.over
    ? `This folder is too big to give each model its own copy (${tooBig(limits)}).`
    : undefined
}

/** The column's copy, made the first time and reused for its follow-ups. */
export async function makeCompareCopy(input: CopyRef & {
  readonly folder: string
  readonly root?: string
  readonly limits?: CopyLimits
}): Promise<string> {
  const root = input.root ?? compareRoot()
  const target = join(root, nameOf(input))
  const made = await lstat(target).then((found) => found.isDirectory(), () => false)
  if (made) return target
  const source = resolve(input.folder)
  const size = await measure(source, input.limits ?? LIMITS)
  if (size.over) {
    return Promise.reject(
      new Error(`It answers in a copy of the folder, and this folder is too big to copy (${tooBig(input.limits ?? LIMITS)}).`)
    )
  }
  await mkdir(root, { recursive: true })
  await cp(source, target, {
    recursive: true,
    errorOnExist: false,
    filter: async (from) => {
      const inside = relative(source, from)
      if (inside.length === 0) return true
      if (inside.split(sep).some((part) => LEFT_OUT.has(part))) return false
      const found = await lstat(from).catch(() => undefined)
      return found === undefined || !found.isFile() || found.size <= MAX_COPIED_FILE_BYTES
    }
  })
  // What each file was when copied (0.448): so Keep knows what the column
  // changed, and whether the person has since changed the same file.
  await writeFile(manifestPath(root, input), JSON.stringify(await hashTree(target)), 'utf8')
  return target
}

/** Beside the copy, never in it: a column must not find Locust's bookkeeping among its files. */
const manifestPath = (root: string, ref: CopyRef): string => join(root, `${nameOf(ref)}.manifest.json`)

const hashOf = async (path: string): Promise<string> => createHash('sha256').update(await readFile(path)).digest('hex')

/** Every file under a tree, by its path inside it (forward slashes), with its content's hash. */
async function hashTree(tree: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (LEFT_OUT.has(entry.name)) continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile() && (await stat(path)).size <= MAX_COPIED_FILE_BYTES) out[relative(tree, path).split(sep).join('/')] = await hashOf(path)
    }
  }
  await walk(tree)
  return out
}

/** What a column changed in its copy: new or changed files, and files it deleted. */
export interface CopyChanges {
  readonly changed: readonly string[]
  readonly deleted: readonly string[]
}

/**
 * A COMPARISON THAT EDITS, IN ANY FOLDER (0.448).
 *
 * 0.445 gave each column a git worktree, so comparing work needed a git
 * project -- and a new person's folder (Documents\Locust) is not one, which
 * left the Home starters Colin agreed to ("Make a landing page") with nowhere
 * clean to run. A column in a folder that is not a git project edits a plain
 * copy of it instead, and these read what it did against what it was given.
 */
export async function copyChanges(input: CopyRef & { readonly root?: string }): Promise<CopyChanges> {
  const root = input.root ?? compareRoot()
  const target = join(root, nameOf(input))
  const before = JSON.parse(await readFile(manifestPath(root, input), 'utf8')) as Record<string, string>
  const now = await hashTree(target)
  const changed = Object.keys(now).filter((path) => before[path] !== now[path]).sort()
  const deleted = Object.keys(before).filter((path) => now[path] === undefined).sort()
  return { changed, deleted }
}

export type CopyBringIn =
  | { readonly kind: 'brought'; readonly files: readonly string[] }
  | { readonly kind: 'nothing' }
  | { readonly kind: 'your-changes'; readonly files: readonly string[] }

/**
 * Keep this one, from a copy: the column's changed files are written into the
 * folder and the ones it deleted are removed -- and nothing is, when the
 * person has since changed any of those same files themselves.
 */
export async function bringInCopy(input: CopyRef & { readonly folder: string; readonly root?: string }): Promise<CopyBringIn> {
  const root = input.root ?? compareRoot()
  const target = join(root, nameOf(input))
  const before = JSON.parse(await readFile(manifestPath(root, input), 'utf8')) as Record<string, string>
  const { changed, deleted } = await copyChanges(input)
  const touched = [...changed, ...deleted]
  if (touched.length === 0) return { kind: 'nothing' }
  const folder = resolve(input.folder)
  const inFolder = (path: string): string => {
    const full = resolve(folder, ...path.split('/'))
    if (full !== folder && !full.startsWith(folder + sep)) throw new Error('A copy named a file outside the folder.')
    return full
  }
  // The person's own changes since the copy was made: a file that is not as it was then.
  const yours: string[] = []
  for (const path of touched) {
    const current = await hashOf(inFolder(path)).catch(() => undefined)
    if (current !== before[path]) yours.push(path)
  }
  if (yours.length > 0) return { kind: 'your-changes', files: yours }
  for (const path of changed) {
    await mkdir(dirname(inFolder(path)), { recursive: true })
    await cp(join(target, ...path.split('/')), inFolder(path), { force: true })
  }
  for (const path of deleted) await rm(inFolder(path), { force: true })
  return { kind: 'brought', files: touched.sort() }
}

/** One named copy and its manifest (0.533). Nothing else under the root is touched. */
export async function removeNamedCopy(name: string, root: string = compareRoot()): Promise<void> {
  const safe = nameOf({ name })
  await rm(join(root, safe), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  await rm(join(root, `${safe}.manifest.json`), { force: true })
}

/** Every copy a comparison made. Nothing else under the root is touched. */
export async function removeCompareCopies(compareId: string, root: string = compareRoot()): Promise<void> {
  if (!/^cmp_[A-Za-z0-9]{1,40}$/.test(compareId)) return
  const names = await readdir(root).catch(() => [] as string[])
  for (const name of names) {
    // The copy and its manifest beside it.
    if (name.startsWith(`${compareId}-`)) await rm(join(root, name), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

/**
 * "+a -b in N files" for a copy, the way git counts it: each changed file
 * against the folder's, through `git diff --no-index --numstat`, which exits 1
 * when they differ (and says so on stdout). A file git cannot count adds a
 * file and no lines -- never a guessed number.
 */
export async function copyLineChanges(input: CopyRef & {
  readonly folder: string
  readonly root?: string
  readonly runGit: (args: readonly string[], cwd: string) => Promise<string>
}): Promise<{ readonly files: number; readonly added?: number; readonly removed?: number }> {
  const root = input.root ?? compareRoot()
  const target = join(root, nameOf(input))
  const { changed, deleted } = await copyChanges(input)
  let added = 0
  let removed = 0
  let counted = false
  const count = async (from: string, to: string): Promise<void> => {
    const printed = await input.runGit(['diff', '--no-index', '--numstat', '--no-color', '--no-ext-diff', '--', from, to], root).catch((error: unknown) => String((error as { stdout?: string }).stdout ?? ''))
    for (const line of printed.split(/\r?\n/)) {
      const [plus, minus] = line.split('\t')
      if (minus !== undefined) counted = true
      if (plus !== undefined && /^\d+$/.test(plus)) added += Number(plus)
      if (minus !== undefined && /^\d+$/.test(minus)) removed += Number(minus)
    }
  }
  // git reads a missing side as the null device, so a new or deleted file counts whole.
  const empty = process.platform === 'win32' ? 'NUL' : '/dev/null'
  for (const path of changed) {
    const mine = resolve(input.folder, ...path.split('/'))
    const there = await stat(mine).then(() => mine, () => empty)
    await count(there, join(target, ...path.split('/')))
  }
  for (const path of deleted) await count(resolve(input.folder, ...path.split('/')), empty)
  // Git counted nothing (not installed, or refused): the files, and no invented numbers.
  return counted ? { files: changed.length + deleted.length, added, removed } : { files: changed.length + deleted.length }
}
