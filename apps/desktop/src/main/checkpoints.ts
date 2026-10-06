import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'

import type { TurnUndoState } from '../shared/ipc.js'
import { ownGitArgs } from './git-guard.js'

/**
 * UNDO A TURN (0.674): the folder as it stood before a teammate's turn, kept
 * where only Locust looks, so the turn's changes can be taken back.
 *
 * Claude Code rewinds; Locust had nothing to rewind to -- "nothing in this
 * product snapshots a workspace" (CancellationCard). This keeps one: before a
 * run that may write and again after it, every file git would not ignore is
 * copied into a store of Locust's own, under the profile, never the person's
 * repository. A folder that is not a repository is kept the same way; the
 * store is git's object format, nothing more.
 *
 * Bytes, exactly. The files are hashed with `hash-object --no-filters` and
 * listed into a private index, never `git add`: no `.gitattributes` filter or
 * line-ending rule of the project runs or changes them (a CRLF file comes back
 * CRLF, measured 2026-10-06), and no program a repository names is started.
 *
 * Bounded, and honest about it: a file over MAX_KEPT_FILE_BYTES is not kept
 * (and named), and a folder past MAX_KEPT_FILES or MAX_KEPT_BYTES is not kept
 * at all, so a turn there says it cannot be undone rather than undoing part.
 *
 * Undo puts back what the turn changed, and only where the file is still as
 * the turn left it: one the person (or a later turn) changed since is left
 * alone and named. A file the turn made is removed; one it removed returns.
 */

export const MAX_KEPT_FILES = 20_000
export const MAX_KEPT_FILE_BYTES = 10 * 1024 * 1024
export const MAX_KEPT_BYTES = 300 * 1024 * 1024
/** How many turns a folder keeps a way back from; older ones are let go. */
export const KEPT_TURNS_PER_FOLDER = 60
const GIT_TIMEOUT_MS = 60_000
/** How many files' sizes and times are asked for at once. */
const STAT_BATCH = 128
/** A file kept within this of its last change is read again next time: its time may not show a second write. */
const RACY_MS = 2_000

interface KnownFile {
  readonly size: number
  readonly mtimeMs: number
  readonly hash: string
  readonly keptAt: number
}
const statCaches = new Map<string, Promise<Map<string, KnownFile>>>()
/** What each store last kept of each file, read once a session from beside the store. */
function statCache(store: string): Promise<Map<string, KnownFile>> {
  let cache = statCaches.get(store)
  if (cache === undefined) {
    cache = readFile(join(store, 'locust-kept.json'), 'utf8')
      .then((text) => new Map(Object.entries(JSON.parse(text) as Record<string, KnownFile>)))
      .catch(() => new Map<string, KnownFile>())
    statCaches.set(store, cache)
  }
  return cache
}
/** Written whole, of the files still there: a file gone from the folder is forgotten. */
async function saveStatCache(store: string, known: Map<string, KnownFile>, present: ReadonlySet<string>): Promise<void> {
  for (const path of [...known.keys()]) if (!present.has(path)) known.delete(path)
  await writeFile(join(store, 'locust-kept.json'), JSON.stringify(Object.fromEntries(known)), 'utf8').catch(() => undefined)
}

export type Checkpoint =
  | { readonly ok: true; readonly commit: string; readonly notKept: readonly string[] }
  | { readonly ok: false; readonly why: string }

export interface UndoResult {
  /** Files put back as they were before the turn (restored, or removed when the turn made them). */
  readonly restored: readonly string[]
  /** Files left alone, each with why. */
  readonly leftAlone: readonly { readonly path: string; readonly why: string }[]
}

export interface Checkpoints {
  /** The folder as it is now, kept. */
  take(workspace: string): Promise<Checkpoint>
  /** The paths that differ between two kept states, relative, with `/`. */
  changed(workspace: string, before: string, after: string): Promise<readonly string[]>
  /** Puts back what changed between `before` and `after`, where the file is still as `after` left it. */
  undo(workspace: string, before: string, after: string): Promise<UndoResult>
  /** Keeps `commit` from being let go, under `name` (a run's id), and lets the oldest go past the bound. */
  hold(workspace: string, name: string, commit: string): Promise<void>
}

