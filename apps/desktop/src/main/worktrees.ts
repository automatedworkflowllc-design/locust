import { execFile } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { appendFile, mkdir, readFile, realpath, rm, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'

import { releaseProcessTree } from '@teammate/runtime-adapters'

import { BRANCH_PREFIX, branchNameFor, distinctBranchNameFor } from '../shared/worktree-name.js'
import { ownGitArgs } from './git-guard.js'

/**
 * A worktree per teammate (docs/WORKTREES-DESIGN-2026-09-05.md).
 *
 * Two teammates editing one folder collide; Claude Code and Cursor give an
 * agent its own git worktree so they do not. Here a teammate with "Own
 * branch" on works in `<folder>/.locust/worktrees/<teammate-id>/`, a
 * worktree of the folder's repository on branch `locust/<name>`, created
 * from HEAD the first time it runs. Inside the folder so that "missions are
 * per folder" stays true: history, memory and LOCUST.md are the folder's,
 * whichever tree the run happened in.
 *
 * Locust never merges. Bringing a branch back is the person's git
 * operation. Every git call here is a child process with a timeout and a
 * bounded output, refused with a reason rather than guessed at: a folder
 * that is not a repository, a git older than 2.5, a path that would land
 * outside the folder.
 */

const GIT_TIMEOUT_MS = 20_000

/**
 * A folder's real spelling: symlinks and Windows short names resolved. git
 * prints real paths (`C:\Users\runneradmin\...`) and this manager compares
 * them with its own, so a folder given as `C:\Users\RUNNER~1\...` -- a hosted
 * runner's TEMP, measured 10/04 -- is taken by its real name once, here, and
 * every tree, listing and admin directory agrees with git from then on. A
 * folder that does not exist yet keeps its spelling; probe says so.
 */
function realSpelling(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    return path
  }
}

/** Whether two spellings name one folder: case, slashes and the real spelling of each. */
async function sameFolder(a: string, b: string): Promise<boolean> {
  const spell = async (path: string): Promise<string> => (await realpath(path).catch(() => path)).replace(/\\/g, '/').toLowerCase()
  return (await spell(a)) === (await spell(b))
}
/**
 * Making a tree checks out the whole project, which on Windows -- a scanner in
 * front of every file -- is not a twenty-second job for a big one. MEASURED
 * 2026-09-26 on a 30,000-file repository: well past twenty seconds.
 */
const WORKTREE_CHECKOUT_TIMEOUT_MS = 15 * 60_000
export const WORKTREE_DIR = join('.locust', 'worktrees')
export { BRANCH_PREFIX, branchNameFor, distinctBranchNameFor } from '../shared/worktree-name.js'

/** The branch git records for the worktree at `path` (`git worktree list --porcelain`), or '' when it records none. */
export function recordedBranchOf(porcelain: string, path: string): string {
  const same = (a: string): boolean => resolve(a).toLowerCase() === resolve(path).toLowerCase()
  for (const block of porcelain.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/)
    const at = lines.find((line) => line.startsWith('worktree '))?.slice('worktree '.length)
    if (at === undefined || !same(at)) continue
    const ref = lines.find((line) => line.startsWith('branch '))?.slice('branch '.length) ?? ''
    return ref.replace(/^refs\/heads\//, '')
  }
  return ''
}

export interface WorktreeInfo {
  readonly teammateId: string
  readonly path: string
  readonly branch: string
}

export interface WorktreeProbe {
  readonly repository: boolean
  readonly gitVersion: string | undefined
  readonly reason: string | undefined
}

export interface WorktreeManager {
  /** Whether worktrees can be made in this folder at all, and why not. */
  probe(): Promise<WorktreeProbe>
  /** The teammate's worktree path, creating it (and its branch) the first time. */
  ensure(teammate: { readonly teammateId: string; readonly name: string }): Promise<string>
  /** Every Locust-made worktree git still knows about. */
  list(): Promise<readonly WorktreeInfo[]>
  /**
   * Remove a teammate's worktree. The branch stays: the work is theirs to
   * merge or drop.
   *
   * C1 (the code review's one critical): this ran `git worktree remove
   * --force`, which deletes every uncommitted and untracked file in the
   * teammate's copy -- and nothing in Locust commits, so that was all of
   * their work -- on one click, under "Removing one keeps its branch". Now a
   * copy with changes is refused with a `WorktreeHasChangesError` naming
   * them, and is deleted only when `discard` lists exactly the changes that
   * are there now: what the person was shown and agreed to lose. A change
   * made after they were shown the list is refused again.
   */
  remove(teammateId: string, options?: { readonly discard?: readonly string[] }): Promise<void>
  /**
   * Commit what a turn left in the teammate's tree to its branch (0.439).
   * Locust's checkpoint, not the person's commit: `--no-verify`, unsigned,
   * authored by the teammate. New files over `CHECKPOINT_MAX_FILE_BYTES` stay
   * in the tree uncommitted and are named.
   */
  checkpoint(teammateId: string, message: CheckpointMessage): Promise<CheckpointResult>
  /** The branch against where it left the person's branch, and each turn on it (0.439). Reads only. */
  review(teammateId: string): Promise<BranchReview>
  /** One turn's change, by the sha `review` listed. Reads only. */
  turnDiff(teammateId: string, sha: string): Promise<string>
  /**
   * LAND IT (0.440): whether the branch can land on the person's branch now,
   * and the message a landing would carry. Reads only: every refusal a land
   * would meet is found here, before anything is touched.
   */
  landPreview(teammate: { readonly teammateId: string; readonly name: string }): Promise<LandPreview>
  /**
   * Squash the branch onto the person's current branch, in their checkout, as
   * one commit of theirs -- their identity, their hooks. Refuses everything
   * `landPreview` refuses; a hook that refuses the commit puts the checkout
   * back as it was. Afterwards the teammate's branch starts from the landing.
   */
  land(teammate: { readonly teammateId: string; readonly name: string }, message: string): Promise<LandResult>
  /**
   * Begin merging the person's branch into the teammate's, in the teammate's
   * tree only, and name the files that conflict -- for the teammate to
   * resolve in a turn, whose checkpoint then commits the merge.
   */
  startResolving(teammateId: string): Promise<readonly string[]>
  /**
   * What a tree has changed since it was cut, saved or not (0.445: a
   * comparison column's foot). Counts lines as git does; a binary file adds
   * none.
   */
  changes(teammateId: string): Promise<TreeChanges>
  /**
   * Put a tree's changes into the person's folder, UNCOMMITTED (0.445: Keep
   * this one, in a comparison that edits). Exactly what a teammate editing
   * the folder directly would leave. Refused, with nothing changed, when the
   * person has changed a file it changes, or the folder moved on in a way it
   * no longer applies to.
   */
  bringIn(teammateId: string): Promise<BringInResult>
  /** Remove a tree and its branch, whatever is in it (0.445: a comparison's columns are Locust's alone). */
  discard(teammateId: string): Promise<void>
}

