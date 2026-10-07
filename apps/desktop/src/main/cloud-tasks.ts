/**
 * CLOUD TASKS (0.503): work handed to a runtime's own cloud, followed from
 * Locust, and brought home only when the person says so.
 *
 * Colin, 2026-09-30: "did we ever add the ability for cloud agents? ... maybe
 * we can include it in the dropdown where you select chat type?" -- they spend
 * the person's free cloud credits if they have them, and plan usage otherwise.
 *
 * MEASURED before this was written (docs/DESIGN-2026-09-30-cloud-and-finances.md):
 * Codex CLI 0.159's `codex cloud` sees only LEGACY Codex Cloud environments.
 * One made in the Codex app's new Codex Cloud is invisible to it ("no cloud
 * environments are available for this workspace"), and the app-server has no
 * way to list or start either. A Legacy environment is named after its GitHub
 * repository, `owner/repo`, and that name is accepted as `--env`. The first
 * task (task_e_6abd..., 2026-09-30) went PENDING -> READY in about a minute,
 * and `codex cloud diff` returned its change; nothing touched the machine.
 *
 * So: the environment is found by the folder's own GitHub remote, the task
 * runs on the branch the folder is on (as GitHub has it), and its change
 * stays in the cloud until Apply -- `codex cloud apply`, into this folder.
 */

import { lstat, open, rm } from 'node:fs/promises'
import { join } from 'node:path'

/** A command's result; `code` 0 is success. */
export interface Ran {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}
export type Runner = (args: readonly string[], cwd: string) => Promise<Ran>

/** `owner/repo` from a GitHub remote URL, https or ssh; undefined for anything else. */
export function githubRepoOf(remote: string): string | undefined {
  const url = remote.trim()
  const match = /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(url)
  return match === null ? undefined : `${match[1]}/${match[2]}`
}

export const TASK_URL = /https:\/\/chatgpt\.com\/codex\/tasks\/(task_[A-Za-z0-9_]+)/

export type CloudStartProblem =
  | { readonly kind: 'no-environment'; readonly repo: string }
  | { readonly kind: 'other'; readonly said: string }

/** What `codex cloud exec` answered: the task, or why there is none. */
export function startAnswer(ran: Ran, repo: string): { readonly ok: true; readonly taskId: string; readonly url: string } | { readonly ok: false; readonly problem: CloudStartProblem } {
  const said = `${ran.stdout}\n${ran.stderr}`
  const task = TASK_URL.exec(said)
  if (task !== null) return { ok: true, taskId: task[1]!, url: task[0] }
  if (/no cloud environments are available|environment '.*' not found/i.test(said)) return { ok: false, problem: { kind: 'no-environment', repo } }
  const line = said.split(/\r?\n/).map((part) => part.trim()).filter((part) => part.length > 0 && !/unrecognized configuration|is ignored/i.test(part)).pop()
  return { ok: false, problem: { kind: 'other', said: (line ?? 'Codex did not say why.').slice(0, 300) } }
}

export type CloudState = 'pending' | 'ready' | 'failed' | 'applied' | 'unknown'

export interface CloudStatus {
  readonly state: CloudState
  readonly title: string | undefined
  readonly added: number | undefined
  readonly removed: number | undefined
  readonly files: number | undefined
}

/**
 * What `codex cloud status` printed, read into its parts. Three lines, as
 * Codex CLI 0.159 prints them:
 *
 *     [READY] Add farewell function to greet.js
 *     owner/repo  •  4m ago
 *     +9/-1 • 2 files
 *
 * (A first reading joined them into one line, and the counts were missed on
 * the real task: the parser reads each line for what it holds, so both shapes
 * are read the same.)
 */
