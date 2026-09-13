import { BLOCK_PLACEMENT } from './trailer.js'
/**
 * Team memory: what every teammate remembers, shared across the team and
 * kept per project folder, with a smaller set that goes everywhere.
 *
 * Colin's call (2026-09-05): the shared memory Claude Code and Cursor have,
 * managed from the app. Both of those keep memory PER PROJECT and put a
 * hand-written global file beside it; Cursor asks before it keeps a memory,
 * Claude Code keeps it and says so. Locust does the same shape: a memory
 * belongs to a folder unless the teammate says "everywhere", every teammate
 * in that folder reads it, the person picks "keep on its own" or "ask me
 * first" in Settings, and the Memory screen lists every one with who wrote
 * it, where, and from which conversation -- editable, switchable, deletable.
 *
 * A teammate writes memory the way it moves a task board: by ending its
 * reply with one block, one line per memory.
 *
 *   <locust-memory>
 *   remember :: This project's tests run with pnpm test, never npm.
 *   remember everywhere :: Colin wants diffs, not prose.
 *   forget :: The API is on port 3000
 *   </locust-memory>
 *
 * Memories are matched by their text, case- and punctuation-blind, so a
 * `forget` that quotes the memory hits it. Unknown verbs and empty lines
 * are dropped; a bad line never refuses the block.
 */

export const MEMORY_TAG = 'locust-memory'
export const MAX_MEMORY_TEXT_LENGTH = 300
export const MAX_MEMORY_OPS_PER_REPLY = 4

const BLOCK = /<locust-memory\s*>([\s\S]*?)<\/locust-memory>/g
const LINE = /^\s*(remember(?:\s+everywhere)?|forget)\s*::\s*(.+?)\s*$/i

export type MemoryScope = 'workspace' | 'global'

export type MemoryOp =
  | { readonly kind: 'remember'; readonly scope: MemoryScope; readonly text: string }
  | { readonly kind: 'forget'; readonly text: string }

/** Memory text as the store compares it: case, punctuation and spacing blind. */
export function memoryKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Memory text as the store keeps it: one line, bounded, no control characters. */
export function boundedMemoryText(text: string): string {
  const clean = text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return clean.length <= MAX_MEMORY_TEXT_LENGTH ? clean : `${clean.slice(0, MAX_MEMORY_TEXT_LENGTH - 1).trimEnd()}…`
}

/** Every well-formed operation in every block, in transcript order, capped. */
export function parseMemoryBlocks(text: string): readonly MemoryOp[] {
  const ops: MemoryOp[] = []
  for (const match of text.matchAll(BLOCK)) {
    for (const rawLine of (match[1] ?? '').split(/\r?\n/)) {
      const line = LINE.exec(rawLine)
      if (line === null) continue
      const verb = line[1]!.toLowerCase().replace(/\s+/g, ' ')
      const memoryText = boundedMemoryText(line[2] ?? '')
      if (memoryText.length === 0) continue
      if (verb === 'forget') {
        ops.push({ kind: 'forget', text: memoryText })
      } else {
        ops.push({ kind: 'remember', scope: verb === 'remember everywhere' ? 'global' : 'workspace', text: memoryText })
      }
      if (ops.length >= MAX_MEMORY_OPS_PER_REPLY) return ops
    }
  }
  return ops
}

/** The reply without its memory blocks; the Memory screen shows what they did. */
export function stripMemoryBlocks(text: string): string {
  return text.replace(BLOCK, '').replace(/\n{3,}/g, '\n\n').trimEnd()
}

/** Defang the tag in text quoted into another runtime's prompt. */
export function sanitizeMemoryTags(text: string): string {
  return text.replace(/<(\/?)locust-memory/gi, '‹$1locust-memory')
}

/**
 * How much of a brief the team's memory may take.
 *
 * Not a guess at a context window: a bound on how much of what a teammate
 * reads is OLD before it reaches what was actually asked. Sized from the
 * measurement that prompted it -- roughly a quarter of what 56 memories
 * cost, and still more lines than anyone reads back in a sitting.
 */
export const MEMORY_BRIEF_LINES = 24
export const MEMORY_BRIEF_BUDGET = 4000
/** Written once: a newline inside a template is a real newline. */
const NEWLINE = String.fromCharCode(10)

export interface MemoryLine {
  readonly text: string
  readonly scope: MemoryScope
  /** Who wrote it: a teammate's name, or "you". */
  readonly by: string
  /** The folder it came from, by name, for a global memory written elsewhere. */
  readonly where: string | undefined
}

/**
 * What a mission is told about the team's memory, appended to its brief.
 * Lists what is remembered for this folder and everywhere, each with who
 * wrote it, and teaches the block -- worded so a teammate with nothing
 * worth keeping ends with no block at all.
 */