/** Why a branch cannot land now -- each said with what would change it. */
export interface TreeChanges {
  readonly files: number
  readonly added: number
  readonly removed: number
}

export type BringInResult =
  | { readonly kind: 'brought'; readonly files: readonly string[] }
  | { readonly kind: 'nothing' }
  | { readonly kind: 'your-changes'; readonly files: readonly string[] }
  | { readonly kind: 'does-not-apply'; readonly message: string }

/** "+12 -3 in 2 files" from `git diff --numstat`; binary files ("-") count as a file with no lines. */
export function treeChangesOf(numstat: string): TreeChanges {
  let files = 0
  let added = 0
  let removed = 0
  for (const line of numstat.split(/\r?\n/)) {
    const [plus, minus, path] = line.split('\t')
    if (path === undefined || path.length === 0) continue
    files += 1
    added += /^\d+$/.test(plus ?? '') ? Number(plus) : 0
    removed += /^\d+$/.test(minus ?? '') ? Number(minus) : 0
  }
  return { files, added, removed }
}

export type LandBlock =
  | { readonly kind: 'nothing' }
  | { readonly kind: 'detached' }
  | { readonly kind: 'old-git'; readonly version: string | undefined }
  | { readonly kind: 'unsaved'; readonly files: readonly string[] }
  | { readonly kind: 'markers'; readonly files: readonly string[] }
  | { readonly kind: 'your-changes'; readonly files: readonly string[] }
  | { readonly kind: 'conflicts'; readonly files: readonly string[] }
  | { readonly kind: 'merging' }

export interface LandPreview {
  readonly branch: string
  readonly onto: string | undefined
  readonly files: readonly string[]
  /** The message the landing commit would carry; the person may edit it. */
  readonly draft: string
  readonly block: LandBlock | undefined
}

export type LandResult =
  | { readonly kind: 'landed'; readonly sha: string; readonly onto: string; readonly files: readonly string[]; readonly branchReset: boolean }
  | { readonly kind: 'blocked'; readonly block: LandBlock }
  /** The person's own commit hook (or git itself) refused; their checkout is as it was. */
  | { readonly kind: 'refused'; readonly message: string }

/** Landing checks conflicts with `merge-tree --write-tree`, new in git 2.38. */
export function gitVersionCanLand(version: string): boolean {
  const [major = 0, minor = 0] = version.split('.').map((part) => Number(part))
  return major > 2 || (major === 2 && minor >= 38)
}

/** The landing commit's message: the first ask, each turn after it, and who did the work on which route. */
export function landingDraft(input: {
  readonly name: string
  readonly subjects: readonly string[]
  readonly routes: readonly string[]
}): string {
  const [first = `${input.name}'s work`, ...rest] = input.subjects
  const body = rest.length === 0 ? '' : `\n\n${[first, ...rest].map((subject) => `- ${subject}`).join('\n')}`
  const routes = [...new Set(input.routes.map((route) => route.trim()).filter((route) => route.length > 0))]
  const trailers = [`Locust-Teammate: ${input.name}`, ...routes.map((route) => `Locust-Route: ${route}`)].join('\n')
  return `${first}${body}\n\n${trailers}`
}

/** GitHub warns at 50 MB and refuses at 100: a new file past this is left out of a checkpoint. */
export const CHECKPOINT_MAX_FILE_BYTES = 50 * 1024 * 1024
/** A review's whole diff is shown up to this; past it, turn by turn. */
export const REVIEW_MAX_DIFF_BYTES = 2 * 1024 * 1024
/** Never runs a program the repository's config names to draw a diff. */
const PLAIN_DIFF = ['--no-color', '--no-ext-diff', '--no-textconv'] as const

