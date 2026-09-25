import { blocksOutsideCode } from './protocolTags.js'

/**
 * The ask block: how a runtime says "I need you to choose" instead of guessing.
 *
 * This is NOT the approval card, and the difference is the whole point. An
 * approval asks *may I do this thing I am about to do* -- the agent has
 * decided, and wants permission. This asks *which of these should I do*, with
 * what each choice costs, before anything is done. Today an agent that reaches
 * a fork has exactly one option: pick one and carry on. The person finds out
 * afterwards, from a diff.
 *
 * Same transport problem as the share block, same answer. `codex exec` and
 * `claude -p` are one prompt in, one transcript out, with no side channel, so
 * the question travels in the transcript in a form the host can find without
 * guessing.
 *
 * The form is line-based rather than nested tags because a model has to
 * produce it reliably from a one-paragraph instruction, and every runtime here
 * writes lists correctly far more often than it writes nested XML.
 *
 *   <locust-ask>
 *   The v2 handler has two callers outside billing. Keep them on v2 behind the
 *   flag, or migrate them in this mission?
 *   - Keep them on v2 :: Smaller change, flag stays until you flip it
 *   - Migrate all callers now :: Touches 4 more files, adds ~10 min
 *   </locust-ask>
 *
 * Shared between main and renderer so the parser that builds the card and the
 * one that hides the block from the reply bubble are the same function.
 */

export const ASK_TAG = 'locust-ask'

/** A question long enough to need scrolling is not a question, it is a memo. */
export const MAX_QUESTION_LENGTH = 600
export const MAX_OPTION_LABEL_LENGTH = 90
export const MAX_OPTION_NOTE_LENGTH = 160

/**
 * One option is not a decision, it is an announcement -- and the card would
 * offer a button whose only effect is to agree, which is the approval card
 * wearing the wrong clothes. More than four is a menu nobody reads; a runtime
 * with five paths has not thought hard enough yet.
 */
export const MIN_OPTIONS = 2
export const MAX_OPTIONS = 4

const BLOCK = /<locust-ask\s*>([\s\S]*?)<\/locust-ask>/g
/**
 * `- Label :: what it costs`, where the cost half is optional.
 *
 * A NUMBERED list counts too. The briefing writes its example with dashes and
 * this accepted only dashes and asterisks, so a model that answered with
 * "1. Rewrite it  2. Patch it" produced a block with no options at all -- the
 * card never appeared and the run simply ended, with the question stranded in
 * prose. Reported by a Cursor teammate reading this source from inside Locust
 * (2026-09-08): "Numbered option lists are not decisions; only `-` / `*`
 * count. The card never appears and the run just ends."
 *
 * Numbering a list of choices is not a mistake, and refusing to read one is
 * this app failing to understand something unambiguous.
 */
const OPTION_LINE = /^(?:[-*]|\d{1,2}[.)])\s+(.+)$/

/**
 * A button that only agrees, or only refuses.
 *
 * This is the failure this whole card was designed against, arriving through
 * the front door: "Shall I proceed? - Yes / - No" is a PERMISSION request, not
 * a fork, and the product already has a card for permission. Accepting it here
 * would let an agent turn every step into a confirmation, which is the exact
 * over-asking the briefing tells it to avoid -- and the person would face a
 * decision card that decides nothing.
 *
 * A real fork's options say what to DO, so refusing bare assent costs nothing
 * that matters. Kept deliberately narrow -- whole-label matches only, after
 * stripping trailing punctuation -- because a rule that swallowed "Yes, and
 * migrate the callers too" would suppress a genuine choice, and a suppressed
 * question is worse than an ugly one: the agent then guesses, which is where
 * this started.
 */
const BARE_ASSENT = new Set([
  'yes',
  'no',
  'ok',
  'okay',
  'sure',
  'proceed',
  'continue',
  'go',
  'go ahead',
  'do it',
  'stop',
  'cancel',
  'abort',
  'wait',
  'approve',
  'reject',
  'deny',
  'confirm',
  'yes please',
  'no thanks',
  "don't",
  'do not'
])