export function statusAnswer(text: string): CloudStatus {
  const lines = text.split(/\r?\n/)
  const head = lines.find((part) => /^\s*\[[A-Z_]+\]/.test(part)) ?? ''
  const word = /^\s*\[([A-Z_]+)\]/.exec(head)?.[1]?.toLowerCase() ?? ''
  const state: CloudState = word === 'pending' || word === 'running' || word === 'queued' || word === 'in_progress'
    ? 'pending'
    : word === 'ready' || word === 'completed' || word === 'done'
      ? 'ready'
      : word === 'failed' || word === 'error' || word === 'cancelled'
        ? 'failed'
        : word === 'applied'
          ? 'applied'
          : 'unknown'
  const counts = /\+(\d+)\/-(\d+)\s*•\s*(\d+)\s+files?/.exec(text)
  // The title is the head line after its state, up to the repository when it shares the line.
  const rest = head.replace(/^\s*\[[A-Z_]+\]\s*/, '')
  const title = (/^(.+?)\s+[\w.-]+\/[\w.-]+\s{2,}/.exec(rest)?.[1] ?? rest).trim()
  return {
    state,
    title: title.length === 0 ? undefined : title,
    added: counts === null ? undefined : Number(counts[1]),
    removed: counts === null ? undefined : Number(counts[2]),
    files: counts === null ? undefined : Number(counts[3])
  }
}

export interface CloudTask {
  readonly taskId: string
  readonly url: string
  readonly runtime: 'codex'
  readonly repo: string
  readonly branch: string | undefined
  readonly prompt: string
  readonly folder: string
  readonly createdAt: string
  readonly teammateId?: string
  readonly status: CloudStatus
  readonly appliedAt?: string
}

/** Where the folder stands with GitHub: its repository, branch, and commits GitHub does not have. */
export interface FolderOnGitHub {
  readonly repo: string | undefined
  readonly branch: string | undefined
  /** Commits on this branch not on its upstream; undefined when there is no upstream. */
  readonly unpushed: number | undefined
  /** Uncommitted changes in the folder, which the cloud does not see. */
  readonly dirty: boolean
}

export async function folderOnGitHub(folder: string, git: Runner): Promise<FolderOnGitHub> {
  const remote = await git(['remote', 'get-url', 'origin'], folder).catch(() => undefined)
  const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], folder).catch(() => undefined)
  const ahead = await git(['rev-list', '--count', '@{u}..HEAD'], folder).catch(() => undefined)
  const status = await git(['status', '--porcelain'], folder).catch(() => undefined)
  const name = branch?.code === 0 ? branch.stdout.trim() : undefined
  return {
    repo: remote?.code === 0 ? githubRepoOf(remote.stdout) : undefined,
    branch: name === undefined || name === 'HEAD' || name.length === 0 ? undefined : name,
    unpushed: ahead?.code === 0 && /^\d+$/.test(ahead.stdout.trim()) ? Number(ahead.stdout.trim()) : undefined,
    dirty: status?.code === 0 ? status.stdout.trim().length > 0 : false
  }
}

/**
 * Whether Codex Cloud has an environment for `repo` -- asked before a task is
 * sent, not learned from its refusal (0.505). `codex cloud list --env <repo>`
 * is read-only: it lists that environment's tasks, or says it is not found.
 * MEASURED 2026-09-30: `automatedworkflowllc-design/locust-cloud-test` listed
 * its tasks (exit 0); `.../ai-teammate-platform` answered "environment ... not
 * found" (exit 1).
 */
export type CloudEnvironment = 'ready' | 'missing' | 'unknown'
export function environmentAnswer(ran: Ran): CloudEnvironment {
  if (ran.code === 0) return 'ready'
  return /environment '.*' not found|no cloud environments are available/i.test(`${ran.stderr}\n${ran.stdout}`) ? 'missing' : 'unknown'
}
export async function environmentOf(codex: Runner, repo: string, cwd: string): Promise<CloudEnvironment> {
  const ran = await codex(['cloud', 'list', '--env', repo, '--limit', '1'], cwd).catch(() => undefined)
  return ran === undefined ? 'unknown' : environmentAnswer(ran)
}

/** Said to the person when a cloud task cannot start, in their terms. */
export function refusalFor(problem: CloudStartProblem): string {
  return problem.kind === 'no-environment'
    ? `Codex Cloud has no environment for ${problem.repo} yet. In the Codex app, open Settings > Legacy Codex Cloud and create one for that repository, then send again.`
    : `Codex Cloud did not start the task: ${problem.said}`
}