export interface CheckpointOptions {
  /** Where the stores live: a folder in the profile. */
  readonly root: string
  /** Test seam: run git with this store and work tree; resolves stdout. */
  readonly runGit?: (args: readonly string[], options: { readonly input?: string; readonly env?: Readonly<Record<string, string>> }) => Promise<string>
}

function defaultRunGit(args: readonly string[], options: { readonly input?: string; readonly env?: Readonly<Record<string, string>> }): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = execFile(
      'git',
      ownGitArgs(['-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false', ...args]),
      { encoding: 'utf8', timeout: GIT_TIMEOUT_MS, maxBuffer: 256 * 1024 * 1024, windowsHide: true, env: { ...process.env, ...options.env } },
      (error, stdout) => (error ? reject(error) : resolvePromise(stdout))
    )
    if (options.input !== undefined) child.stdin?.end(options.input)
  })
}

/** A store per folder, named by the folder's path, so two folders never share one. */
export function storeFor(root: string, workspace: string): string {
  const key = createHash('sha256').update(resolve(workspace).toLowerCase(), 'utf8').digest('hex').slice(0, 32)
  return join(root, `${key}.git`)
}

/** A path the store names, inside the folder or not at all. */
function inside(workspace: string, relative: string): string | undefined {
  const root = resolve(workspace)
  const full = resolve(root, relative)
  return full === root || !full.startsWith(root + sep) ? undefined : full
}

