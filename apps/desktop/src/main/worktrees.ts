import { execFile } from 'node:child_process'
import { appendFile, mkdir, readFile, rm, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'

import { releaseProcessTree } from '@teammate/runtime-adapters'

import { branchNameFor, distinctBranchNameFor } from '../shared/worktree-name.js'
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
 * Making a tree checks out the whole project, which on Windows -- a scanner in
 * front of every file -- is not a twenty-second job for a big one. MEASURED
 * 2026-09-26 on a 30,000-file repository: well past twenty seconds.
 */
const WORKTREE_CHECKOUT_TIMEOUT_MS = 15 * 60_000
export const WORKTREE_DIR = join('.locust', 'worktrees')
export { BRANCH_PREFIX, branchNameFor, distinctBranchNameFor } from '../shared/worktree-name.js'

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
}

/** GitHub warns at 50 MB and refuses at 100: a new file past this is left out of a checkpoint. */
export const CHECKPOINT_MAX_FILE_BYTES = 50 * 1024 * 1024
/** A review's whole diff is shown up to this; past it, turn by turn. */
export const REVIEW_MAX_DIFF_BYTES = 2 * 1024 * 1024
/** Never runs a program the repository's config names to draw a diff. */
const PLAIN_DIFF = ['--no-color', '--no-ext-diff', '--no-textconv'] as const

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
    }
  /** Only files too big to commit changed. */
  | { readonly kind: 'skipped'; readonly skipped: readonly { readonly path: string; readonly bytes: number }[] }

export interface BranchTurn {
  readonly sha: string
  readonly subject: string
  readonly at: string
  readonly files: readonly string[]
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

/** `git log --name-only --format=%x1e%H%x1f%s%x1f%aI`, newest first as git gives it. */
export function branchTurnsOf(log: string): readonly BranchTurn[] {
  return log
    .split('\x1e')
    .map((record) => record.replace(/\r/g, '').trim())
    .filter((record) => record.length > 0)
    .map((record) => {
      const [head = '', ...rest] = record.split('\n')
      const [sha = '', subject = '', at = ''] = head.split('\x1f')
      return { sha, subject, at, files: rest.map((line) => line.trim()).filter((line) => line.length > 0) }
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
      else if (error) reject(new Error(`git ${args[0] ?? ''}: ${String(stderr || error.message).trim().slice(0, 300)}`))
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
export function parseWorktreeList(output: string, root: string): readonly WorktreeInfo[] {
  const base = resolve(root, WORKTREE_DIR).replace(/\\/g, '/').toLowerCase()
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
  const root = resolve(options.workspacePath)
  const runGit = options.runGit ?? defaultRunGit

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
      const top = (await runGit(['rev-parse', '--show-toplevel'], root)).trim().replace(/\\/g, '/')
      if (top.toLowerCase() !== root.replace(/\\/g, '/').toLowerCase()) {
        return { repository: false, gitVersion, reason: 'The project folder is inside a repository but is not its root. Own branches need the folder to be the repository root.' }
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
      const path = join(root, WORKTREE_DIR, directory)
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
      if (!ready.repository) throw new Error(ready.reason ?? 'Own branches are not available in this folder.')
      await mkdir(join(root, WORKTREE_DIR), { recursive: true })
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
        return parseWorktreeList(await runGit(['worktree', 'list', '--porcelain'], root), root)
      } catch {
        return []
      }
    },

    async remove(teammateId, options = {}) {
      const directory = safeTeammateDirectory(teammateId)
      const path = join(root, WORKTREE_DIR, directory)
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
      if (entries.length === 0) return { kind: 'clean' }
      const skipped: { path: string; bytes: number }[] = []
      for (const entry of entries) {
        if (entry.code !== '??') continue
        const bytes = await stat(join(path, entry.path)).then((found) => found.size).catch(() => 0)
        if (bytes > CHECKPOINT_MAX_FILE_BYTES) skipped.push({ path: entry.path, bytes })
      }
      await runGit(['add', '-A'], path, WORKTREE_CHECKOUT_TIMEOUT_MS)
      if (skipped.length > 0) await runGit(['reset', '-q', '--', ...skipped.map((file) => file.path)], path)
      const files = (await runGit(['diff', '--cached', '--name-only', '-z'], path)).split('\0').filter((file) => file.length > 0)
      if (files.length === 0) return skipped.length > 0 ? { kind: 'skipped', skipped } : { kind: 'clean' }
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
      return { kind: 'committed', sha, branch, files, skipped }
    },

    async review(teammateId) {
      const path = await madeTree(teammateId)
      const branch = (await runGit(['symbolic-ref', '--short', '-q', 'HEAD'], path)).trim()
      const against = (await runGit(['symbolic-ref', '--short', '-q', 'HEAD'], root).catch(() => '')).trim()
      const base = (await runGit(['merge-base', 'HEAD', branch], root)).trim()
      const turns = branchTurnsOf(await runGit(['log', '--name-only', '--format=%x1e%H%x1f%s%x1f%aI', `${base}..${branch}`], root)).slice().reverse()
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
    }
  }

  /** A teammate's tree that git finished making, or a refusal that says so. */
  async function madeTree(teammateId: string): Promise<string> {
    const path = join(root, WORKTREE_DIR, safeTeammateDirectory(teammateId))
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