/**
 * CODEX CLOUD LEAVES NO LOG IN THE FOLDER (0.681).
 *
 * `codex cloud` writes its debug log to `error.log` in the directory it runs
 * in -- startup, the ChatGPT account id, the GitHub origin it parsed. Locust
 * asks it whether a folder has a cloud environment on its own, whenever a
 * GitHub folder is open, so every such folder grew one. FOUND 2026-10-06 by
 * the first real pull request from Commit: it carried error.log beside the
 * one file the drive wrote. Colin's own repositories each had one, kept out
 * of git only because they ignore `*.log`.
 *
 * The call still runs in the folder (`apply` writes there, and `exec` reads
 * its origin), and afterwards error.log is as it was: removed if the call
 * made it, cut back to its old length if the call added to it -- and only
 * when what was added reads like Codex's own lines, so a log of the person's
 * that something else wrote meanwhile is never touched. One call per folder
 * at a time, so two calls never undo each other's measurement.
 */
const CODEX_LOG_LINE = /^\[\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})\] [a-z_]+: /
const queues = new Map<string, Promise<unknown>>()

/** More than this was added: not a few Codex lines, and left alone rather than read in part (Sol's review, 0.683). */
const MOST_CHECKED_BYTES = 1024 * 1024

/**
 * Takes back what Codex added to error.log -- every added byte read and found to be Codex's, the file a plain file
 * (never a link), and its size unchanged between the check and the cut. Sol's review of 0.681: the check read at
 * most 1 MiB and cut the whole tail, and checked through one handle then cut by path, so a line the person's own
 * program appended meanwhile, or a link swapped in, could be erased unread. Both are refused now: what is cut is
 * exactly what was read, through the handle that read it.
 */
async function takeBackCodexLines(path: string, before: number | undefined): Promise<void> {
  const link = await lstat(path).catch(() => undefined)
  if (link === undefined || !link.isFile()) return
  const from = before ?? 0
  const added = link.size - from
  if (added <= 0 || added > MOST_CHECKED_BYTES) return
  const handle = await open(path, 'r+').catch(() => undefined)
  if (handle === undefined) return
  let emptyNow = false
  try {
    const opened = await handle.stat()
    // The handle is on the file that was looked at, and it has not grown since.
    if (opened.ino !== link.ino || opened.size !== link.size) return
    const buffer = Buffer.alloc(added)
    const { bytesRead } = await handle.read(buffer, 0, added, from)
    if (bytesRead !== added) return
    const lines = buffer.toString('utf8').split(/\r?\n/).filter((line) => line.length > 0)
    if (lines.length === 0 || !lines.every((line) => CODEX_LOG_LINE.test(line))) return
    if ((await handle.stat()).size !== link.size) return
    await handle.truncate(from)
    emptyNow = before === undefined
  } finally {
    await handle.close()
  }
  // A file the call made, now empty and still nobody else's: gone, as it was before.
  if (emptyNow) {
    const left = await lstat(path).catch(() => undefined)
    if (left !== undefined && left.isFile() && left.ino === link.ino && left.size === 0) await rm(path, { force: true }).catch(() => undefined)
  }
}

export function leavingNoLog(run: Runner): Runner {
  return (args, cwd) => {
    const go = async (): Promise<Ran> => {
      const path = join(cwd, 'error.log')
      const before = await lstat(path).then((found) => (found.isFile() ? found.size : undefined), () => undefined)
      try {
        return await run(args, cwd)
      } finally {
        await takeBackCodexLines(path, before).catch(() => undefined)
      }
    }
    const previous = queues.get(cwd) ?? Promise.resolve()
    const next = previous.then(go, go)
    queues.set(cwd, next.catch(() => undefined))
    return next
  }
}

/** For a test: the log check, alone. */
export const readsLikeCodexLog = (text: string): boolean =>
  text.split(/\r?\n/).filter((line) => line.length > 0).every((line) => CODEX_LOG_LINE.test(line))
