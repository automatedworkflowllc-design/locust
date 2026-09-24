import { TIDY_BLOCK, boundedMemoryText } from './memory.js'
import { blocksOutsideCode } from './protocolTags.js'

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
const LINE = /^\s*(merge|retire|rewrite)\s+([^:]*?)\s*::\s*(.+?)\s*$/i

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
 * The suggestions in a reply, in order, outside any code: the block inside a
 * code fence is an example -- the brief below shows one exactly that way. A
 * line that does not read, names the wrong number of ids, or names one twice
 * is dropped.
 */
export function parseTidyBlocks(text: string): readonly TidySuggestion[] {
  const found: TidySuggestion[] = []
  for (const match of blocksOutsideCode(text, TIDY_BLOCK)) {
    for (const raw of (match[1] ?? '').split(/\r?\n/)) {
      const line = LINE.exec(raw)
      if (line === null) continue
      const verb = line[1]!.toLowerCase()
      const ids = [...(line[2] ?? '').matchAll(ID)].map((id) => id[0])
      const rest = boundedMemoryText(line[3] ?? '')
      if (rest.length === 0 || new Set(ids).size !== ids.length) continue
      if (verb === 'merge') {
        if (ids.length < 2 || ids.length > MAX_MERGED) continue
        found.push({ kind: 'merge', ids, text: rest })
      } else if (ids.length === 1) {
        found.push(verb === 'retire' ? { kind: 'retire', id: ids[0]!, reason: rest } : { kind: 'rewrite', id: ids[0]!, text: rest })
      }
      if (found.length >= MAX_TIDY_SUGGESTIONS) return found
    }
  }
  return found
}

/**
 * What the teammate is asked, as the person's message on its turn.
 *
 * Short, because the memories are not in it: `.locust/memory.md` holds every
 * one with its id, written where the run stands before it starts, and a
 * folder of 92 memories would not fit in a message. The example block is in a
 * code fence so a reply that repeats this brief does not propose it.
 */
export const TIDY_PROMPT = [
  "Tidy this folder's team memory. Read .locust/memory.md -- every memory is listed there, with its id in square brackets at the end of its line.",
  'Suggest at most 10 changes, and only ones you are sure of:',
  '- merge two or more memories that say the same thing, as one sentence;',
  '- retire a memory that is stale, superseded by another, or no longer true, and say why in plain words;',
  '- rewrite a memory that is unclear or contradicts another, as the corrected sentence.',
  'Change nothing yourself: every suggestion waits for the person, who keeps it or not. The ids are for the block only; the person reads your reasons, so write them without ids.',
  'Say in a sentence or two what you found, then end your reply with a block in this form, one suggestion per line, each id exactly as the file shows it:',
  '',
  '```',
  '<locust-tidy>',
  'merge mem_a mem_b :: the one sentence that replaces them',
  'retire mem_c :: why it no longer holds',
  'rewrite mem_d :: the corrected sentence',
  '</locust-tidy>',
  '```',
  '',
  'Write your block without the code fence around it. If nothing needs tidying, say so and leave the block out.'
].join('\n')

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