/**
 * What a comparison's copy counts and brings in: everything but what a TOOL
 * made (0.451). In Auto a column runs its code, and the first Auto drive
 * counted "+1 -1 in 2 files" for a one-line fix -- the second file was
 * `__pycache__/cart.cpython-314.pyc`, which Keep would have put in the
 * person's folder. Narrow on purpose: `dist/` or `build/` can be real source.
 */
export const NOT_BYPRODUCTS = [
  '.',
  ':(exclude,glob)**/__pycache__/**',
  ':(exclude,glob)**/*.pyc',
  ':(exclude,glob)**/.pytest_cache/**',
  ':(exclude,glob)**/.mypy_cache/**',
  ':(exclude,glob)**/.ruff_cache/**',
  ':(exclude,glob)**/node_modules/**'
] as const

export interface CheckpointMessage {
  readonly subject: string
  readonly body?: string
  readonly trailers: readonly (readonly [string, string])[]
  readonly author: { readonly name: string; readonly email: string }
}

export type CheckpointResult =
  | { readonly kind: 'clean' }
  | {
      readonly kind: 'committed'
      readonly sha: string
      readonly branch: string
      readonly files: readonly string[]
      readonly skipped: readonly { readonly path: string; readonly bytes: number }[]
      /** This commit finished a merge begun to resolve a conflict (0.440): `files` are what came in with it. */
      readonly mergeFinished?: true
      /** Files the commit holds with conflict markers still in them, which Land refuses (0.680). */
      readonly stillMarked?: readonly string[]
    }
  /** Only files too big to commit changed. */
  | { readonly kind: 'skipped'; readonly skipped: readonly { readonly path: string; readonly bytes: number }[] }

export interface BranchTurn {
  readonly sha: string
  readonly subject: string
  readonly at: string
  readonly files: readonly string[]
  /** A merge of the person's branch, finished by a turn that resolved it (0.440). */
  readonly merge?: true
}

export interface BranchReview {
  readonly branch: string
  /** The person's branch the teammate's is measured against, or undefined when their checkout is detached. */
  readonly against: string | undefined
  readonly base: string
  /** Oldest first. */
  readonly turns: readonly BranchTurn[]
  /** The whole change, base to branch; undefined past `REVIEW_MAX_DIFF_BYTES`. */
  readonly diff: string | undefined
  /** Changes in the tree no checkpoint holds yet: a turn running, or the person's own edits. */
  readonly uncommitted: readonly string[]
}

/** `git status --porcelain -z`, as `{ code, path }`; a rename's old name is skipped. */
export function statusEntriesOf(porcelainZ: string): readonly { readonly code: string; readonly path: string }[] {
  const parts = porcelainZ.split('\0')
  const out: { code: string; path: string }[] = []
  for (let i = 0; i < parts.length; i += 1) {
    const entry = parts[i] ?? ''
    if (entry.length < 4) continue
    const code = entry.slice(0, 2)
    out.push({ code, path: entry.slice(3) })
    if (code[0] === 'R' || code[0] === 'C') i += 1
  }
  return out
}

/** One record per commit: sha, subject, date, parents; then its files, one per line (`--name-only`). */
export const TURN_LOG_FORMAT = '--format=%x1e%H%x1f%s%x1f%aI%x1f%P'

/** `git log --name-only` in `TURN_LOG_FORMAT`, newest first as git gives it. */
export function branchTurnsOf(log: string): readonly BranchTurn[] {
  return log
    .split('\x1e')
    .map((record) => record.replace(/\r/g, '').trim())
    .filter((record) => record.length > 0)
    .map((record) => {
      const [head = '', ...rest] = record.split('\n')
      const [sha = '', subject = '', at = '', parents = ''] = head.split('\x1f')
      // A merge names no files of its own under --name-only; it is said as a merge instead.
      const merge = parents.trim().split(/\s+/).filter((parent) => parent.length > 0).length > 1
      return { sha, subject, at, files: rest.map((line) => line.trim()).filter((line) => line.length > 0), ...(merge ? { merge: true as const } : {}) }
    })
    .filter((turn) => /^[0-9a-f]{40}$/.test(turn.sha))
}

/** A teammate's copy still has uncommitted changes, so removing it would delete them. */
export class WorktreeHasChangesError extends Error {
  constructor(readonly changes: readonly string[]) {
    super(`It has ${String(changes.length)} uncommitted ${changes.length === 1 ? 'change' : 'changes'}, and removing it would delete ${changes.length === 1 ? 'it' : 'them'}.`)
    this.name = 'WorktreeHasChangesError'
  }
}

/** The paths `git status --porcelain` names, as the person will be shown them. */
export function changedPathsOf(porcelain: string): readonly string[] {
  return porcelain
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.length > 3)
    .map((line) => line.slice(3).replace(/^"(.*)"$/, '$1'))
}

export interface WorktreeManagerOptions {
  readonly workspacePath: string
  /**
   * Where under the folder its trees live: teammates' own branches in
   * `.locust/worktrees`, a comparison's columns in `.locust/compare` (0.445),
   * so neither list ever shows the other's.
   */
  readonly directory?: string
  /** Test seam: run git once; resolves stdout, rejects on a non-zero exit. */
  readonly runGit?: (args: readonly string[], cwd: string, timeoutMs?: number) => Promise<string>
}