function isBareAssent(label: string): boolean {
  return BARE_ASSENT.has(label.toLowerCase().replace(/[.!?,;:]+$/u, '').trim())
}

export interface DecisionOption {
  readonly label: string
  /** What this choice costs or implies, in the runtime's own words. */
  readonly note: string | undefined
}

export interface DecisionRequest {
  readonly question: string
  readonly options: readonly DecisionOption[]
}

const clean = (value: string): string =>
  value
    // Control characters other than the whitespace collapsed below: a
    // stray byte from a transcript must not refuse a whole question.
    // Written as escapes -- typing them literally put real NUL bytes in
    // this file and git classed it binary.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()

const bounded = (value: string, limit: number): string =>
  value.length <= limit ? value : `${value.slice(0, limit - 1).trimEnd()}…`

/**
 * The first well-formed question in a transcript, or undefined.
 *
 * Only the first: a run that asks twice has produced two forks it never
 * resolved, and answering the second would be answering out of order. The
 * rest stay visible in the reply, which is where a reader can see them.
 */
/** An option named by its position or by the template's placeholder, not by what it is. */
export function isPlaceholderLabel(label: string): boolean {
  return /^(?:<[^>]*>|(?:the )?(?:first|second|third|fourth|1st|2nd|3rd|4th) option|option (?:[1-4]|one|two|three|four|[a-d]))$/i.test(label.trim())
}

export function parseDecision(text: string): DecisionRequest | undefined {
  for (const match of blocksOutsideCode(text, BLOCK)) {
    const parsed = readBlock(match[1] ?? '')
    if (parsed !== undefined) return parsed
  }
  return undefined
}

function readBlock(body: string): DecisionRequest | undefined {
  const lines = body.split(/\r?\n/)
  const questionLines: string[] = []
  const options: DecisionOption[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const option = OPTION_LINE.exec(trimmed)
    if (option === null) {
      // Prose AFTER the options began is not part of the question -- it is a
      // model still talking, and folding it in would put a stray sentence in
      // the middle of a decision.
      if (options.length === 0) questionLines.push(trimmed)
      continue
    }
    const [label, ...rest] = (option[1] ?? '').split('::')
    let text = clean(label ?? '')
    if (text.length === 0) continue
    let note = clean(rest.join('::'))
    // The brief's own placeholder copied as the option's name -- Colin's
    // screenshot, 2026-09-25, a free Mimo run on 0.345: two buttons titled
    // "The first option" and "The second option". The model's real words
    // are the note, so they become the name, and the answer sent back names
    // what was chosen rather than a position.
    if (isPlaceholderLabel(text) && note.length > 0) {
      text = note
      note = ''
    }
    options.push({
      label: bounded(text, MAX_OPTION_LABEL_LENGTH),
      note: note.length === 0 ? undefined : bounded(note, MAX_OPTION_NOTE_LENGTH)
    })
  }

  const question = bounded(clean(questionLines.join(' ')), MAX_QUESTION_LENGTH)
  if (question.length === 0) return undefined
  if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) return undefined
  // Two options that read the same are one option twice, and a person cannot
  // choose between them. Compared case-insensitively because that is how they
  // would be read aloud.
  const seen = new Set(options.map((option) => option.label.toLowerCase()))
  if (seen.size !== options.length) return undefined
  // A permission request in a decision card's clothes. The approval card
  // already exists for "may I"; this one is for "which".
  if (options.some((option) => isBareAssent(option.label))) return undefined
  return { question, options }
}

/**
 * The transcript without its ask blocks. The question is shown as a card,
 * attributed and answerable; leaving it in the bubble too would ask the same
 * thing twice, once in a form that cannot be answered.
 */
export function stripDecisionBlocks(text: string): string {
  return text.replace(BLOCK, '').replace(/\n{3,}/gu, '\n\n').trimEnd()
}

/**
 * What the next turn is sent when a person picks. Written as the person's own
 * words because it IS their answer -- the thread shows it as the turn they
 * took, and a briefing voice there would read as the host deciding for them.
 */
export function decisionReply(option: DecisionOption): string {
  return option.note === undefined
    ? `${option.label}. Continue with that.`
    : `${option.label} (${option.note}). Continue with that.`
}
