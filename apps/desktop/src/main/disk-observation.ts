import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { toolPatchFrom } from '@teammate/runtime-adapters'
import type { NormalizedRuntimeEvent, ToolPatch } from '@teammate/runtime-adapters'

import { unifiedPatchText } from '../shared/approval-patch.js'

/**
 * What a run changed on disk, observed rather than reported.
 *
 * A runtime's event stream names the tools IT ran. It does not name the tools
 * its own sub-agents ran: OpenCode delegates through a `task` tool, and on
 * 2026-09-05 a free Muse Spark run changed `notes.ts` from draft to final
 * while the stream said `task` and `read` and the activity card said "2 tool
 * calls", neither an edit. The file on disk disagreed with the receipt, and
 * the receipt is what a person trusts.
 *
 * So for a run allowed to write, the host looks for itself: `git status`
 * before, `git status` after, and every path that differs and no tool event
 * named becomes an edit row marked as observed on disk. Runtime-agnostic --
 * whichever runtime hides an edit, this sees it -- and honest about what it
 * is: an observation of the working tree, not a claim about who wrote it.
 *
 * Git, because it is the one index of "what changed" that is already
 * maintained, already ignores build output, and already costs nothing to
 * ask. Outside a repository there is no cheap answer, so there is no
 * observation, and the row is simply absent rather than guessed.
 */

/** Path -> two-letter porcelain status (`M `, `??`, ` D`, ...). */
export type WorkspaceSnapshot = ReadonlyMap<string, string>

const GIT_TIMEOUT_MS = 5_000

export interface DiskObservationOptions {
  /** Test seam: run git once. Resolves with stdout, rejects when git is absent or the folder is not a repository. */
  readonly runGit?: (args: readonly string[], cwd: string) => Promise<string>
  /** Test seam: read a file's text; undefined when it cannot be read as text. */
  readonly readText?: (absolutePath: string) => Promise<string | undefined>
}

/** The most of a file the host will turn into a diff on the runtime's behalf. */
export const MAX_OBSERVED_FILE_BYTES = 64 * 1024

function defaultRunGit(args: readonly string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      [...args],
      { cwd, timeout: GIT_TIMEOUT_MS, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => {
        if (error) reject(Object.assign(error, { stdout: String(stdout ?? '') }))
        else resolve(stdout)
      }
    )
  })
}

/** `git status --porcelain -z`, parsed. Undefined when git cannot answer here. */
export async function snapshotWorkspace(
  workspacePath: string,
  options: DiskObservationOptions = {}
): Promise<WorkspaceSnapshot | undefined> {
  const runGit = options.runGit ?? defaultRunGit
  const readText = options.readText ?? defaultReadText
  let output: string
  try {
    output = await runGit(['status', '--porcelain', '-z', '--untracked-files=all'], workspacePath)
  } catch {
    return undefined
  }
  const snapshot = new Map(parsePorcelain(output))
  // An untracked file's status never changes while it stays untracked, so
  // an edit to one between two snapshots was invisible: the second turn of
  // a Codex CLI session appended to the file it made in the first and the
  // fold showed nothing (2026-09-05). Its text rides on the status, bounded.
  for (const [path, status] of snapshot) {
    if (status !== UNTRACKED) continue
    const text = await readText(join(workspacePath, path))
    if (text !== undefined) snapshot.set(path, UNTRACKED + TEXT_MARK + text)
  }
  return snapshot
}

const UNTRACKED = '??'
/** Separates an untracked entry's status from the text it carried; never a byte git prints. */
const TEXT_MARK = String.fromCharCode(1)

/** The two-letter status of a snapshot entry, whatever else it carries. */
export function statusOf(entry: string | undefined): string | undefined {
  return entry === undefined ? undefined : entry.slice(0, 2)
}

/** The text an untracked entry carried, or undefined. */
export function textOf(entry: string | undefined): string | undefined {
  if (entry === undefined) return undefined
  const at = entry.indexOf(TEXT_MARK)
  return at < 0 ? undefined : entry.slice(at + 1)
}

