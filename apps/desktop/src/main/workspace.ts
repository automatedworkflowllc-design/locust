import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { isAbsolute, resolve, sep } from 'node:path'

/**
 * The id a mission records for the folder it ran in.
 *
 * Derived from the path, so the same folder always produces the same id and a
 * mission can be matched back to where it happened. Codex missions were
 * already doing this inline; the app-server and Antigravity paths were minting
 * a RANDOM id instead, which looks the same in a receipt and means the
 * opposite -- their missions could never be matched to any folder at all.
 * MEASURED 2026-09-03 while making the app open the right conversation for the
 * folder it was launched in.
 *
 * Hashed rather than stored plainly: the ledger is a durable local record and
 * a path can name a person, a client, or an unreleased project.
 */
export function workspaceIdFor(workspacePath: string): string {
  return `ws_${createHash('sha256').update(workspacePath, 'utf8').digest('hex').slice(0, 32)}`
}

/**
 * Which folder the teammates work in, and how the app came to know it.
 *
 * Until 0.21.5 the answer was the process's working directory, full stop --
 * which is right when the app is launched from a terminal inside a project
 * and WRONG for the way a person actually opens an installed app: the Start
 * menu shortcut runs it from its own install folder. Every teammate on
 * Colin's machine was working inside `AppData\Local\Programs\Locust`, and the
 * first route that checks its folder (Antigravity) said so out loud
 * (2026-09-05: "Antigravity has not opened C:\...\Programs\Locust").
 *
 * So the install folder is never a workspace. Launched from there, the app
 * uses the folder the person chose last time, and with none chosen it opens
 * with no workspace at all and says so -- a start is refused until a folder
 * is picked, rather than quietly editing the app's own files.
 */
export interface WorkspaceResolution {
  readonly path: string | undefined
  readonly source: 'argument' | 'launch-folder' | 'remembered' | 'none'
}

export const WORKSPACE_ARGUMENT = '--workspace='

export function resolveWorkspacePath(options: {
  readonly argv: readonly string[]
  readonly cwd: string
  /** Where the installed app lives; undefined for a development build, which can be launched from anywhere. */
  readonly installDirectory: string | undefined
  readonly remembered: string | undefined
  readonly platform: NodeJS.Platform
}): WorkspaceResolution {
  // An explicit argument wins: it is how the app reopens itself in a folder
  // the person just chose.
  const argument = options.argv.find((entry) => entry.startsWith(WORKSPACE_ARGUMENT))?.slice(WORKSPACE_ARGUMENT.length)
  if (argument !== undefined && argument.length > 0 && isAbsolute(argument)) {
    return { path: resolve(argument), source: 'argument' }
  }
  // Launched from a real folder -- a terminal, a shortcut with a start-in --
  // that folder is the workspace, as it always was.
  if (!isInsideDirectory(options.cwd, options.installDirectory, options.platform)) {
    return { path: resolve(options.cwd), source: 'launch-folder' }
  }
  if (
    options.remembered !== undefined
    && isAbsolute(options.remembered)
    && !isInsideDirectory(options.remembered, options.installDirectory, options.platform)
  ) {
    return { path: resolve(options.remembered), source: 'remembered' }
  }
  return { path: undefined, source: 'none' }
}

/** Whether `candidate` is `directory` or somewhere under it. Case-blind on Windows, where the filesystem is. */
export function isInsideDirectory(
  candidate: string,
  directory: string | undefined,
  platform: NodeJS.Platform
): boolean {
  if (directory === undefined) return false
  const fold = (value: string): string => {
    const full = resolve(value).replace(/[\\/]+$/, '')
    return platform === 'win32' ? full.toLowerCase() : full
  }
  const inner = fold(candidate)
  const outer = fold(directory)
  return inner === outer || inner.startsWith(outer + sep)
}

interface RememberedWorkspaceFile {
  readonly schemaVersion: 1
  readonly path: string
}

/** The folder chosen last time, or undefined when there is none or the file is unreadable. */
export function readRememberedWorkspace(file: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const record = parsed as Partial<RememberedWorkspaceFile>
    return typeof record.path === 'string' && record.path.length > 0 ? record.path : undefined
  } catch {
    return undefined
  }
}

export async function writeRememberedWorkspace(file: string, path: string): Promise<void> {
  const record: RememberedWorkspaceFile = { schemaVersion: 1, path }
  await writeFile(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
}
