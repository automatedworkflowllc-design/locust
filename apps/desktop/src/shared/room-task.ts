import { BLOCK_PLACEMENT } from './trailer.js'
/**
 * The task block: how a teammate claims, finishes, hands off or adds a task
 * on a room's board, the same way a share block reaches a teammate.
 *
 * Vision #2, "ownership": the smallest model that is more than a mission --
 * a task is a line of text, an owner, a state, and the mission that last
 * touched it. A teammate says what it did to the board by ending its reply
 * with one block; the host reads the block when the run ends and moves the
 * board. A person moves the board from the room screen directly.
 *
 * One line per operation, `verb :: task text` (or `handoff Name :: text`):
 *
 *   <locust-task>
 *   claim :: Write the release notes
 *   done :: Check the version string
 *   handoff Booty :: Update the changelog date
 *   new :: Verify the installer signs
 *   </locust-task>
 *
 * Tasks are matched by their text, case- and punctuation-blind, so a
 * teammate that quotes the board's own line hits the right task. Unknown
 * verbs and empty lines are dropped; a bad line never refuses the block.
 */

export const TASK_TAG = 'locust-task'
export const MAX_TASK_TEXT_LENGTH = 200
export const MAX_TASK_OPS_PER_REPLY = 8

const BLOCK = /<locust-task\s*>([\s\S]*?)<\/locust-task>/g
const LINE = /^\s*(new|claim|done|handoff(?:\s+([^:]{1,40}?))?)\s*::\s*(.+?)\s*$/i

export type TaskOp =
  | { readonly kind: 'new'; readonly text: string }
  | { readonly kind: 'claim'; readonly text: string }
  | { readonly kind: 'done'; readonly text: string }
  | { readonly kind: 'handoff'; readonly text: string; readonly to: string }

/** Task text as the board compares it: case, punctuation and spacing blind. */
export function taskKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Task text as the board stores it: one line, bounded, no control characters. */
export function boundedTaskText(text: string): string {
  const clean = text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return clean.length <= MAX_TASK_TEXT_LENGTH ? clean : `${clean.slice(0, MAX_TASK_TEXT_LENGTH - 1).trimEnd()}…`
}

/** Every well-formed operation in every block, in transcript order, capped. */
/**
 * The placeholder texts the briefing's own worked example uses.
 *
 * Every room mission is taught the block by being SHOWN one, and the example
 * is a valid reply: parsed back, it is four operations, and `claim` on a task
 * the board does not have CREATES it. A model that echoes the example -- a
 * small-model habit -- therefore puts "the task text" on the board as
 * claimed, then done, then handed off, plus "a task that should exist and
 * does not", on a board a person reads (QA, 2026-09-06).
 *
 * These are the strings the example uses, and nothing else. A real task
 * called something else is unaffected; a person whose task really is called
 * "the task text" loses the ability to move it from a room reply, which is a
 * trade worth making once and saying out loud.
 *
 * Kept beside `taskSection`, which writes them: if the example's wording
 * changes, this list has to change with it, and the test asserts the two
 * agree by parsing the briefing itself.
 */
const EXAMPLE_TEXTS: readonly string[] = ['the task text', 'a task that should exist and does not']

const isExample = (text: string): boolean =>
  EXAMPLE_TEXTS.some((example) => example.toLowerCase() === text.trim().toLowerCase())

export function parseTaskBlocks(text: string): readonly TaskOp[] {
  const ops: TaskOp[] = []
  for (const match of text.matchAll(BLOCK)) {
    for (const rawLine of (match[1] ?? '').split(/\r?\n/)) {
      const line = LINE.exec(rawLine)
      if (line === null) continue
      const verb = line[1]!.toLowerCase()
      const taskText = boundedTaskText(line[3] ?? '')
      if (taskText.length === 0) continue
      // The briefing's own example, handed back. Not an instruction.
      if (isExample(taskText)) continue
      if (verb.startsWith('handoff')) {
        const to = (line[2] ?? '').trim()
        if (to.length === 0) continue
        ops.push({ kind: 'handoff', text: taskText, to })
      } else if (verb === 'new' || verb === 'claim' || verb === 'done') {
        ops.push({ kind: verb, text: taskText })
      }
      if (ops.length >= MAX_TASK_OPS_PER_REPLY) return ops
    }
  }
  return ops
}

/** The reply without its task blocks; the board shows what they did. */
export function stripTaskBlocks(text: string): string {
  return text.replace(BLOCK, '').replace(/\n{3,}/g, '\n\n').trimEnd()
}

/** Defang the tag in text quoted into another runtime's prompt. */
export function sanitizeTaskTags(text: string): string {
  return text.replace(/<(\/?)locust-task/gi, '‹$1locust-task')
}

export interface TaskBoardLine {
  readonly text: string
  readonly state: 'open' | 'in-hand' | 'done'
  readonly ownerName: string | undefined
}

/**
 * What a room mission is told about the board, appended to the person's
 * post. Names the room and its members, lists the tasks as they stand, and
 * teaches the block -- worded so a teammate that did nothing to the board
 * ends with no block at all.
 */
export function taskSection(input: {
  readonly roomName: string
  readonly selfName: string
  readonly memberNames: readonly string[]
  readonly tasks: readonly TaskBoardLine[]
}): string {
  const others = input.memberNames.filter((name) => name !== input.selfName)
  const board =
    input.tasks.length === 0
      ? 'The board is empty.'
      : input.tasks
          .map((task) => `- [${task.state}] ${task.text}${task.ownerName === undefined ? '' : ` (${task.ownerName})`}`)
          .join('\n')
  const handoffExample = others[0] ?? 'Name'
  return [
    `You are answering in the room "${input.roomName}" with ${others.length === 0 ? 'nobody else' : others.join(', ')}. The room keeps a task board:`,
    board,
    `If your work claims, finishes, hands off or adds a task on that board, use exactly this block and ${BLOCK_PLACEMENT} -- one line per task, quoting the task text as it appears above:`,
    `<${TASK_TAG}>`,
    'claim :: the task text',
    'done :: the task text',
    `handoff ${handoffExample} :: the task text`,
    'new :: a task that should exist and does not',
    `</${TASK_TAG}>`,
    'Claim only what you are actually doing, mark done only what is finished, and if you touched no task, end with no block.'
  ].join('\n')
}