export function createCheckpoints(options: CheckpointOptions): Checkpoints {
  const run = options.runGit ?? defaultRunGit
  const ready = new Map<string, Promise<void>>()
  const ensure = (store: string): Promise<void> => {
    let made = ready.get(store)
    if (made === undefined) {
      made = (async () => {
        await mkdir(dirname(store), { recursive: true })
        await run(['init', '-q', '--bare', store], {})
      })()
      ready.set(store, made)
      made.catch(() => ready.delete(store))
    }
    return made
  }
  const git = (store: string, workspace: string, args: readonly string[], extra: { readonly input?: string; readonly env?: Readonly<Record<string, string>> } = {}) =>
    run([`--git-dir=${store}`, `--work-tree=${resolve(workspace)}`, ...args], extra)

  return {
    async take(workspace) {
      const store = storeFor(options.root, workspace)
      try {
        await ensure(store)
        // What git would not ignore: the folder's own .gitignore and the person's global excludes apply.
        const listed = (await git(store, workspace, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter((path) => path.length > 0)
        if (listed.length > MAX_KEPT_FILES) return { ok: false, why: `This folder has more than ${MAX_KEPT_FILES.toLocaleString('en-US')} files, too many to keep a copy of before each turn.` }
        const kept: { readonly path: string; readonly size: number; readonly mtimeMs: number }[] = []
        const notKept: string[] = []
        let bytes = 0
        // Sizes and times read many at once: one after another, four thousand files took most of a second.
        const infos: ({ readonly size: number; readonly mtimeMs: number; readonly file: boolean } | undefined)[] = []
        for (let at = 0; at < listed.length; at += STAT_BATCH) {
          infos.push(...await Promise.all(listed.slice(at, at + STAT_BATCH).map(async (path) => {
            const full = inside(workspace, path)
            const info = full === undefined ? undefined : await lstat(full).catch(() => undefined)
            return info === undefined ? undefined : { size: info.size, mtimeMs: info.mtimeMs, file: info.isFile() }
          })))
        }
        for (const [at, path] of listed.entries()) {
          const info = infos[at]
          if (info === undefined || !info.file) continue
          if (info.size > MAX_KEPT_FILE_BYTES) {
            notKept.push(path)
            continue
          }
          bytes += info.size
          if (bytes > MAX_KEPT_BYTES) return { ok: false, why: `This folder holds more than ${String(MAX_KEPT_BYTES / 1024 / 1024)} MB of files, too much to keep a copy of before each turn.` }
          kept.push({ path, size: info.size, mtimeMs: info.mtimeMs })
        }
        const index = join(store, `index-${String(process.pid)}-${String(Date.now())}`)
        const env = { GIT_INDEX_FILE: index }
        try {
          if (kept.length > 0) {
            /*
             * Only what changed is read again (as git's own index does): a file whose size and time are
             * what they were when it was last kept is the same file. Every file was read whole on every
             * turn, and Locust's own checkout took 1.7 to 1.9 s a look (2026-10-06). A file changed
             * within RACY_MS of being kept is read again anyway: its time cannot tell two writes apart.
             */
            const known = await statCache(store)
            const now = Date.now()
            const fresh = kept.filter((file) => {
              const was = known.get(file.path)
              return was === undefined || was.size !== file.size || was.mtimeMs !== file.mtimeMs || was.keptAt - file.mtimeMs < RACY_MS
            })
            if (fresh.length > 0) {
              // Whole paths: hash-object reads them from where git stands, not from the work tree.
              const hashes = (await git(store, workspace, ['hash-object', '-w', '--no-filters', '--stdin-paths'], { input: `${fresh.map((file) => inside(workspace, file.path)!).join('\n')}\n` })).trim().split('\n')
              if (hashes.length !== fresh.length) return { ok: false, why: 'The copy of this folder could not be made.' }
              fresh.forEach((file, at) => known.set(file.path, { size: file.size, mtimeMs: file.mtimeMs, hash: hashes[at]!, keptAt: now }))
            }
            const entries = kept.map((file) => `100644 ${known.get(file.path)!.hash}\t${file.path}`).join('\n')
            await git(store, workspace, ['update-index', '--add', '--index-info'], { input: `${entries}\n`, env })
            if (fresh.length > 0) await saveStatCache(store, known, new Set(kept.map((file) => file.path)))
          }
          const tree = kept.length === 0 ? (await git(store, workspace, ['mktree'], { input: '' })).trim() : (await git(store, workspace, ['write-tree'], { env })).trim()
          const commit = (await git(store, workspace, ['commit-tree', tree, '-m', 'locust'], {
            env: { GIT_AUTHOR_NAME: 'Locust', GIT_AUTHOR_EMAIL: 'locust@localhost', GIT_COMMITTER_NAME: 'Locust', GIT_COMMITTER_EMAIL: 'locust@localhost' }
          })).trim()
          return { ok: true, commit, notKept }
        } finally {
          await rm(index, { force: true }).catch(() => undefined)
        }
      } catch (error) {
        if (process.env.LOCUST_DEBUG_CHECKPOINTS === '1') console.error('checkpoint failed', error)
        return { ok: false, why: 'Locust could not keep a copy of this folder (it needs Git).' }
      }
    },

    async changed(workspace, before, after) {
      const store = storeFor(options.root, workspace)
      const out = await git(store, workspace, ['diff-tree', '-r', '--no-renames', '--name-only', '-z', before, after])
      return out.split('\0').filter((path) => path.length > 0)
    },

    async undo(workspace, before, after) {
      const store = storeFor(options.root, workspace)
      const paths = await this.changed(workspace, before, after)
      const blobAt = async (commit: string, path: string): Promise<string | undefined> => {
        const line = (await git(store, workspace, ['ls-tree', '-z', commit, '--', path])).split('\0')[0] ?? ''
        const match = /^\d+ blob ([0-9a-f]{40,64})\t/.exec(line)
        return match?.[1]
      }
      const restored: string[] = []
      const leftAlone: { path: string; why: string }[] = []
      for (const path of paths) {
        const full = inside(workspace, path)
        if (full === undefined) {
          leftAlone.push({ path, why: 'outside this folder' })
          continue
        }
        const turnLeft = await blobAt(after, path)
        const wasBefore = await blobAt(before, path)
        const info = await lstat(full).catch(() => undefined)
        const now = info?.isFile() === true
          ? (await git(store, workspace, ['hash-object', '--no-filters', '--', full])).trim()
          : undefined
        if (now !== turnLeft) {
          leftAlone.push({ path, why: now === undefined ? 'removed since the turn' : 'changed since the turn' })
          continue
        }
        if (wasBefore === undefined) {
          await rm(full, { force: true })
        } else {
          const bytes = await new Promise<Buffer>((resolvePromise, reject) => {
            execFile('git', ownGitArgs([`--git-dir=${store}`, 'cat-file', 'blob', wasBefore]), { encoding: 'buffer', maxBuffer: MAX_KEPT_FILE_BYTES * 2, windowsHide: true }, (error, stdout) => (error ? reject(error) : resolvePromise(stdout)))
          })
          await mkdir(dirname(full), { recursive: true })
          await writeFile(full, bytes)
        }
        restored.push(path)
      }
      return { restored, leftAlone }
    },

    async hold(workspace, name, commit) {
      const store = storeFor(options.root, workspace)
      const safe = name.replace(/[^A-Za-z0-9_-]/g, '_')
      await git(store, workspace, ['update-ref', `refs/turns/${safe}`, commit])
      const refs = (await git(store, workspace, ['for-each-ref', '--sort=committerdate', '--format=%(refname)', 'refs/turns/'])).split('\n').filter((ref) => ref.length > 0)
      if (refs.length <= KEPT_TURNS_PER_FOLDER * 2) return
      for (const ref of refs.slice(0, refs.length - KEPT_TURNS_PER_FOLDER * 2)) await git(store, workspace, ['update-ref', '-d', ref])
      await git(store, workspace, ['prune', '--expire=now']).catch(() => undefined)
    }
  }
}

/** What Locust kept of one turn: the folder before it and after it. */
export interface TurnRecord {
  readonly workspace: string
  readonly before: string
  readonly after: string
  readonly at: string
  /** Files too large to keep: an undo cannot put these back. */
  readonly notKept: readonly string[]
  /** Another run was writing in the same folder: what changed cannot be told apart, so it is not undone. */
  readonly shared?: true
  readonly undone?: { readonly at: string } & UndoResult
}


export interface TurnRecords {
  put(runId: string, record: TurnRecord): Promise<void>
  get(runId: string): Promise<TurnRecord | undefined>
  state(runId: string, checkpoints: Checkpoints): Promise<TurnUndoState>
  undo(runId: string, checkpoints: Checkpoints, now: () => Date): Promise<TurnUndoState>
}

/** One small file in the profile, keyed by run, written whole after each change. */
export function createTurnRecords(file: string): TurnRecords {
  let cache: Record<string, TurnRecord> | undefined
  let writing: Promise<void> = Promise.resolve()
  const load = async (): Promise<Record<string, TurnRecord>> => {
    if (cache === undefined) {
      try {
        cache = JSON.parse(await readFile(file, 'utf8')) as Record<string, TurnRecord>
      } catch {
        cache = {}
      }
    }
    return cache
  }
  const save = (all: Record<string, TurnRecord>): Promise<void> => {
    writing = writing.then(async () => {
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, JSON.stringify(all), 'utf8')
    }, () => undefined)
    return writing
  }
  const records: TurnRecords = {
    async put(runId, record) {
      const all = await load()
      all[runId] = record
      await save(all)
    },
    async get(runId) {
      return (await load())[runId]
    },
    async state(runId, checkpoints) {
      const record = await records.get(runId)
      if (record === undefined) return { kind: 'none' }
      if (record.undone !== undefined) return { kind: 'undone', at: record.undone.at, restored: record.undone.restored, leftAlone: record.undone.leftAlone }
      if (record.shared === true) return { kind: 'shared' }
      const files = (await checkpoints.changed(record.workspace, record.before, record.after).catch(() => [])).length
      return files === 0 ? { kind: 'none' } : { kind: 'ready', files, notKept: record.notKept }
    },
    async undo(runId, checkpoints, now) {
      const record = await records.get(runId)
      if (record === undefined || record.shared === true || record.undone !== undefined) return records.state(runId, checkpoints)
      const result = await checkpoints.undo(record.workspace, record.before, record.after)
      const undone = { at: now().toISOString(), ...result }
      await records.put(runId, { ...record, undone })
      return { kind: 'undone', at: undone.at, restored: undone.restored, leftAlone: undone.leftAlone }
    }
  }
  return records
}
