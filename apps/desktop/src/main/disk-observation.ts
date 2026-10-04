import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { redactSecrets, toolPatchFrom } from '@teammate/runtime-adapters'
import type { NormalizedRuntimeEvent, ToolPatch } from '@teammate/runtime-adapters'

import { unifiedPatchText } from '../shared/approval-patch.js'
import { reportsAChange } from '../shared/tool-kinds.js'
import { ownGitArgs } from './git-guard.js'

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
export type WorkspaceSnapshot = ReadonlyMap<string, string> & {
  /** The look stopped at a bound, so a change past it is not known (0.365). */
  readonly partial?: true
}

const GIT_TIMEOUT_MS = 5_000

export interface DiskObservationOptions {
  /** Test seam: run git once. Resolves with stdout, rejects when git is absent or the folder is not a repository. */
  readonly runGit?: (args: readonly string[], cwd: string) => Promise<string>
  /** Test seam: read a file's text; undefined when it cannot be read as text. */
  readonly readText?: (absolutePath: string) => Promise<string | undefined>
  /** Test seam: a file's size and modification time; undefined when it cannot be read. */
  readonly statOf?: (absolutePath: string) => Promise<{ readonly size: number; readonly mtimeMs: number } | undefined>
  /** Test seam: a folder's entries, for a folder git cannot answer for (0.365). */
  readonly listDirectory?: (directory: string) => Promise<readonly FolderEntry[]>
}

/** The most of a file the host will turn into a diff on the runtime's behalf. */
export const MAX_OBSERVED_FILE_BYTES = 64 * 1024
/*
 * M18 (the code review): bounds on what one snapshot reads. Every untracked
 * file was read whole, before the run and again after, with the 64 KB cap
 * checked only once the bytes were in memory -- a repo with node_modules
 * outside .gitignore made each Edit run wait seconds and hold tens of MB,
 * and an untracked dataset was read in full to be thrown away. Past these,
 * a file is looked at by size and time only: an edit to it is still seen,
 * without its text.
 */
/** Untracked files that carry their text. */
export const MAX_UNTRACKED_TEXTS = 400
/** The text those may carry between them. */
export const MAX_UNTRACKED_TEXT_BYTES = 4 * 1024 * 1024
/** Untracked files looked at at all; the rest are status only. */
export const MAX_UNTRACKED_LOOKED_AT = 5_000

function defaultRunGit(args: readonly string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ownGitArgs(args),
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
  let output: string
  try {
    output = await runGit(['status', '--porcelain', '-z', '--untracked-files=all'], workspacePath)
  } catch {
    // Not a repository, or no git on this machine at all -- which is the
    // ordinary case for someone who is not a coder, whose folder is just a
    // folder (0.365). Look at the folder itself instead.
    return snapshotFolder(workspacePath, options)
  }
  const statOf = options.statOf ?? defaultStatOf
  const snapshot = new Map(parsePorcelain(output))
  await carryUntracked(snapshot, workspacePath, options)
  /*
   * A TRACKED file that was already modified, and was modified again, kept
   * the same status -- ` M` before and after -- so the second edit was
   * invisible: no host record, no diff on its row ("did not report the
   * change"), and no check after it. Found driving the check-after-edits
   * feature (2026-09-25): a teammate's fix rewrote notes.txt, still
   * differing from HEAD by a newline, and the host logged "nothing changed
   * on disk". The same size-and-time stamp the untracked files carry past
   * their text bounds, so any write is seen.
   */
  let stamped = 0
  for (const [path, status] of snapshot) {
    if (status === UNTRACKED || status.startsWith(UNTRACKED) || /D/.test(status.slice(0, 2))) continue
    if (stamped >= MAX_UNTRACKED_LOOKED_AT) break
    stamped += 1
    const seen = await statOf(join(workspacePath, path))
    if (seen !== undefined) snapshot.set(path, status + STAMP_MARK + `${String(seen.size)}:${String(Math.round(seen.mtimeMs))}`)
  }
  return snapshot
}

