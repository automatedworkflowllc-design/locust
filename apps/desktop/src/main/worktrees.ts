import { execFile } from 'node:child_process'
import { appendFile, mkdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

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
export const WORKTREE_DIR = join('.locust', 'worktrees')
export const BRANCH_PREFIX = 'locust/'

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
  /** Remove a teammate's worktree. The branch stays: the work is theirs to merge or drop. */
  remove(teammateId: string): Promise<void>
}

export interface WorktreeManagerOptions {
  readonly workspacePath: string
  /** Test seam: run git once; resolves stdout, rejects on a non-zero exit. */
  readonly runGit?: (args: readonly string[], cwd: string) => Promise<string>
}

function defaultRunGit(args: readonly string[], cwd: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile('git', [...args], { cwd, timeout: GIT_TIMEOUT_MS, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`git ${args[0] ?? ''}: ${String(stderr || error.message).trim().slice(0, 300)}`))
      else resolvePromise(stdout)
    })
  })
}

/** `locust/<name>`: the name lower-cased, anything git dislikes folded to a dash. */
export function branchNameFor(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .replace(/\.\.+/g, '.')
    .replace(/\.lock$/, '')
    .slice(0, 40)
  return `${BRANCH_PREFIX}${slug.length === 0 ? 'teammate' : slug}`
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

  return {
    probe,

    async ensure(teammate) {
      const directory = safeTeammateDirectory(teammate.teammateId)
      const path = join(root, WORKTREE_DIR, directory)
      // Already a worktree here: nothing to do. (A worktree's .git is a file.)
      try {
        const marker = await stat(join(path, '.git'))
        if (marker.isFile()) return path
      } catch {
        // Not made yet.
      }
      const ready = await probe()
      if (!ready.repository) throw new Error(ready.reason ?? 'Own branches are not available in this folder.')
      await mkdir(join(root, WORKTREE_DIR), { recursive: true })
      await excludeLocustDirectory()
      const branch = branchNameFor(teammate.name)
      let branchExists = false
      try {
        await runGit(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], root)
        branchExists = true
      } catch {
        branchExists = false
      }
      // The branch is created from HEAD; uncommitted work in the main checkout
      // is not copied, and the card says so.
      if (branchExists) await runGit(['worktree', 'add', path, branch], root)
      else await runGit(['worktree', 'add', '-b', branch, path, 'HEAD'], root)
      return path
    },

    async list() {
      try {
        return parseWorktreeList(await runGit(['worktree', 'list', '--porcelain'], root), root)
      } catch {
        return []
      }
    },

    async remove(teammateId) {
      const directory = safeTeammateDirectory(teammateId)
      const path = join(root, WORKTREE_DIR, directory)
      await runGit(['worktree', 'remove', '--force', path], root)
    }
  }
}
