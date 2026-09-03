/**
 * What a model actually writes, split into the pieces a thread can draw.
 *
 * Models answer in Markdown whether or not anyone asked them to, and the
 * thread rendered every reply as one flat paragraph. That is worst exactly
 * when it matters most: a read-only run cannot edit the workspace, so it
 * pastes the patch INTO its answer, and a unified diff rendered as prose --
 * every newline collapsed, every leading `+`/`-` run together -- is the one
 * shape of reply nobody can read. Measured 2026-09-03 while using the app.
 *
 * Two rules govern everything here:
 *
 *   1. NOTHING IS EVER DROPPED. Every character of the model's text reaches
 *      the screen in some segment. A renderer that silently eats a sentence
 *      because a backtick was unbalanced is worse than no formatting at all,
 *      so `segmentsCoverInput` below is the invariant the tests hold it to.
 *   2. An unterminated fence is a fence in progress, not a mistake. Replies
 *      stream, so the closing ``` arrives after the code it closes; that has
 *      to render as code the whole time, never as prose that reformats itself
 *      when the last token lands.
 */

export type AgentBlock =
  | { readonly kind: 'text'; readonly text: string }
  | {
      readonly kind: 'code'
      readonly code: string
      /** The word after the opening fence, when the model named one. */
      readonly language: string | undefined
      /** False while the closing fence has not arrived yet. */
      readonly closed: boolean
    }

export type InlineSpan =
  | { readonly kind: 'plain'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string }

/** ```lang, or ``` on its own. Leading spaces are allowed; models indent them. */
const FENCE = /^[ \t]*(`{3,})[ \t]*(.*)$/

/**
 * Split a reply into prose and fenced code blocks, in the order written.
 */
export function parseAgentText(text: string): readonly AgentBlock[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: AgentBlock[] = []
  let prose: string[] = []
  let open: { readonly ticks: string; readonly language: string | undefined; readonly lines: string[] } | undefined

  const flushProse = (): void => {
    if (prose.length === 0) return
    const joined = prose.join('\n')
    // Whitespace between blocks is layout, not content: the gap between a
    // paragraph and the code under it is drawn by CSS, not by blank lines.
    if (joined.trim().length > 0) blocks.push({ kind: 'text', text: joined.replace(/^\n+|\n+$/g, '') })
    prose = []
  }

  for (const line of lines) {
    const fence = FENCE.exec(line)
    if (open === undefined) {
      if (fence !== null) {
        flushProse()
        const language = fence[2]!.trim()
        open = { ticks: fence[1]!, language: language.length === 0 ? undefined : language, lines: [] }
        continue
      }
      prose.push(line)
      continue
    }
    // A closing fence carries no language and is at least as long as the one
    // that opened it -- so ```` inside a ``` block stays part of the code.
    if (fence !== null && fence[2]!.trim().length === 0 && fence[1]!.length >= open.ticks.length) {
      blocks.push({ kind: 'code', code: open.lines.join('\n'), language: open.language, closed: true })
      open = undefined
      continue
    }
    open.lines.push(line)
  }

  if (open !== undefined) {
    blocks.push({ kind: 'code', code: open.lines.join('\n'), language: open.language, closed: false })
  } else {
    flushProse()
  }
  return blocks
}

/**
 * Split prose into plain runs and `inline code` runs.
 *
 * Only a matched pair on one line counts. A lone backtick is a backtick a
 * person typed, and it stays visible as one.
 */
export function splitInlineCode(text: string): readonly InlineSpan[] {
  const spans: InlineSpan[] = []
  const pattern = /`([^`\n]+)`/g
  let cursor = 0
  for (const match of text.matchAll(pattern)) {
    const at = match.index
    if (at > cursor) spans.push({ kind: 'plain', text: text.slice(cursor, at) })
    spans.push({ kind: 'code', text: match[1]! })
    cursor = at + match[0].length
  }
  if (cursor < text.length) spans.push({ kind: 'plain', text: text.slice(cursor) })
  return spans.length === 0 ? [{ kind: 'plain', text }] : spans
}

/**
 * Every non-fence line of the input appears in some block: the guarantee that
 * formatting a reply never costs a word of it. Exported so the tests can hold
 * any input to it rather than only the ones someone thought to write down.
 */
export function segmentsCoverInput(text: string, blocks: readonly AgentBlock[]): boolean {
  const kept = blocks
    .map((block) => (block.kind === 'text' ? block.text : block.code))
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim()
  const expected = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !FENCE.test(line))
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim()
  return kept === expected
}