/**
 * An untracked file's status never changes while it stays untracked, so an
 * edit to one between two snapshots was invisible: the second turn of a
 * Codex CLI session appended to the file it made in the first and the fold
 * showed nothing (2026-09-05). Its text rides on the status, bounded -- and
 * past the bounds its size and time do, so the edit is still seen.
 */
async function carryUntracked(snapshot: Map<string, string>, workspacePath: string, options: DiskObservationOptions): Promise<void> {
  const readText = options.readText ?? defaultReadText
  const statOf = options.statOf ?? defaultStatOf
  let lookedAt = 0
  let texts = 0
  let textBytes = 0
  for (const [path, status] of snapshot) {
    if (status !== UNTRACKED) continue
    // Never read (holdsSecrets): its size and time say it changed.
    if (holdsSecrets(path)) {
      const seen = await statOf(join(workspacePath, path))
      if (seen !== undefined) snapshot.set(path, UNTRACKED + STAMP_MARK + `${String(seen.size)}:${String(Math.round(seen.mtimeMs))}`)
      continue
    }
    if (lookedAt >= MAX_UNTRACKED_LOOKED_AT) break
    lookedAt += 1
    const absolute = join(workspacePath, path)
    const seen = await statOf(absolute)
    const size = seen?.size ?? 0
    if (size <= MAX_OBSERVED_FILE_BYTES && texts < MAX_UNTRACKED_TEXTS && textBytes + size <= MAX_UNTRACKED_TEXT_BYTES) {
      const text = await readText(absolute)
      if (text !== undefined) {
        snapshot.set(path, UNTRACKED + TEXT_MARK + text)
        texts += 1
        textBytes += text.length
        continue
      }
    }
    if (seen !== undefined) snapshot.set(path, UNTRACKED + STAMP_MARK + `${String(seen.size)}:${String(Math.round(seen.mtimeMs))}`)
  }
}

/** How deep a plain folder is looked into. */
export const MAX_FOLDER_DEPTH = 8

/**
 * Folders a plain-folder look never walks into: a program's own trees and
 * hidden ones (`.git`, `.venv`, Locust's own `.locust`), and names the
 * system itself rewrites while a run goes -- Explorer's `desktop.ini` and
 * `Thumbs.db`, macOS's `.DS_Store`, and the `~$budget.xlsx` Office leaves
 * beside a file it has open -- which would read as changes nobody made.
 */
const SKIPPED_FOLDER = /^(?:node_modules|__pycache__|venv|site-packages)$|^\./
const SKIPPED_FILE = /^(?:desktop\.ini|thumbs\.db|\.ds_store)$|^~\$/i

export interface FolderEntry {
  readonly name: string
  readonly kind: 'file' | 'dir' | 'link' | 'other'
}

async function defaultListDirectory(directory: string): Promise<readonly FolderEntry[]> {
  const { readdir } = await import('node:fs/promises')
  const entries = await readdir(directory, { withFileTypes: true })
  return entries.map((entry) => ({
    name: entry.name,
    // A link or junction is never followed: it can lead out of the folder, or round in a circle.
    kind: entry.isSymbolicLink() ? 'link' : entry.isDirectory() ? 'dir' : entry.isFile() ? 'file' : 'other'
  }))
}

/**
 * A FOLDER THAT IS NOT A REPOSITORY, LOOKED AT DIRECTLY (0.365).
 *
 * The observation above rests on git, and a person who is not a coder
 * keeps their work in a plain folder with no git in it -- often none on the
 * machine. There, a file a command made (Penny's budget workbook, built by
 * a Python command) was never seen, and all the Artifacts tab could say was
 * that it might be missing (0.364).
 *
 * So the folder is walked, breadth first and bounded -- depth, files looked
 * at, text carried -- and every file in it is treated as git treats an
 * untracked one: its text while it is small, its size and time past that.
 * Every later step (what changed, the diff of a new file, the row) is the
 * same as in a repository. A walk that hit a bound is marked `partial`: the
 * host then does not claim to have seen everything, and the Artifacts tab
 * does not say "changed no files".
 */