/**
 * One git call, with a time limit that ends ALL of it.
 *
 * `execFile`'s own timeout kills the process it started and nothing under it.
 * On Windows that is Git's `cmd\git.exe` launcher, and a `worktree add` runs
 * its checkout in a further git process -- so MEASURED 2026-09-26 (30,000
 * files, the limit at 0.7 s): the call reported itself killed, and the
 * checkout went on in the background for another eighteen seconds and more,
 * 2,699 files to 26,500, holding the tree's index lock. Now the whole tree
 * ends, root last (once it is gone, taskkill cannot find the tree by it).
 */
export function defaultRunGit(args: readonly string[], cwd: string, timeoutMs = GIT_TIMEOUT_MS): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let timedOut = false
    const child = execFile('git', ownGitArgs(args), { cwd, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      clearTimeout(timer)
      if (timedOut) reject(new Error(`git ${args[0] ?? ''}: took longer than ${String(Math.round(timeoutMs / 1000))} s and was stopped.`))
      // With what it printed: `merge-tree` names its conflicts on stdout and exits 1 (0.440).
      else if (error) reject(Object.assign(new Error(`git ${args[0] ?? ''}: ${String(stderr || error.message).trim().slice(0, 300)}`), { stdout: String(stdout) }))
      else resolvePromise(stdout)
    })
    const timer = setTimeout(() => {
      timedOut = true
      if (process.platform === 'win32' && child.pid !== undefined) {
        void releaseProcessTree(child.pid).catch(() => false).finally(() => child.kill())
      } else {
        child.kill()
      }
    }, timeoutMs)
  })
}

/**
 * The directory git keeps a worktree's own state in, from its `.git` file --
 * and only if it is where git puts those, in the folder's own repository.
 * Anything else is not a tree this manager made, and nothing is done to it.
 */
async function adminDirectoryOf(gitFile: string, root: string): Promise<string | undefined> {
  const text = await readFile(gitFile, 'utf8').catch(() => undefined)
  const named = text?.match(/^gitdir:\s*(.+?)\s*$/m)?.[1]
  if (named === undefined) return undefined
  const admin = resolve(join(gitFile, '..'), named)
  const inside = relative(join(root, '.git', 'worktrees'), admin)
  return inside.length > 0 && !inside.startsWith('..') && !isAbsolute(inside) ? admin : undefined
}

/** Only a plain teammate id may name a directory under the folder. */
function safeTeammateDirectory(teammateId: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(teammateId)) throw new Error('That teammate id cannot name a worktree.')
  return teammateId
}

export function parseGitVersion(output: string): string | undefined {
  const match = /git version (\d+\.\d+(?:\.\d+)?)/.exec(output)
  return match?.[1]
}

export function gitVersionSupportsWorktrees(version: string): boolean {
  const [major = 0, minor = 0] = version.split('.').map((part) => Number(part))
  return major > 2 || (major === 2 && minor >= 5)
}

/** `git worktree list --porcelain`, kept to the trees Locust made under the folder. */
export function parseWorktreeList(output: string, root: string, directory: string = WORKTREE_DIR): readonly WorktreeInfo[] {
  const base = resolve(root, directory).replace(/\\/g, '/').toLowerCase()
  const out: WorktreeInfo[] = []
  let path: string | undefined
  let branch: string | undefined
  const flush = (): void => {
    if (path !== undefined) {
      const normal = path.replace(/\\/g, '/')
      if (normal.toLowerCase().startsWith(`${base}/`)) {
        const teammateId = normal.slice(base.length + 1).split('/')[0] ?? ''
        if (teammateId.length > 0) out.push({ teammateId, path: normal, branch: branch ?? '' })
      }
    }
    path = undefined
    branch = undefined
  }
  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      flush()
      path = line.slice('worktree '.length).trim()
    } else if (line.startsWith('branch ')) {
      branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '')
    } else if (line.trim().length === 0) {
      flush()
    }
  }
  flush()
  return out
}

