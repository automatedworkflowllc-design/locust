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

/**
 * The runtimes a LOCUST.md section can be addressed to (A4.2). A tag that is
 * not one of these -- `<details>`, say -- is ordinary text and left alone.
 */
const RUNTIME_TAGS: ReadonlySet<string> = new Set([
  'codex', 'claude', 'cursor', 'gemini', 'opencode', 'copilot', 'muse', 'antigravity'
])

/**
 * LOCUST.md as one runtime's teammates are given it (A4.2).
 *
 * A section between `<claude>` and `</claude>`, each alone on its line, goes
 * only to teammates on Claude Code; the same for every runtime; everything
 * outside a section goes to all. So a project can say "run the tests with
 * npm test" to everyone and something only one CLI needs to that CLI alone.
 *
 * Nothing is lost by accident: a tag inside a code fence is text, a tag that
 * names no runtime is text, and an opening tag with no closing one is left
 * in, content and all, rather than hiding the rest of the file.
 */
export function briefForRuntime(raw: string, runtime: string): string {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n')
  const tagOf = (line: string): { readonly name: string; readonly closing: boolean } | undefined => {
    const match = /^\s*<(\/?)([a-z]+)>\s*$/i.exec(line)
    if (match === null) return undefined
    const name = match[2]!.toLowerCase()
    return RUNTIME_TAGS.has(name) ? { name, closing: match[1] === '/' } : undefined
  }
  const kept: string[] = []
  let fenced = false
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    const tag = fenced ? undefined : tagOf(line)
    if (tag === undefined || tag.closing) {
      // A closing tag with nothing open is text, like any other stray line.
      kept.push(line)
      continue
    }
    // An opening tag: find its close, outside fences.
    let close = -1
    let inner = false
    for (let ahead = index + 1; ahead < lines.length; ahead += 1) {
      if (/^\s*(```|~~~)/.test(lines[ahead]!)) inner = !inner
      const next = inner ? undefined : tagOf(lines[ahead]!)
      if (next?.closing === true && next.name === tag.name) {
        close = ahead
        break
      }
    }
    if (close < 0) {
      kept.push(line)
      continue
    }
    const section = lines.slice(index + 1, close)
    if (tag.name === runtime) kept.push(...section)
    // Fences inside the section count toward what follows it, kept or not.
    for (const inside of section) if (/^\s*(```|~~~)/.test(inside)) fenced = !fenced
    index = close
  }
  return kept.join('\n')
}

/**
 * The folder's LOCUST.md, or undefined when there is none. Unreadable reads as
 * none. Given a runtime, the sections addressed to other runtimes are left out.
 */
export async function readWorkspaceBrief(
  workspacePath: string | undefined,
  read: (path: string) => Promise<string> = (path) => readFile(path, 'utf8'),
  runtime?: string
): Promise<WorkspaceBrief | undefined> {
  if (workspacePath === undefined || workspacePath.length === 0) return undefined
  let raw: string
  try {
    raw = await read(join(workspacePath, WORKSPACE_BRIEF_FILE))
  } catch {
    return undefined
  }
  const text = runtime === undefined ? raw : briefForRuntime(raw, runtime)
  if (text.trim().length === 0) return undefined
  return boundedBrief(text)
}

/**
 * What a teammate on its own branch is told about where it is standing.
 *
 * The same fact `briefSection` states when it has a brief to attach it to.
 * Said separately because a folder with no LOCUST.md has no brief -- and that
 * is the ordinary case for someone who has just installed the app, which is
 * exactly who the worktree fix was for.
 */
/**
 * Where a teammate is standing, when nothing else has told it.
 *
 * The folder is named inside `briefSection` -- and `briefSection` only
 * exists when the folder HAS a LOCUST.md. A default install does not, which
 * means the ordinary case is a coding teammate told its own name, its role,
 * its runtime, who else is on the roster, and nothing whatsoever about which
 * folder it is about to edit.
 *
 * Found from the teammate's own seat, 2026-09-15, by a Cursor model
 * dogfooding the app as a member of a room: "I am standing in the wrong
 * house... I only know that from memory. A coding teammate will edit
 * Claude's junk drawer unless someone already taught it the path."
 *
 * One line, and deliberately one. This file's own tests sit at a boundary
 * where forty more characters push a waiting peer message out of the prompt
 * entirely, so the fix for "the brief says too little" cannot be an essay.
 * The folder is the fact a teammate cannot obtain any other way; its name,
 * role and peers it is already given.
 */
export function whereSection(workspaceName: string): string {
  return `You are working in the folder "${workspaceName}". Everything you read or change belongs to it unless you are told otherwise.`
}

/**
 * A group's standing instructions, given to every turn of a conversation in
 * it. One sentence of preamble: this rides in the same budget as a waiting
 * peer message, and the words that matter are the person's.
 */
export function groupSection(groupName: string, instructions: string): string {
  return `Standing instructions for the group "${groupName}", which this conversation is in. Every turn of it is given these:
${instructions}`
}

export function worktreeSection(): string {
  return 'Your missions run in your own copy of this project, so work only inside the folder you were started in.'
}

/**
 * What a mission is told, before anything else: the folder's own instructions,
 * quoted whole.
 *
 * `workspaceName` is absent for a teammate running in its own worktree, and
 * that is not a cosmetic difference. Naming a folder the run is NOT standing
 * in invites the model to go and find it: worktree runs were seen asking for
 * the parent folder, and OpenCode auto-rejects a directory outside its own
 * AND ends the run on the rejection -- between one and three of three
 * teammates lost their whole run to it (drive, 2026-09-06). So a worktree
 * teammate is told what is true for it instead: this is the project, you have
 * your own copy, stay in it.
 */
/**
 * WHERE A RUN STANDS, SAID ONCE (0.638).
 *
 * A run in the project folder is told the folder's name, inside its LOCUST.md
 * section when there is one (`briefSection`) or on its own line
 * (`whereSection`). A run that stands APART from it -- a teammate's worktree,
 * or a comparison column's copy -- is told it has its own copy instead, and
 * never the project folder's name: an arena round's OpenCode columns, told
 * "You are working in the folder arena-rpg" from inside a copy, made that
 * folder there and wrote the game into it, one level down, where Keep and
 * the column's page did not look.
 */
export function folderSentences(brief: WorkspaceBrief | undefined, standsApart: boolean, folderName: string): readonly string[] {
  if (brief !== undefined) return [briefSection(brief, standsApart ? undefined : folderName)]
  return [standsApart ? worktreeSection() : whereSection(folderName)]
}

export function briefSection(brief: WorkspaceBrief, workspaceName: string | undefined): string {
  return [
    workspaceName === undefined
      ? `Instructions for this project, from its ${WORKSPACE_BRIEF_FILE}. Every teammate on every runtime is given these; follow them as you would your own instruction file. Your missions run in your own copy of the project, so work only inside the folder you were started in.`
      : `Instructions for the folder "${workspaceName}", from its ${WORKSPACE_BRIEF_FILE}. Every teammate on every runtime is given these; follow them as you would your own instruction file.`,
    brief.text,
    ...(brief.truncated ? [`(${WORKSPACE_BRIEF_FILE} is longer than ${String(MAX_BRIEF_LINES)} lines; the rest was not loaded.)`] : [])
  ].join('\n')
}
