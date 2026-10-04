import { TIDY_BLOCK, boundedMemoryText } from './memory.js'

/**
 * A TIDY PASS: a teammate reads the folder's memories and suggests merging,
 * retiring or rewriting some (A1.2).
 *
 * Consolidation is what every memory system that lasts does -- Grok Build's
 * "Dream", Codex, Letta, ECC -- because a store that only grows ends up
 * briefing near-copies and contradictions side by side. Colin's folder,
 * 2026-09-24: 92 memories, many of them one status restated in a new
 * sentence.
 *
 * Nothing here changes a memory. Every suggestion becomes a proposal on the
 * Memory screen and waits for the person's Keep; one whose memories changed
 * after it was made is refused (agent-native's hash gate, memory-store.ts);
 * what a merge or a retirement removes goes to Recently forgotten.
 *
 * The teammate names memories by the ids it reads in `.locust/memory.md`,
 * not by quoting them: a quote is matched loosely, an id exactly, and a merge
 * has to name two or more things without doubt.
 */

export const TIDY_TAG = 'locust-tidy'
const ID = /mem_[A-Za-z0-9_-]{1,60}/g
// A bullet or a number in front is how a model writes a list; it is not part of the line.
const LINE = /^\s*(?:[-*•]\s*|\d{1,2}[.)]\s*)?(merge|retire|rewrite)\s+([^:]*?)\s*::\s*(.+?)\s*$/i

/** At most this many suggestions are taken from one reply: a person answers each one. */
export const MAX_TIDY_SUGGESTIONS = 12
/** A merge joins two to this many memories. */
export const MAX_MERGED = 6
/** Past this many memories in a folder, the Memory screen says a tidy pass would help. */
export const TIDY_NUDGE_AT = 60

export type TidySuggestion =
  | { readonly kind: 'merge'; readonly ids: readonly string[]; readonly text: string }
  | { readonly kind: 'retire'; readonly id: string; readonly reason: string }
  | { readonly kind: 'rewrite'; readonly id: string; readonly text: string }

/**
 * The brief's own example, line by line. A reply that repeats the brief
 * proposes nothing: these lines are skipped wherever they appear.
 */
export const TIDY_EXAMPLE_LINES: readonly string[] = [
  'merge mem_a mem_b :: the one sentence that replaces them',
  'retire mem_c :: why it no longer holds',
  'rewrite mem_d :: the corrected sentence'
]

/**
 * The suggestions in a reply, in order. A line that does not read, names the
 * wrong number of ids, names one twice, or repeats an earlier suggestion is
 * dropped.
 *
 * INSIDE A CODE FENCE TOO (0.372). Every other block this app reads is taken
 * only outside code, because a fenced block is an example -- and this one was
 * as well, since its brief showed the example in a fence. So the model
 * copied the fence: on the 62-memory tidy drive, one run of two put ten
 * correct suggestions in a fence, the pass proposed nothing, and the person
 * saw "Here are my suggestions:" over an empty box. The brief no longer
 * fences its example, and the only thing the fence protected against -- the
 * brief's own example, repeated -- is skipped by its lines instead.
 */
export function parseTidyBlocks(text: string): readonly TidySuggestion[] {
  return readTidyBlocks(text).suggestions
}

/**
 * The suggestions, and how many lines in the block could not be read as one.
 *
 * A line that names the wrong number of ids, or is not a suggestion at all,
 * was dropped in silence: the person read "Here are my suggestions:" and
 * nothing reached the Memory screen, with no word of why. The reader says
 * how many were lost (memory-reader.ts). Blank lines, the brief's own
 * example, a repeat, and lines past the limit are not counted: none of them
 * is a suggestion that went missing.
 */
