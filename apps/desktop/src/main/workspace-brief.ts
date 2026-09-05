import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * LOCUST.md: one file at the root of the project folder, briefed to every
 * teammate mission on every runtime.
 *
 * Each runtime reads its own instruction file (CLAUDE.md, AGENTS.md, the
 * Cursor rules); none of them reads the others'. A person with three
 * teammates on three runtimes had to keep three files saying the same
 * thing. LOCUST.md is the one they read in common, carried by Locust into
 * the brief the way the team's memory is (parity map row 45).
 *
 * Bounded like Claude Code bounds its own: past 200 lines or 24 KB the rest
 * is cut and the brief says so, because a file that quietly stops loading
 * is the failure mode both of the products this one is compared to warn
 * about. Read fresh at every start -- a change lands on the next mission.
 */

export const WORKSPACE_BRIEF_FILE = 'LOCUST.md'
export const MAX_BRIEF_LINES = 200
export const MAX_BRIEF_BYTES = 24 * 1024

export interface WorkspaceBrief {
  readonly text: string
  readonly lines: number
  /** True when the file was longer than the bound and the rest was cut. */
  readonly truncated: boolean
}

export interface WorkspaceBriefSummary {
  readonly lines: number
  readonly truncated: boolean
}

export function boundedBrief(raw: string): WorkspaceBrief {
  const all = raw.replace(/\r\n?/g, '\n').split('\n')
  // A file ending in a newline has not got an extra empty line.
  while (all.length > 0 && all[all.length - 1] === '') all.pop()
  let kept = all.slice(0, MAX_BRIEF_LINES)
  let text = kept.join('\n')
  let truncated = all.length > MAX_BRIEF_LINES
  if (Buffer.byteLength(text, 'utf8') > MAX_BRIEF_BYTES) {
    truncated = true
    // Cut on a line, never mid-character.
    while (kept.length > 0 && Buffer.byteLength(kept.join('\n'), 'utf8') > MAX_BRIEF_BYTES) kept = kept.slice(0, -1)
    text = kept.join('\n')
  }
  return { text: text.trimEnd(), lines: kept.length, truncated }
}

/** The folder's LOCUST.md, or undefined when there is none. Unreadable reads as none. */
export async function readWorkspaceBrief(
  workspacePath: string | undefined,
  read: (path: string) => Promise<string> = (path) => readFile(path, 'utf8')
): Promise<WorkspaceBrief | undefined> {
  if (workspacePath === undefined || workspacePath.length === 0) return undefined
  let raw: string
  try {
    raw = await read(join(workspacePath, WORKSPACE_BRIEF_FILE))
  } catch {
    return undefined
  }
  if (raw.trim().length === 0) return undefined
  return boundedBrief(raw)
}

/** What a mission is told, before anything else: the folder's own instructions, quoted whole. */
export function briefSection(brief: WorkspaceBrief, workspaceName: string): string {
  return [
    `Instructions for the folder "${workspaceName}", from its ${WORKSPACE_BRIEF_FILE}. Every teammate on every runtime is given these; follow them as you would your own instruction file.`,
    brief.text,
    ...(brief.truncated ? [`(${WORKSPACE_BRIEF_FILE} is longer than ${String(MAX_BRIEF_LINES)} lines; the rest was not loaded.)`] : [])
  ].join('\n')
}