export async function snapshotFolder(workspacePath: string, options: DiskObservationOptions = {}): Promise<WorkspaceSnapshot | undefined> {
  const listDirectory = options.listDirectory ?? defaultListDirectory
  const found: string[] = []
  let partial = false
  const queue: { readonly directory: string; readonly relative: string; readonly depth: number }[] = [{ directory: workspacePath, relative: '', depth: 0 }]
  walk: while (queue.length > 0) {
    const { directory, relative, depth } = queue.shift()!
    let entries: readonly FolderEntry[]
    try {
      entries = await listDirectory(directory)
    } catch {
      // The folder itself unreadable: no observation. A subfolder: skipped, and said.
      if (depth === 0) return undefined
      partial = true
      continue
    }
    for (const entry of entries) {
      const path = relative === '' ? entry.name : `${relative}/${entry.name}`
      if (entry.kind === 'dir') {
        if (SKIPPED_FOLDER.test(entry.name)) continue
        if (depth + 1 > MAX_FOLDER_DEPTH) {
          partial = true
          continue
        }
        queue.push({ directory: join(directory, entry.name), relative: path, depth: depth + 1 })
      } else if (entry.kind === 'file' && !SKIPPED_FILE.test(entry.name)) {
        if (found.length >= MAX_UNTRACKED_LOOKED_AT) {
          partial = true
          break walk
        }
        found.push(path)
      }
    }
  }
  const snapshot = new Map<string, string>(found.map((path) => [path, UNTRACKED]))
  await carryUntracked(snapshot, workspacePath, options)
  return partial ? Object.assign(snapshot, { partial: true as const }) : snapshot
}

/**
 * FILES THAT HOLD CREDENTIALS ARE NEVER READ (0.489).
 *
 * Colin, 2026-09-30, a Cursor teammate working in his `.claude` folder: Claude
 * Code refreshed its login during the run, and the thread showed
 * `.credentials.json` -- the access and refresh tokens, in full -- as a
 * change "seen on disk", and the ledger kept it; `mcp-needs-auth-cache.json`
 * and a `sessions/*.key` with it. The watch reads a changed file to draw its
 * change, and nothing asked what the file was.
 *
 * A path is refused when any part of it is a dotfile or dot-folder, or names
 * credentials, secrets, tokens, keys, auth, cookies or sessions, or ends in a
 * key or certificate extension. Such a file is still listed as changed, by
 * name; its text is never read, drawn or stored.
 */
export function holdsSecrets(path: string): boolean {
  const parts = path.split(/[\\/]+/).filter((part) => part.length > 0)
  return parts.some((part) =>
    part.startsWith('.')
    || /credential|secret|token|auth|cookie|session|password|passwd|private[-_]?key|keychain|keystore|wallet/i.test(part)
    || /\.(key|pem|p12|pfx|jks|kdbx|gpg|asc|crt|cer|der|ovpn|ppk)$/i.test(part)
    || /^id_(rsa|dsa|ecdsa|ed25519)/i.test(part)
  )
}