export function readTidyBlocks(text: string): { readonly suggestions: readonly TidySuggestion[]; readonly unread: number } {
  const found: TidySuggestion[] = []
  const seen = new Set<string>()
  let unread = 0
  for (const match of text.matchAll(TIDY_BLOCK)) {
    for (const raw of (match[1] ?? '').split(/\r?\n/)) {
      if (raw.trim().length === 0 || TIDY_EXAMPLE_LINES.includes(raw.trim())) continue
      if (found.length >= MAX_TIDY_SUGGESTIONS) return { suggestions: found, unread }
      const line = LINE.exec(raw)
      if (line === null) {
        unread += 1
        continue
      }
      const verb = line[1]!.toLowerCase()
      const ids = [...(line[2] ?? '').matchAll(ID)].map((id) => id[0])
      const rest = boundedMemoryText(line[3] ?? '')
      if (rest.length === 0 || new Set(ids).size !== ids.length) {
        unread += 1
        continue
      }
      // The same suggestion twice -- a block shown, then written -- is asked once.
      const key = `${verb} ${ids.join(' ')}`
      if (seen.has(key)) continue
      if (verb === 'merge' && ids.length >= 2 && ids.length <= MAX_MERGED) {
        found.push({ kind: 'merge', ids, text: rest })
      } else if (verb !== 'merge' && ids.length === 1) {
        found.push(verb === 'retire' ? { kind: 'retire', id: ids[0]!, reason: rest } : { kind: 'rewrite', id: ids[0]!, text: rest })
      } else {
        unread += 1
        continue
      }
      seen.add(key)
    }
  }
  return { suggestions: found, unread }
}

/**
 * What the teammate is asked, as the person's message on its turn.
 *
 * Short, because the memories are not in it: `.locust/memory.md` holds every
 * one with its id, written where the run stands before it starts, and a
 * folder of 92 memories would not fit in a message. The example is shown
 * exactly as the block should be written -- NOT in a code fence, which the
 * model copied (0.372) -- and a reply that repeats it proposes nothing
 * (`TIDY_EXAMPLE_LINES`).
 */
export const TIDY_PROMPT = [
  "Tidy this folder's team memory. Read .locust/memory.md -- every memory is listed there, with its id in square brackets at the end of its line.",
  'Suggest at most 10 changes, and only ones you are sure of:',
  '- merge two or more memories that say the same thing, as one sentence;',
  '- retire a memory that is stale, superseded by another, or no longer true, and say why in plain words -- one marked "may be out of date" names a file that changed after it was written, so check that file, and one marked "not given to a teammate in N days" may no longer matter;',
  '- rewrite a memory that is unclear or contradicts another, as the corrected sentence.',
  'Change nothing yourself: every suggestion waits for the person, who keeps it or not. The ids are for the block only; the person reads your reasons, so write them without ids.',
  'Say in a sentence or two what you found, then end your reply with a block in this form, one suggestion per line, each id exactly as the file shows it:',
  '',
  '<locust-tidy>',
  ...TIDY_EXAMPLE_LINES,
  '</locust-tidy>',
  '',
  'Write the block in your reply itself -- not in a code block, a command or a file. If nothing needs tidying, say so and leave the block out.'
].join('\n')

/**
 * Whether a run was asked for a tidy pass: by the brief's first line, which
 * every version of the brief has kept -- a pass recorded before 0.372 was
 * sent it with its example in a code fence.
 */
export function isTidyPrompt(prompt: string | undefined): boolean {
  const opening = TIDY_PROMPT.split('\n')[0] ?? TIDY_PROMPT
  return prompt !== undefined && prompt.startsWith(opening)
}

/**
 * A retirement's reason, as the person reads it (A1.2).
 *
 * Models cite the ids they were given -- "moved to port 3001 on September 20
 * (mem_moved)" on the 0.317 drive -- and an id means nothing to a person. A
 * cited id in brackets is dropped (the sentence already says it in words); a
 * bare one becomes the memory it names, quoted, or "another memory" when it
 * is not one kept here.
 */
export function readableReason(reason: string, memories: readonly { readonly memoryId: string; readonly text: string }[]): string {
  return reason
    .replace(/\s*\(\s*mem_[A-Za-z0-9_-]+(?:\s*[,;]\s*mem_[A-Za-z0-9_-]+)*\s*\)/g, '')
    .replace(/\bmem_[A-Za-z0-9_-]+/g, (id) => {
      const named = memories.find((memory) => memory.memoryId === id)
      return named === undefined ? 'another memory' : `"${named.text}"`
    })
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim()
}