/**
 * The `-z` form: entries separated by NUL, each `XY<space>path`; a rename
 * carries a second NUL-separated path (the original) after it.
 */
export function parsePorcelain(output: string): WorkspaceSnapshot {
  const snapshot = new Map<string, string>()
  const entries = output.split('\0')
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!
    if (entry.length < 4) continue
    const status = entry.slice(0, 2)
    const path = entry.slice(3)
    snapshot.set(path, status)
    // R and C entries are followed by the source path as its own field.
    if (status[0] === 'R' || status[0] === 'C') index += 1
  }
  return snapshot
}

/** Paths whose status differs between the two snapshots, sorted. */
export function changedPaths(before: WorkspaceSnapshot, after: WorkspaceSnapshot): readonly string[] {
  const paths = new Set<string>()
  for (const [path, status] of after) {
    if (before.get(path) !== status) paths.add(path)
  }
  for (const path of before.keys()) {
    // Was dirty, now clean: something reverted or committed it. Still a
    // change to the working tree the run was in.
    if (!after.has(path)) paths.add(path)
  }
  return [...paths].sort()
}

/**
 * Which of the changed paths no tool event in this run already named. A
 * tool's `name` or `command` mentioning the path's last segment counts as
 * naming it -- the runtime told us, so the observation would be a duplicate.
 */
export function unreportedPaths(
  changed: readonly string[],
  events: readonly NormalizedRuntimeEvent[]
): readonly string[] {
  const named: string[] = []
  for (const event of events) {
    if (event.type !== 'tool.started' && event.type !== 'tool.completed' && event.type !== 'tool.failed') continue
    named.push(event.payload.name.toLowerCase())
    if (event.payload.command !== undefined) named.push(event.payload.command.toLowerCase())
  }
  return changed.filter((path) => {
    const tail = path.split('/').at(-1)!.toLowerCase()
    return !named.some((text) => text.includes(tail))
  })
}

/**
 * The rows. A started/completed pair per path so the thread draws them
 * the way it draws every other tool -- settled, with the path as the label
 * -- and `observed on disk` as the status so nobody reads them as the
 * runtime's own account.
 */
async function defaultReadText(absolutePath: string): Promise<string | undefined> {
  try {
    const bytes = await readFile(absolutePath)
    if (bytes.length > MAX_OBSERVED_FILE_BYTES) return undefined
    // A NUL byte is the cheap sign of a file that is not text.
    if (bytes.includes(0)) return undefined
    return bytes.toString('utf8')
  } catch {
    return undefined
  }
}

/**
 * The change behind each changed path, as a diff the fold can draw.
 *
 * Codex CLI's file_change item names its files and carries no diff, so a
 * whole session on that route showed "Codex CLI did not report the change"
 * beside every edit and never a line of what was written (seen driving the
 * app, 2026-09-05). Git knows: a tracked file's change is `git diff`, and
 * a new untracked file is its own contents as an add. A file git cannot
 * describe -- binary, too large, gone before it was read -- gets no patch,
 * and the row stays a path, as before.
 */
export async function observedPatches(
  workspacePath: string,
  after: WorkspaceSnapshot,
  paths: readonly string[],
  options: DiskObservationOptions = {},
  before?: WorkspaceSnapshot
): Promise<ReadonlyMap<string, ToolPatch>> {
  const runGit = options.runGit ?? defaultRunGit
  const readText = options.readText ?? defaultReadText
  const patches = new Map<string, ToolPatch>()
  for (const path of paths) {
    const entry = after.get(path)
    const status = statusOf(entry)
    try {
      if (status === UNTRACKED) {
        const text = textOf(entry) ?? (await readText(join(workspacePath, path)))
        if (text === undefined || text.length === 0) continue
        const earlier = textOf(before?.get(path))
        // Untracked before and after: the file was there and was changed.
        // Git will diff two texts it does not track; the header names temp
        // files, so it is rewritten to the path a person knows.
        const patch = earlier === undefined
          ? toolPatchFrom(unifiedPatchText([{ path, kind: 'add', movePath: undefined, diff: text }], undefined))
          : toolPatchFrom(await diffTexts(runGit, workspacePath, path, earlier, text))
        if (patch !== undefined) patches.set(path, patch)
        continue
      }
      // Tracked: the working tree against the index, then the index against
      // HEAD, so a change a runtime staged still shows.
      let unified = await runGit(['diff', '--no-color', '--no-ext-diff', '--', path], workspacePath)
      if (unified.trim().length === 0) unified = await runGit(['diff', '--no-color', '--no-ext-diff', '--cached', '--', path], workspacePath)
      const patch = toolPatchFrom(unified)
      if (patch !== undefined) patches.set(path, patch)
    } catch {
      // No patch for this one; the row keeps its path.
    }
  }
  return patches
}

