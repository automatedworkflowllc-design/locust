import { execFile } from 'node:child_process'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

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
}

function defaultRunGit(args: readonly string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      [...args],
      { cwd, timeout: GIT_TIMEOUT_MS, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => {
        if (error) reject(error)
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
  let output: string
  try {
    output = await runGit(['status', '--porcelain', '-z', '--untracked-files=all'], workspacePath)
  } catch {
    return undefined
  }
  return parsePorcelain(output)
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
export function observedEditEvents(input: {
  readonly runId: string
  readonly missionId: string
  readonly sourceAdapter: NormalizedRuntimeEvent['sourceAdapter']
  /** The sequence the first synthetic event takes; the ledger requires them contiguous. */
  readonly nextSequence: number
  readonly paths: readonly string[]
  readonly at: string
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
      status: 'observed on disk',
      evidence: { redacted: true as const }
    }
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
      payload: { ...payload, phase: 'completed' as const }
    } as NormalizedRuntimeEvent)
    sequence += 1
  })
  return events
}