export function createWorktreeManager(options: WorktreeManagerOptions): WorktreeManager {
  const root = realSpelling(resolve(options.workspacePath))
  const runGit = options.runGit ?? defaultRunGit
  const trees = options.directory ?? WORKTREE_DIR

  const probe = async (): Promise<WorktreeProbe> => {
    let gitVersion: string | undefined
    try {
      gitVersion = parseGitVersion(await runGit(['--version'], root))
    } catch {
      return { repository: false, gitVersion: undefined, reason: 'git was not found on this machine.' }
    }
    if (gitVersion !== undefined && !gitVersionSupportsWorktrees(gitVersion)) {
      return { repository: false, gitVersion, reason: `git ${gitVersion} is older than 2.5, which worktrees need.` }
    }
    try {
      const top = (await runGit(['rev-parse', '--show-toplevel'], root)).trim()
      if (await sameFolder(top, root) === false) {
        return { repository: false, gitVersion, reason: 'The project folder is inside a repository but is not its root. Own copies need the folder to be the repository root.' }
      }
    } catch {
      return { repository: false, gitVersion, reason: 'The project folder is not a git repository.' }
    }
    return { repository: true, gitVersion, reason: undefined }
  }

  /** `.locust/` is excluded through .git/info/exclude, never the person's .gitignore. */
  const excludeLocustDirectory = async (): Promise<void> => {
    const excludePath = join(root, '.git', 'info', 'exclude')
    let current = ''
    try {
      current = await readFile(excludePath, 'utf8')
    } catch {
      // No exclude file yet; one is made below.
    }
    if (current.split('\n').some((line) => line.trim() === '.locust/' || line.trim() === '/.locust/' || line.trim() === '.locust')) return
    await mkdir(join(root, '.git', 'info'), { recursive: true })
    await appendFile(excludePath, `${current.length > 0 && !current.endsWith('\n') ? '\n' : ''}.locust/\n`, 'utf8')
  }

  /** Trees whose `worktree add` is running in this process right now. */
  const making = new Set<string>()

  /**
   * Finish a tree whose making was cut short, keeping everything in it.
   *
   * What a `git worktree add` ended part-way leaves -- MEASURED 2026-09-26 on
   * a 30,000-file repository, ended 0.9 s in: its `.git` file (all this
   * manager used to check), 1,915 of the 30,000 files, no index -- so
   * `git status` reads all 30,000 as deleted, and a commit there would delete
   * the project on that branch -- a stale `index.lock` that fails every later
   * write, and git's own mark that the tree is not ready: `locked`,
   * "initializing". Handed to a teammate as it was.
   *
   * Finished rather than removed, because a tree an older build handed out
   * may already hold a teammate's work: the index is rebuilt from HEAD
   * without touching a file (`reset -q`), only files that are MISSING are
   * written (`checkout-index` without `-f` never overwrites one), and the
   * mark comes off. MEASURED on that same tree with a changed file and a new
   * one written into it: 28,085 files restored in 14.6 s, and `git status`
   * showed just those two, the changed file still changed.
   *
   * `checkout-index` exits 1 whenever any file already exists ("already
   * exists, no checkout"), even with `-q` -- which in a half-made tree is
   * always -- so its exit says nothing. What says it worked is that no file
   * the index names is missing afterwards.
   *
   * The lock file is removed only here -- git's mark says its add never
   * finished, and no add for this tree is running in this process -- and
   * only inside the repository's own `.git/worktrees` (`adminDirectoryOf`).
   */
  const finishMaking = async (path: string, admin: string): Promise<void> => {
    await rm(join(admin, 'index.lock'), { force: true })
    await runGit(['reset', '-q'], path, WORKTREE_CHECKOUT_TIMEOUT_MS)
    await runGit(['checkout-index', '-a', '-q'], path, WORKTREE_CHECKOUT_TIMEOUT_MS).catch(() => '')
    const missing = (await runGit(['ls-files', '--deleted'], path, WORKTREE_CHECKOUT_TIMEOUT_MS)).trim()
    if (missing.length > 0) {
      throw new Error('This teammate\'s own branch was left half-made, and Locust could not finish it. Remove it on the Worktrees screen and it will be made again.')
    }
    await runGit(['worktree', 'unlock', path], root)
  }

  return {
    probe,

    async ensure(teammate) {
      const directory = safeTeammateDirectory(teammate.teammateId)
      const path = resolve(root, trees, directory)
      // Already a worktree here (a worktree's .git is a file) -- but only one
      // git FINISHED making is used as it is (code review B4, main-stores 3).
      let made = false
      try {
        made = (await stat(join(path, '.git'))).isFile()
      } catch {
        made = false // Not made yet.
      }
      if (made) {
        const admin = await adminDirectoryOf(join(path, '.git'), root)
        const lock = admin === undefined ? undefined : await readFile(join(admin, 'locked'), 'utf8').catch(() => undefined)
        if (admin === undefined || lock?.trim() !== 'initializing') return path
        if (making.has(path)) {
          throw new Error(`${teammate.name}'s own branch is still being made. A large project takes a while; try again in a minute.`)
        }
        await finishMaking(path, admin)
        return path
      }
      const ready = await probe()
      if (!ready.repository) throw new Error(ready.reason ?? 'Own copies are not available in this folder.')
      await mkdir(resolve(root, trees), { recursive: true })
      await excludeLocustDirectory()
      // M17: a name another teammate's tree already has checked out gets
      // this teammate's id on the end, rather than git's refusal.
      const named = branchNameFor(teammate.name, teammate.teammateId)
      const checkedOut = await runGit(['worktree', 'list', '--porcelain'], root)
        .then((listing) => listing.split(/\r?\n/).filter((line) => line.startsWith('branch ')).map((line) => line.slice('branch '.length).trim().replace(/^refs\/heads\//, '')))
        .catch(() => [] as string[])
      const branch = checkedOut.includes(named) ? distinctBranchNameFor(teammate.name, teammate.teammateId) : named
      let branchExists = false
      try {
        await runGit(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], root)
        branchExists = true
      } catch {
        branchExists = false
      }
      // The branch is created from HEAD; uncommitted work in the main checkout
      // is not copied, and the card says so.
      making.add(path)
      try {
        if (branchExists) await runGit(['worktree', 'add', path, branch], root, WORKTREE_CHECKOUT_TIMEOUT_MS)
        else await runGit(['worktree', 'add', '-b', branch, path, 'HEAD'], root, WORKTREE_CHECKOUT_TIMEOUT_MS)
      } finally {
        making.delete(path)
      }
      return path
    },

    async list() {
      try {
        return parseWorktreeList(await runGit(['worktree', 'list', '--porcelain'], root), root, trees)
      } catch {
        return []
      }
    },

    async remove(teammateId, options = {}) {
      const directory = safeTeammateDirectory(teammateId)
      const path = resolve(root, trees, directory)
      const changes = changedPathsOf(await runGit(['status', '--porcelain', '--untracked-files=all'], path))
      if (changes.length === 0) {
        // Clean: git's own remove, which refuses anything it would lose.
        await runGit(['worktree', 'remove', path], root)
        return
      }
      const agreed = new Set(options.discard ?? [])
      if (options.discard === undefined || changes.length !== agreed.size || changes.some((change) => !agreed.has(change))) {
        throw new WorktreeHasChangesError(changes)
      }
      await runGit(['worktree', 'remove', '--force', path], root)
    },

    async checkpoint(teammateId, message) {
      const path = await madeTree(teammateId)
      const entries = statusEntriesOf(await runGit(['status', '--porcelain', '-z', '--untracked-files=all'], path))
      // A merge begun to resolve a conflict (0.440) is finished by the turn that
      // resolved it -- even one that kept this branch's side and so changed nothing.
      const merging = await runGit(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], path).then(() => true, () => false)
      if (entries.length === 0 && !merging) return { kind: 'clean' }
      const skipped: { path: string; bytes: number }[] = []
      for (const entry of entries) {
        if (entry.code !== '??') continue
        const bytes = await stat(join(path, entry.path)).then((found) => found.size).catch(() => 0)
        if (bytes > CHECKPOINT_MAX_FILE_BYTES) skipped.push({ path: entry.path, bytes })
      }
      await runGit(['add', '-A'], path, WORKTREE_CHECKOUT_TIMEOUT_MS)
      if (skipped.length > 0) await runGit(['reset', '-q', '--', ...skipped.map((file) => file.path)], path)
      const files = (await runGit(['diff', '--cached', '--name-only', '-z'], path)).split('\0').filter((file) => file.length > 0)
      if (files.length === 0 && !merging) return skipped.length > 0 ? { kind: 'skipped', skipped } : { kind: 'clean' }
      // Unresolved files would be committed with their markers; Land refuses those, and says so.
      const trailers = message.trailers.map(([key, value]) => `${key}: ${value.replace(/\s+/g, ' ').trim()}`).join('\n')
      await runGit([
        '-c', `user.name=${message.author.name}`,
        '-c', `user.email=${message.author.email}`,
        '-c', 'commit.gpgsign=false',
        'commit', '--no-verify', '-q',
        '-m', message.subject,
        ...(message.body === undefined || message.body.trim().length === 0 ? [] : ['-m', message.body]),
        ...(trailers.length === 0 ? [] : ['-m', trailers])
      ], path, WORKTREE_CHECKOUT_TIMEOUT_MS)
      const sha = (await runGit(['rev-parse', 'HEAD'], path)).trim()
      const branch = (await runGit(['symbolic-ref', '--short', '-q', 'HEAD'], path).catch(() => '')).trim()
      // Land's own rule for an unresolved file (below), read off what was just committed: a turn that asked a
      // question instead of resolving left its markers in, and the merge is not ready however it was concluded.
      const stillMarked = merging && files.length > 0
        ? (await runGit(['grep', '-l', '-E', '-e', '^(<<<<<<<|>>>>>>>)( |$)', 'HEAD', '--', ...files], path).catch(() => ''))
            .split(/\r?\n/).map((line) => line.replace(/^HEAD:/, '').trim()).filter((line) => line.length > 0)
        : []
      return { kind: 'committed', sha, branch, files, skipped, ...(merging ? { mergeFinished: true } : {}), ...(stillMarked.length === 0 ? {} : { stillMarked }) }
    },

    async review(teammateId) {
      const path = await madeTree(teammateId)
      const branch = (await runGit(['symbolic-ref', '--short', '-q', 'HEAD'], path)).trim()
      const against = (await runGit(['symbolic-ref', '--short', '-q', 'HEAD'], root).catch(() => '')).trim()
      const base = (await runGit(['merge-base', 'HEAD', branch], root)).trim()
      const turns = branchTurnsOf(await runGit(['log', '--name-only', TURN_LOG_FORMAT, `${base}..${branch}`], root)).slice().reverse()
      const diff = await runGit(['diff', ...PLAIN_DIFF, base, branch], root)
        .then((text) => (Buffer.byteLength(text, 'utf8') > REVIEW_MAX_DIFF_BYTES ? undefined : text))
        .catch(() => undefined)
      const uncommitted = statusEntriesOf(await runGit(['status', '--porcelain', '-z', '--untracked-files=all'], path)).map((entry) => entry.path)
      return { branch, against: against.length > 0 ? against : undefined, base, turns, diff, uncommitted }
    },

    async turnDiff(teammateId, sha) {
      if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('That is not a turn on this branch.')
      const path = await madeTree(teammateId)
      const branch = (await runGit(['symbolic-ref', '--short', '-q', 'HEAD'], path)).trim()
      // Only a turn of the teammate's -- after where it left the person's branch -- never another object.
      const base = (await runGit(['merge-base', 'HEAD', branch], root)).trim()
      const turns = (await runGit(['rev-list', `${base}..${branch}`], root)).split(/\r?\n/).map((line) => line.trim())
      if (!turns.includes(sha)) throw new Error('That is not a turn on this branch.')
      return runGit(['show', ...PLAIN_DIFF, '--format=', sha], root)
    },

    async landPreview(teammate) {
      return (await gatherLanding(teammate)).preview
    },

    async land(teammate, message) {
      const { preview, path } = await gatherLanding(teammate)
      if (preview.block !== undefined || preview.onto === undefined) return { kind: 'blocked', block: preview.block ?? { kind: 'detached' } }
      const text = message.trim().length > 0 ? message.trim() : preview.draft
      // Staged in the person's checkout, then committed as theirs: their
      // identity and their hooks. Nothing of theirs is touched -- the preview
      // refused any file they have changed that this landing writes.
      const putBack = async (): Promise<void> => {
        await runGit(['reset', '-q', '--merge', 'HEAD'], root).catch(() => '')
        await rm(join(root, '.git', 'SQUASH_MSG'), { force: true }).catch(() => undefined)
      }
      try {
        await runGit(['merge', '--squash', preview.branch], root, WORKTREE_CHECKOUT_TIMEOUT_MS)
      } catch (error) {
        await putBack()
        return { kind: 'refused', message: `git could not stage the landing: ${error instanceof Error ? error.message : 'no reason given'}` }
      }
      try {
        await runGit(['commit', '-q', '-m', text], root, WORKTREE_CHECKOUT_TIMEOUT_MS)
      } catch (error) {
        await putBack()
        const said = error instanceof Error ? error.message : ''
        return {
          kind: 'refused',
          message: /tell me who you are|user\.email|user\.name/i.test(said)
            ? 'git does not know your name and email yet, so it cannot make the commit as you. Set them with git config user.name and user.email, then land again.'
            : `Your commit hooks refused the landing commit: ${said.replace(/^git commit:\s*/, '')}`
        }
      }
      const sha = (await runGit(['rev-parse', 'HEAD'], root)).trim()
      // The teammate's next turn starts from what landed, so its next review is only what is new.
      const branchReset = await runGit(['reset', '-q', '--keep', sha], path).then(() => true, () => false)
      return { kind: 'landed', sha, onto: preview.onto, files: preview.files, branchReset }
    },

    async startResolving(teammateId) {
      const path = await madeTree(teammateId)
      const onto = (await runGit(['symbolic-ref', '--short', '-q', 'HEAD'], root)).trim()
      // Exits non-zero when it conflicts, which is the case this exists for.
      await runGit(['merge', '--no-ff', '--no-commit', onto], path, WORKTREE_CHECKOUT_TIMEOUT_MS).catch(() => '')
      return (await runGit(['diff', '--name-only', '-z', '--diff-filter=U'], path)).split('\0').filter((file) => file.length > 0)
    },

    async changes(teammateId) {
      const path = await madeTree(teammateId)
      // The tree's own index, which is Locust's: staging everything is what lets new files count.
      await runGit(['add', '-A'], path, WORKTREE_CHECKOUT_TIMEOUT_MS)
      const base = (await runGit(['merge-base', 'HEAD', (await runGit(['symbolic-ref', '--short', '-q', 'HEAD'], path)).trim()], root)).trim()
      return treeChangesOf(await runGit(['diff', ...PLAIN_DIFF, '--cached', '--numstat', base, '--', ...NOT_BYPRODUCTS], path))
    },

    async bringIn(teammateId) {
      const path = await madeTree(teammateId)
      await runGit(['add', '-A'], path, WORKTREE_CHECKOUT_TIMEOUT_MS)
      const branch = (await runGit(['symbolic-ref', '--short', '-q', 'HEAD'], path)).trim()
      const base = (await runGit(['merge-base', 'HEAD', branch], root)).trim()
      // What it changed: from where it was cut to its tree as it stands, saved or not.
      const files = (await runGit(['diff', '--cached', '--name-only', '-z', base, '--', ...NOT_BYPRODUCTS], path)).split('\0').filter((file) => file.length > 0)
      if (files.length === 0) return { kind: 'nothing' }
      const touching = new Set(files)
      const yours = statusEntriesOf(await runGit(['status', '--porcelain', '-z', '--untracked-files=all'], root)).map((entry) => entry.path).filter((file) => touching.has(file))
      if (yours.length > 0) return { kind: 'your-changes', files: yours }
      // A patch file, not stdout: a big change must not meet a buffer limit.
      const patch = join(root, '.git', `locust-bring-in-${safeTeammateDirectory(teammateId)}.patch`)
      try {
        await runGit(['diff', ...PLAIN_DIFF, '--cached', '--binary', `--output=${patch}`, base, '--', ...NOT_BYPRODUCTS], path, WORKTREE_CHECKOUT_TIMEOUT_MS)
        try {
          await runGit(['apply', '--check', patch], root, WORKTREE_CHECKOUT_TIMEOUT_MS)
        } catch (error) {
          return { kind: 'does-not-apply', message: error instanceof Error ? error.message.replace(/^git apply:\s*/, '') : 'git did not say why.' }
        }
        await runGit(['apply', patch], root, WORKTREE_CHECKOUT_TIMEOUT_MS)
      } finally {
        await rm(patch, { force: true }).catch(() => undefined)
      }
      return { kind: 'brought', files }
    },

    async discard(teammateId) {
      const path = resolve(root, trees, safeTeammateDirectory(teammateId))
      /*
       * Its branch, from git's own record of the tree when the folder is already gone (0.676). Asked only of the
       * folder, a tree whose folder had been removed first answered nothing, and its branch stayed in the person's
       * repository: every comparison kept in a git project left two `locust/compare-...` branches behind.
       */
      const branch = await runGit(['symbolic-ref', '--short', '-q', 'HEAD'], path).then((out) => out.trim(), () => '')
        || await runGit(['worktree', 'list', '--porcelain'], root).then((out) => recordedBranchOf(out, path), () => '')
      await runGit(['worktree', 'remove', '--force', path], root).catch(async () => {
        // Not a tree git knows (half-made, or already gone): its folder, then git's own record.
        await rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined)
        await runGit(['worktree', 'prune'], root).catch(() => '')
      })
      if (branch.startsWith(BRANCH_PREFIX)) await runGit(['branch', '-D', branch], root).catch(() => '')
    }
  }

  /** Everything a landing needs to know, found without changing anything. */
  async function gatherLanding(teammate: { readonly teammateId: string; readonly name: string }): Promise<{ readonly preview: LandPreview; readonly path: string }> {
    const path = await madeTree(teammate.teammateId)
    const branch = (await runGit(['symbolic-ref', '--short', '-q', 'HEAD'], path)).trim()
    const ontoName = (await runGit(['symbolic-ref', '--short', '-q', 'HEAD'], root).catch(() => '')).trim()
    const onto = ontoName.length > 0 ? ontoName : undefined
    const base = (await runGit(['merge-base', 'HEAD', branch], root)).trim()
    const files = (await runGit(['diff', '--name-only', '-z', base, branch], root)).split('\0').filter((file) => file.length > 0)
    // The asks, not the merge a conflict needed: that is Locust's step, not the person's.
    const subjects = branchTurnsOf(await runGit(['log', '--name-only', TURN_LOG_FORMAT, `${base}..${branch}`], root)).filter((turn) => turn.merge !== true).map((turn) => turn.subject).reverse()
    const routes = (await runGit(['log', '--format=%(trailers:key=Locust-Route,valueonly,separator=%x0a)', `${base}..${branch}`], root).catch(() => '')).split(/\r?\n/)
    const draft = landingDraft({ name: teammate.name, subjects, routes })
    const preview = (block: LandBlock | undefined): { preview: LandPreview; path: string } => ({ preview: { branch, onto, files, draft, block }, path })

    const version = parseGitVersion(await runGit(['--version'], root).catch(() => ''))
    if (version === undefined || !gitVersionCanLand(version)) return preview({ kind: 'old-git', version })
    if (onto === undefined) return preview({ kind: 'detached' })
    const merging = await runGit(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], path).then(() => true, () => false)
    if (merging) return preview({ kind: 'merging' })
    const unsaved = statusEntriesOf(await runGit(['status', '--porcelain', '-z', '--untracked-files=all'], path)).map((entry) => entry.path)
    if (unsaved.length > 0) return preview({ kind: 'unsaved', files: unsaved })
    if (files.length === 0) return preview({ kind: 'nothing' })
    const marked = (await runGit(['grep', '-l', '-E', '-e', '^(<<<<<<<|>>>>>>>)( |$)', branch, '--', ...files], root).catch(() => ''))
      .split(/\r?\n/)
      .map((line) => line.trim().replace(new RegExp(`^${branch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`), ''))
      .filter((line) => line.length > 0)
    if (marked.length > 0) return preview({ kind: 'markers', files: marked })
    const touching = new Set(files)
    const yours = statusEntriesOf(await runGit(['status', '--porcelain', '-z', '--untracked-files=all'], root)).map((entry) => entry.path).filter((file) => touching.has(file))
    if (yours.length > 0) return preview({ kind: 'your-changes', files: yours })
    const conflicts = await runGit(['merge-tree', '--write-tree', '--name-only', '--no-messages', 'HEAD', branch], root).then(
      () => [] as string[],
      (error: unknown) => {
        const printed = (error as { stdout?: string }).stdout ?? ''
        const named = printed.split(/\r?\n/).slice(1).map((line) => line.trim()).filter((line) => line.length > 0)
        // No list means git failed for another reason: say so as a conflict it could not name.
        return named.length > 0 ? [...new Set(named)] : ['(git could not check for conflicts)']
      }
    )
    if (conflicts.length > 0) return preview({ kind: 'conflicts', files: conflicts })
    return preview(undefined)
  }

  /** A teammate's tree that git finished making, or a refusal that says so. */
  async function madeTree(teammateId: string): Promise<string> {
    const path = resolve(root, trees, safeTeammateDirectory(teammateId))
    const made = await stat(join(path, '.git')).then((found) => found.isFile()).catch(() => false)
    if (!made) throw new Error('This teammate has no own branch in this folder.')
    // A half-made tree reads every file as deleted: committing it would delete the project on its branch.
    const admin = await adminDirectoryOf(join(path, '.git'), root)
    const lock = admin === undefined ? undefined : await readFile(join(admin, 'locked'), 'utf8').catch(() => undefined)
    if (admin === undefined || lock?.trim() === 'initializing' || making.has(path)) {
      throw new Error('This teammate\'s own branch is not finished being made.')
    }
    return path
  }
}