/**
 * A unified diff between two texts, by git, headed with the path a person
 * knows. `git diff --no-index` exits 1 when the files differ, which the
 * plain runner treats as failure; the exit-1 output is the answer.
 */
async function diffTexts(
  runGit: (args: readonly string[], cwd: string) => Promise<string>,
  workspacePath: string,
  path: string,
  earlier: string,
  later: string
): Promise<string> {
  const { mkdtemp, rm, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const dir = await mkdtemp(join(tmpdir(), 'locust-observed-'))
  try {
    const a = join(dir, 'a')
    const b = join(dir, 'b')
    await writeFile(a, earlier, 'utf8')
    await writeFile(b, later, 'utf8')
    let out = ''
    try {
      out = await runGit(['diff', '--no-color', '--no-ext-diff', '--no-index', '--', a, b], workspacePath)
    } catch (error) {
      const stdout = (error as { stdout?: unknown }).stdout
      if (typeof stdout !== 'string' || stdout.length === 0) return ''
      out = stdout
    }
    // Everything before the first hunk is git's header for two temp files.
    const hunkAt = out.indexOf('\n@@')
    if (hunkAt < 0) return ''
    return `--- a/${path}\n+++ b/${path}${out.slice(hunkAt)}`
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

export function observedEditEvents(input: {
  readonly runId: string
  readonly missionId: string
  readonly sourceAdapter: NormalizedRuntimeEvent['sourceAdapter']
  /** The sequence the first synthetic event takes; the ledger requires them contiguous. */
  readonly nextSequence: number
  readonly paths: readonly string[]
  readonly at: string
  /** The change behind a path, when the host could read one. */
  readonly patches?: ReadonlyMap<string, ToolPatch>
  /**
   * Paths the runtime already named in a tool row of its own. Their events
   * say so in `status`, and the thread attaches the patch to that row
   * instead of drawing a second one.
   */
  readonly reported?: ReadonlySet<string>
}): NormalizedRuntimeEvent[] {
  const events: NormalizedRuntimeEvent[] = []
  let sequence = input.nextSequence
  input.paths.forEach((path, index) => {
    const itemId = `disk-observed-${String(index + 1)}`
    const base = {
      runId: input.runId,
      missionId: input.missionId,
      occurredAt: input.at,
      sourceAdapter: input.sourceAdapter
    }
    const payload = {
      itemId,
      // `edit` is what the thread classifies as an edit row; the path rides
      // on `command`, which is what the row shows as its label.
      toolKind: 'observed_edit',
      name: 'edit',
      command: path,
      status: input.reported?.has(path) === true ? 'reported by the runtime, read from disk' : 'observed on disk',
      evidence: { redacted: true as const }
    }
    const patch = input.patches?.get(path)
    events.push({
      ...base,
      id: `${input.runId}:disk:${String(sequence)}`,
      sequence,
      type: 'tool.started',
      payload: { ...payload, phase: 'started' as const }
    } as NormalizedRuntimeEvent)
    sequence += 1
    events.push({
      ...base,
      id: `${input.runId}:disk:${String(sequence)}`,
      sequence,
      type: 'tool.completed',
      payload: { ...payload, phase: 'completed' as const, ...(patch === undefined ? {} : { patch }) }
    } as NormalizedRuntimeEvent)
    sequence += 1
  })
  return events
}