const UNTRACKED = '??'
/** Separates an untracked entry's status from the text it carried; never a byte git prints. */
const TEXT_MARK = String.fromCharCode(1)
/** Separates it from the size and time it carried instead, past the bounds (M18). */
const STAMP_MARK = String.fromCharCode(2)

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
  // A look that stopped at a bound can lose a file off its END when a new
  // one arrives earlier in the walk: gone from the second look, and not
  // gone from the disk. So a partial pair reports no disappearances (0.365).
  const whole = before.partial !== true && after.partial !== true
  for (const path of before.keys()) {
    // Was dirty, now clean: something reverted or committed it. Still a
    // change to the working tree the run was in.
    if (!after.has(path) && whole) paths.add(path)
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
    /*
     * Only a row that says it CHANGED a file reports the change (0.364).
     *
     * Any tool naming the file used to count, so a read of notes.ts or a
     * Python command that merely mentioned monthly_budget.xlsx hid the change
     * it sat beside: the thread drew a read or a command, never a changed
     * file, and Penny's new budget workbook left the Artifacts tab saying
     * "This reply changed no files" (Research & money drive, packaged 0.363).
     * The rule is the thread's own (shared/tool-kinds.ts).
     */
    if (!reportsAChange(event.payload)) continue
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
async function defaultStatOf(absolutePath: string): Promise<{ readonly size: number; readonly mtimeMs: number } | undefined> {
  try {
    const seen = await stat(absolutePath)
    return seen.isFile() ? { size: seen.size, mtimeMs: seen.mtimeMs } : undefined
  } catch {
    return undefined
  }
}

async function defaultReadText(absolutePath: string): Promise<string | undefined> {
  try {
    // Sized first: a file past the cap is never read into memory (M18).
    if ((await stat(absolutePath)).size > MAX_OBSERVED_FILE_BYTES) return undefined
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
    // Listed by name, never opened (holdsSecrets).
    if (holdsSecrets(path)) continue
    const entry = after.get(path)
    const status = statusOf(entry)
    try {
      if (status === UNTRACKED) {
        const read = textOf(entry) ?? (await readText(join(workspacePath, path)))
        if (read === undefined || read.length === 0) continue
        // Scrubbed before it is drawn or kept, as a reply is (0.489).
        const text = redactSecrets(read)
        const found = textOf(before?.get(path))
        const earlier = found === undefined ? undefined : redactSecrets(found)
        // There before too, but without its text (past the bounds): what
        // changed in it is unknown, and it is not an add. The row keeps its path.
        if (earlier === undefined && statusOf(before?.get(path)) === UNTRACKED) continue
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
      let unified = await runGit(['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--', path], workspacePath)
      if (unified.trim().length === 0) unified = await runGit(['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--cached', '--', path], workspacePath)
      const patch = toolPatchFrom(redactSecrets(unified))
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
      out = await runGit(['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-index', '--', a, b], workspacePath)
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

/**
 * One notice for a run that shared its folder with another run.
 *
 * The observation above cannot attribute a change when two runs are writing
 * at once, so it is skipped -- but staying silent is its own kind of wrong.
 * A run really did change files, and a receipt reading "5 tool calls" and
 * nothing else invites the reader to conclude nothing was written (drive,
 * 2026-09-06). So the folder's change is reported as the folder's, counted
 * against nobody, and said in the one place that already exists for things
 * the host noticed rather than the runtime.
 */
export function sharedTreeNotice(input: {
  readonly runId: string
  readonly missionId: string
  readonly sourceAdapter: NormalizedRuntimeEvent['sourceAdapter']
  readonly nextSequence: number
  readonly at: string
  /** Everything that differs in the folder, whoever wrote it. */
  readonly paths: readonly string[]
}): NormalizedRuntimeEvent {
  const count = input.paths.length
  return {
    runId: input.runId,
    missionId: input.missionId,
    occurredAt: input.at,
    sourceAdapter: input.sourceAdapter,
    id: `${input.runId}:disk:shared:${String(input.nextSequence)}`,
    sequence: input.nextSequence,
    type: 'adapter.diagnostic',
    payload: {
      level: 'info',
      code: 'host.shared_workspace',
      message:
        `Another teammate was working in this folder at the same time, so what changed on disk cannot be told apart. `
        + `${String(count)} ${count === 1 ? 'file' : 'files'} in the folder ${count === 1 ? 'is' : 'are'} different from before this run; `
        + (count === 1 ? `it is not counted as this run's work.` : `none of them are counted as this run's work.`),
      terminal: false,
      evidence: { redacted: true as const }
    }
  } as NormalizedRuntimeEvent
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
