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
          .map((task) => {
            /*
             * WHOSE, said from the reader's side.
             *
             * The board named an owner -- `(Yurt)` -- and left every reader to
             * work out whether that was them. Both teammates in a two-person
             * room then started the same task: Colin, 2026-09-11, on a task
             * assigned to Yurt alone, "i can imagine if both teammates receive
             * the task only assigned to one things can get messy". They both
             * received the board, which is right; nothing told either of them
             * that a name on a row was a claim already made.
             *
             * So a row says `(yours)` or `(Yurt's)` -- the same fact addressed
             * to the person reading it, which is the same correction the
             * opening line needed when it described a teammate's colleagues
             * instead of naming the teammate.
             */
            const owner =
              task.ownerName === undefined
                ? ' (unassigned)'
                : task.ownerName === input.selfName
                  ? ' (yours)'
                  : ` (${task.ownerName}'s)`
            return `- [${task.state}] ${task.text}${owner}`
          })
          .join('\n')
  const handoffExample = others[0] ?? 'Name'
  return [
    /*
     * It says WHO YOU ARE first.
     *
     * This opened with "You are answering in the room X with A, B, C" -- it
     * listed everyone else and never named the recipient. A teammate had no
     * way to know which of the names in that sentence was its own.
     *
     * Astra hit the consequence measuring the frontier (2026-09-09): asked
     * to write to its own named file, a teammate answered that it was Muse
     * Spark and could not identify which filename was assigned to it. No
     * file was written. That is a task failure at N=1, from a briefing that
     * addressed a person by describing their colleagues.
     *
     * They worked around it in the fixture by naming the teammate in the
     * prompt, and said plainly that this was a fixture workaround and not a
     * production fix. This is the production fix.
     */
    `You are ${input.selfName}, answering in the room "${input.roomName}" with ${others.length === 0 ? 'nobody else' : others.join(', ')}. The room keeps a task board:`,
    board,
    `If your work claims, finishes, hands off or adds a task on that board, use exactly this block and ${BLOCK_PLACEMENT} -- one line per task, quoting the task text as it appears above:`,
    `<${TASK_TAG}>`,
    'claim :: the task text',
    'done :: the task text',
    `handoff ${handoffExample} :: the task text`,
    'new :: a task that should exist and does not',
    `</${TASK_TAG}>`,
    /*
     * The rule the board always implied and never stated. Without it, "claim
     * only what you are actually doing" reads as being about honesty -- and a
     * teammate that genuinely intends to do someone else's task is not
     * breaking it.
     */
    "A row marked with another teammate's name is already theirs: leave it alone, and do not claim, redo or report on it. Work an unassigned row, or one marked yours.",
    /*
     * The obligation, not just the restriction.
     *
     * Everything here was phrased as a limit -- claim only what you are
     * actually doing -- and a model reading only limits errs toward doing
     * nothing, which is the safe-looking failure. Colin watched exactly that
     * on 2026-09-14: he asked a teammate to review a codebase, it started,
     * and the row stayed `unassigned` while it worked. He asked "shouldnt a
     * teammate automatically claim a task if asked to though?", and the
     * answer is yes -- nothing had ever told it so.
     *
     * The cost is not tidiness. An unassigned row and a row being worked look
     * identical to every other teammate in the room, and the rule directly
     * above sends them at unassigned rows. So a board that under-reports
     * invites two teammates onto the same task, which is the collision the
     * board exists to prevent (Colin, 2026-09-10: "i can imagine if both
     * teammates receive the task only assigned to one things can get messy").
     */
    'If you begin work that a row on that board describes -- because the person asked you to, or because you picked it up -- claim it in the same reply. An unassigned row and a row you are working look the same to everyone else, and the rule above sends them at unassigned rows.',
    'Claim only what you are actually doing, mark done only what is finished, and if you touched no task, end with no block.'
  ].join('\n')
}

/**
 * The one open row a post is plainly about, or nothing.
 *
 * Grok's beta drive, 2026-09-14, finding 3: a post asked a teammate to start
 * an open board task, the room reported both teammates running, both faces
 * read "working", the teammate's own reply said "Starting the release notes
 * task" -- and the row said **unassigned** the whole time, through the run,
 * after it settled, and after a restart.
 *
 * 0.116.0 told teammates to claim a row the moment they start it, and that is
 * not enough on its own: a `locust-task` block is read from the END of a
 * reply, so nothing can have claimed while the work is happening. The window
 * where the board is wrong is exactly the window where it matters, because
 * the rule beside it sends other teammates at unassigned rows.
 *
 * So the host claims it at START, when -- and only when -- the person's own
 * words identify one open row beyond argument. The matching rule is
 * `forgetMatch`'s and the reasons are the same: exactly one target, and none
 * or several are a refusal rather than a guess. A post that says "start that
 * board task" names nothing, and nothing is what this returns; the app does
 * not get to decide which row somebody meant.
 */
export function rowNamedByPost(
  postText: string,
  tasks: readonly { readonly taskId: string; readonly text: string; readonly state: string; readonly ownerId?: string }[]
): string | undefined {
  const said = postText.toLowerCase();
  const open = tasks.filter((task) => task.state === "open" && task.ownerId === undefined);
  const named = open.filter((task) => {
    const words = task.text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    // The row's own words, in order, inside what the person wrote. Short
    // rows are excluded: "notes" appearing in a sentence is not a reference.
    return words.length >= 8 && said.includes(words);
  });
  return named.length === 1 ? named[0]?.taskId : undefined;
}
