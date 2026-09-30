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

/** Said to the person when a cloud task cannot start, in their terms. */
export function refusalFor(problem: CloudStartProblem): string {
  return problem.kind === 'no-environment'
    ? `Codex Cloud has no environment for ${problem.repo} yet. In the Codex app, open Settings > Legacy Codex Cloud and create one for that repository, then send again.`
    : `Codex Cloud did not start the task: ${problem.said}`
}