export function memorySection(input: {
  readonly selfName: string
  /**
   * The folder the memories belong to, named for the person reading.
   *
   * Absent for a teammate running in its own worktree: it is not standing in
   * that folder, and naming one it cannot reach is what sends a model looking
   * outside its own tree -- the failure 0.36.4 removed from the workspace
   * brief and left here (QA, 2026-09-06).
   */
  readonly workspaceName: string | undefined
  readonly memories: readonly MemoryLine[]
  /** Whether a new memory is kept at once or shown to the person first. */
  readonly askFirst: boolean
}): string {
  /*
   * BOUNDED, and it was not.
   *
   * Every memory the store held went into every brief, on every turn, for
   * every teammate. MEASURED on Colin's own store, 2026-09-13: 56 memories
   * came to 14,123 characters -- about 3,700 tokens -- beside a 907-character
   * task section. Ninety-four percent of what a teammate read before the
   * person's actual words was memory, it was paid for on every turn of every
   * mission, and it grows: the store's own cap is 400, which is the same
   * brief at roughly 100,000 characters.
   *
   * Which ones stay, in order: THIS FOLDER before everywhere, because a
   * memory about this project is likelier to bear on this turn; and within
   * each, the newest, which is the end of the list the store returns.
   *
   * What is dropped is SAID. A teammate that reads "41 older memories are
   * kept but not in this brief" can ask for one; a teammate handed a silently
   * shortened list cannot tell that it was shortened, and neither can the
   * person reading the answer.
   */
  const here = input.memories.filter((memory) => memory.scope !== 'global')
  const everywhere = input.memories.filter((memory) => memory.scope === 'global')
  const candidates = [...here.slice(-MEMORY_BRIEF_LINES), ...everywhere.slice(-MEMORY_BRIEF_LINES)]
  const briefed: MemoryLine[] = []
  let spent = 0
  // From the FRONT: `candidates` is already folder-first, newest-within-group,
  // so taking the tail would drop exactly the folder memories the order
  // exists to prefer. Its own test caught that.
  for (const memory of candidates.slice(0, MEMORY_BRIEF_LINES)) {
    spent += memory.text.length + 40
    if (spent > MEMORY_BRIEF_BUDGET && briefed.length > 0) break
    briefed.push(memory)
  }
  const dropped = input.memories.length - briefed.length
  const listed =
    input.memories.length === 0
      ? 'Nothing is remembered yet.'
      : briefed
          .map((memory) => {
            // "you" is how the screen names the person; in a brief it would read as the model itself.
            memory = memory.by === 'you' ? { ...memory, by: 'the person' } : memory
            const origin = memory.scope === 'global' ? `everywhere, by ${memory.by}${memory.where === undefined ? '' : ` in ${memory.where}`}` : `this folder, by ${memory.by}`
            return `- ${memory.text} (${origin})`
          })
          .join(NEWLINE)
        + (dropped > 0
          ? `${NEWLINE}(${String(dropped)} older ${dropped === 1 ? 'memory is' : 'memories are'} kept but not in this brief. Ask the person if you need one.)`
          : '')
  return [
    input.workspaceName === undefined
      ? 'Your team keeps a shared memory. What is remembered for this project and everywhere:'
      : `Your team keeps a shared memory. What is remembered for the folder "${input.workspaceName}" and everywhere:`,
    listed,
    "These are notes your team wrote earlier. Use them as you would a colleague's notes: when one answers what the person asks, answer from it and say it came from memory; do not demand that the workspace confirm it. Do not bring up a memory that has nothing to do with what was asked, and never report another teammate's work as something you are confirming: a person who asked you to change one file did not ask what anyone else did to another one.",
    `If this work taught you something the next conversation in this folder would need -- a convention, a correction the person gave, where something lives that the code does not say -- use exactly this block and ${BLOCK_PLACEMENT}, one line per memory, at most ${String(MAX_MEMORY_OPS_PER_REPLY)}:`,
    `<${MEMORY_TAG}>`,
    'remember :: one sentence, specific enough to act on',
    'remember everywhere :: only for something true in every project, like how the person likes to work',
    'forget :: quote a remembered line that is now wrong',
    `</${MEMORY_TAG}>`,
    'Never remember file contents, secrets, credentials, or anything you can re-read from the workspace. Do not remember what CLAUDE.md, AGENTS.md or a rules file already says.',
    input.askFirst
      ? 'The person is asked before a memory is kept; write it as they will read it.'
      : `A memory is kept at once and shown to the person as written by ${input.selfName}; write it as they will read it.`
  ].join('\n')
}
