import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { excludeWith } from './attach-outside.js'
import { memoryAge } from '../shared/memory.js'
import { defangProtocolBlocks } from '../shared/protocolTags.js'
import type { MemoryLine } from '../shared/memory.js'

/**
 * Team memory as a FILE the teammate can read, beside the lines it is handed.
 *
 * The brief pastes at most 24 memories or 4,000 characters on every turn,
 * and says "(N older memories are kept but not in this brief. Ask the person
 * if you need one.)" for the rest. Measured on Colin's own folder,
 * 2026-09-17: 33 memories, about 20 pasted and 13 invisible, on every turn.
 * Grok Build gives the model `memory_search` and `memory_get` instead --
 * pulled when relevant, paid for once -- and this is the cross-runtime
 * version of that: every runtime can read a file in the workspace, and none
 * of them can call Locust.
 *
 * So the whole list is written to `<folder>/.locust/memory.md`, rewritten
 * only when it changes, kept out of git through `.git/info/exclude` the way
 * worktrees and attachments already are, and the brief pastes the newest
 * few lines and names the file for the rest. The block is still how memory
 * CHANGES; the file is read-only to the teammate, and the brief says so.
 */

export const MEMORY_FILE = join('.locust', 'memory.md')
/** Written once: a newline inside a template is a real newline. */
const NEWLINE = String.fromCharCode(10)

export function memoryFileText(lines: readonly MemoryLine[], now: Date): string {
  const line = (memory: MemoryLine): string => {
    const by = memory.by === 'you' ? 'the person' : memory.by
    const age = memoryAge(memory.at, now)
    const when = memory.at === undefined ? '' : ` -- ${memory.at.slice(0, 10)}${age === undefined ? '' : ` (${age})`}`
    const where = memory.where === undefined ? '' : ` in ${memory.where}`
    // Defanged: the teammate reads this file as part of what it is told.
    // The id, so a tidy pass can name a memory exactly (A1.2).
    return `- ${defangProtocolBlocks(memory.text)} (by ${by}${where}${when})${memory.id === undefined ? '' : ` [${memory.id}]`}`
  }
  const here = lines.filter((memory) => memory.scope !== 'global')
  const everywhere = lines.filter((memory) => memory.scope === 'global')
  return [
    '# Team memory',
    '',
    'Written by Locust before each run, newest last. Read-only: to change memory, use the <locust-memory> block in your reply. The id in square brackets names each memory exactly.',
    '',
    `## This folder (${String(here.length)})`,
    '',
    here.length === 0 ? '(nothing yet)' : here.map(line).join(NEWLINE),
    '',
    `## Everywhere (${String(everywhere.length)})`,
    '',
    everywhere.length === 0 ? '(nothing yet)' : everywhere.map(line).join(NEWLINE),
    ''
  ].join(NEWLINE)
}

export interface MemoryFileIo {
  readonly readFile: (path: string) => Promise<string>
  readonly writeFile: (path: string, text: string) => Promise<void>
  readonly mkdir: (path: string) => Promise<unknown>
}

const nodeIo: MemoryFileIo = {
  readFile: (path) => readFile(path, 'utf8'),
  writeFile: (path, text) => writeFile(path, text, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true })
}

/**
 * What the file says while memory is switched off (A1.7).
 *
 * Switching memory off stopped the brief and the writes, and left the last
 * file where it was -- every memory it held, still readable by any teammate
 * that looks around the folder, under a heading that says it is the team's
 * memory. The Off setting says teammates are not told what is remembered;
 * the file said otherwise.
 */
export const MEMORY_OFF_TEXT = '# Team memory\n\nTeam memory is switched off in Locust for this folder. Nothing here is current, and nothing is remembered for this run.\n'

/**
 * Memory switched off: a file written while it was on is rewritten to say
 * so. Only one that exists -- a folder that never had the file gets none.
 * Answers whether it changed anything.
 */
export async function retireMemoryFile(folder: string, io: MemoryFileIo = nodeIo): Promise<boolean> {
  const path = join(folder, MEMORY_FILE)
  const current = await io.readFile(path).catch(() => undefined)
  if (current === undefined || current === MEMORY_OFF_TEXT) return false
  await io.writeFile(path, MEMORY_OFF_TEXT)
  return true
}

/**
 * Write the file under `folder`, and keep `.locust/` out of git there.
 * Returns the workspace-relative path the brief should name, or undefined
 * when the folder could not be written -- the brief then pastes as before.
 */
export async function writeMemoryFile(
  folder: string,
  lines: readonly MemoryLine[],
  now: Date,
  io: MemoryFileIo = nodeIo
): Promise<string | undefined> {
  const path = join(folder, MEMORY_FILE)
  const text = memoryFileText(lines, now)
  try {
    const current = await io.readFile(path).catch(() => undefined)
    if (current !== text) {
      await io.mkdir(join(folder, '.locust'))
      await io.writeFile(path, text)
    }
  } catch {
    return undefined
  }
  // Best effort, and only where there is a repository: a folder with no
  // `.git` has nothing to exclude from.
  const excludePath = join(folder, '.git', 'info', 'exclude')
  try {
    const current = await io.readFile(excludePath).catch((error: NodeJS.ErrnoException) => (error.code === 'ENOENT' ? '' : Promise.reject(error)))
    const gitDir = await io.readFile(join(folder, '.git', 'HEAD')).catch(() => undefined)
    if (gitDir !== undefined) {
      const next = excludeWith(current)
      if (next !== undefined) {
        await io.mkdir(join(folder, '.git', 'info'))
        await io.writeFile(excludePath, next)
      }
    }
  } catch {
    // The file is written; git hygiene failing must not cost the brief.
  }
  return MEMORY_FILE.replace(/\\/g, '/')
}
