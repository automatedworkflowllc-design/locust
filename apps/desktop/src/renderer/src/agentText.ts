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
  /**
   * A markdown table, drawn as columns.
   *
   * Teammates write these constantly -- a quarter against a quarter, one
   * model against another -- and the thread printed the pipes. Colin,
   * 2026-09-13, on a reply whose whole point was a financial comparison:
   * "i feel like our harness is TRYING to with bolded text and good
   * structure... is there anyway we can make it work like claude code."
   *
   * It was trying: headings, lists, code and the inline marks all render.
   * A table fell through to prose and came out as punctuation.
   */
  | {
      readonly kind: 'table'
      readonly header: readonly string[]
      /** Per column, from the `:---:` row; undefined where none was given. */
      readonly align: readonly ('left' | 'right' | 'center' | undefined)[]
      readonly rows: readonly (readonly string[])[]
    }
  /** `---`, `***`, `___` alone on a line: a divider, not three hyphens. */
  | { readonly kind: 'rule' }
  /** `> ` lines. Models use them for cautions, which should not read as punctuation. */
  | { readonly kind: 'quote'; readonly text: string }
  | {
      readonly kind: 'code'
      readonly code: string
      /** The word after the opening fence, when the model named one. */
      readonly language: string | undefined
      /** False while the closing fence has not arrived yet. */
      readonly closed: boolean
    }

  | {
      readonly kind: 'list'
      readonly ordered: boolean
      /** Item text, marker already removed. */
      readonly items: readonly string[]
    }
  | {
      /** `# Title` through `### Title`. Deeper levels are drawn as the third. */
      readonly kind: 'heading'
      readonly level: 1 | 2 | 3
      readonly text: string
    }

export type InlineSpan =
  | { readonly kind: 'plain'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'link'; readonly text: string; readonly href: string }
  | { readonly kind: 'strong'; readonly text: string }
  | { readonly kind: 'em'; readonly text: string }

/** `- item`, `* item`, `+ item`. */
const BULLET = /^[ \t]*[-*+][ \t]+(.+)$/
/** `1. item`, `2) item`. */
const NUMBERED = /^[ \t]*\d+[.)][ \t]+(.+)$/

/** ```lang, or ``` on its own. Leading spaces are allowed; models indent them. */
/** One newline, written once. */
const NEWLINE = String.fromCharCode(10)

const FENCE = /^[ \t]*(`{3,})[ \t]*(.*)$/

/**
 * `# Title`, `## Title`, `### Title`. The QA pass on 0.21.2 read a literal
 * `### Summary` in a Codex reply: a heading is the model saying "this part
 * is about that", and drawing the hashes throws the structure away while
 * keeping the punctuation.
 */
const HEADING = /^[ \t]{0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/

/**
 * A table row: a line carrying a pipe with content either side. Leading and
 * trailing pipes are optional because that is what models actually emit.
 */
const TABLE_ROW = /^[ \t]{0,3}\|?[^\n]*\|[^\n]*$/

/**
 * `|---|:--:|---:|` -- the line that turns the row above it into a header.
 *
 * A table needs BOTH. A sentence with a pipe in it is prose, and a row of
 * hyphens with nothing above it is prose too; requiring the pair is what
 * keeps ordinary writing out of a table.
 */
const TABLE_RULE = /^[ \t]{0,3}\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/

/** `---`, `***` or `___` alone on a line. */
const RULE = /^[ \t]{0,3}(-{3,}|\*{3,}|_{3,})[ \t]*$/

/** `> quoted`, with the marker taken off. */
const QUOTE = /^[ \t]{0,3}>[ \t]?(.*)$/

/** Split a row on its pipes, dropping the empty edges a fully-piped row has. */
function tableCells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
}

function columnAlignment(rule: string): ('left' | 'right' | 'center' | undefined)[] {
  return tableCells(rule).map((cell) => {
    const left = cell.startsWith(':')
    const right = cell.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    if (left) return 'left'
    return undefined
  })
}

/**
 * Split a reply into prose and fenced code blocks, in the order written.
 */
export function parseAgentText(text: string): readonly AgentBlock[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: AgentBlock[] = []
  let prose: string[] = []
  let open: { readonly ticks: string; readonly language: string | undefined; readonly lines: string[] } | undefined

  /**
   * Prose, with any run of list lines lifted out as a list.
   *
   * MEASURED 2026-09-03: a model summarising its work wrote
   * "Implemented the streak fix. - `currentStreak` now counts... - It resets
   * once yesterday is missing. - Date arithmetic now uses UTC..." and the
   * thread drew it as one run-on sentence, because a paragraph collapses the
   * newlines the markers sat on. The list is the shape of the answer; drawing
   * it flat throws that away.
   */
  const flushProse = (): void => {
    if (prose.length === 0) return
    let paragraph: string[] = []
    let items: string[] = []
    let ordered = false
    const flushParagraph = (): void => {
      const joined = paragraph.join('\n')
      // Whitespace between blocks is layout, not content: the gap between a
      // paragraph and the code under it is drawn by CSS, not by blank lines.
      if (joined.trim().length > 0) blocks.push({ kind: 'text', text: joined.replace(/^\n+|\n+$/g, '') })
      paragraph = []
    }
    const flushList = (): void => {
      if (items.length === 0) return
      blocks.push({ kind: 'list', ordered, items })
      items = []
    }
    /*
     * A table is a header row, a rule under it, and the rows that follow.
     *
     * BOTH halves are required. A sentence with a pipe in it is prose, and a
     * row of hyphens with nothing above it is prose -- demanding the pair is
     * what keeps ordinary writing out of a table.
     */
    for (let index = 0; index < prose.length; index += 1) {
      const line = prose[index] ?? ''
      const next = prose[index + 1]
      if (TABLE_ROW.test(line) && next !== undefined && TABLE_RULE.test(next)) {
        const header = tableCells(line)
        const align = columnAlignment(next)
        const rows: string[][] = []
        let at = index + 2
        while (at < prose.length && TABLE_ROW.test(prose[at] ?? '') && !TABLE_RULE.test(prose[at] ?? '')) {
          rows.push(tableCells(prose[at] ?? ''))
          at += 1
        }
        flushList()
        flushParagraph()
        blocks.push({ kind: 'table', header, align, rows })
        index = at - 1
        continue
      }
      if (RULE.test(line)) {
        flushList()
        flushParagraph()
        blocks.push({ kind: 'rule' })
        continue
      }
      const quoted = QUOTE.exec(line)
      if (quoted !== null) {
        flushList()
        flushParagraph()
        const said: string[] = [quoted[1] ?? '']
        let at = index + 1
        while (at < prose.length) {
          const more = QUOTE.exec(prose[at] ?? '')
          if (more === null) break
          said.push(more[1] ?? '')
          at += 1
        }
        blocks.push({ kind: 'quote', text: said.join(NEWLINE).trim() })
        index = at - 1
        continue
      }
      const heading = HEADING.exec(line)
      if (heading !== null) {
        flushList()
        flushParagraph()
        const depth = heading[1]!.length
        blocks.push({ kind: 'heading', level: depth === 1 ? 1 : depth === 2 ? 2 : 3, text: heading[2]!.trim() })
        continue
      }
      const bullet = BULLET.exec(line)
      const numbered = NUMBERED.exec(line)
      if (bullet !== null || numbered !== null) {
        const isOrdered = numbered !== null
        // A change of list kind ends the one before it.
        if (items.length > 0 && isOrdered !== ordered) flushList()
        if (items.length === 0) {
          flushParagraph()
          ordered = isOrdered
        }
        items.push((numbered?.[1] ?? bullet![1]!).trim())
        continue
      }
      // A blank line inside a list ends it; prose after it is prose.
      if (items.length > 0 && line.trim().length === 0) {
        flushList()
        continue
      }
      flushList()
      paragraph.push(line)
    }
    flushList()
    flushParagraph()
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
  // Inline code first, then links. Models write absolute paths inside link
  // targets -- `[src/streak.test.js](C:/Users/.../streaks/src/streak.test.js)`
  // -- and rendering the raw syntax put the whole path in the middle of a
  // sentence. The label is what the sentence needs; the target is kept on the
  // element's title so it is available without being in the way. Nothing is
  // linked: a thread must not become a way to navigate the app somewhere.
  // Emphasis after code and links, so `**` inside a code span stays literal
  // and a link label can itself be bold. `**bold**` and `__bold__` are
  // strong; `*em*` and `_em_` are emphasis, but only when the marker sits at
  // a word edge -- `snake_case_name` must not become "snake" + em("case") +
  // "name", and `2 * 3 * 4` is arithmetic. The QA pass on 0.21.2 read a
  // literal `**Yes, whitespace-only input is already covered.**` in a Claude
  // reply, which is the model's own emphasis drawn as four asterisks.
  const pattern =
    /`([^`\n]+)`|\[([^\]\n]+)\]\(([^)\s]+)\)|(?:\*\*|__)(?=\S)([^\n]+?\S)(?:\*\*|__)|(?<![A-Za-z0-9*_])(?:\*|_)(?=\S)([^\n*_]+?\S)(?:\*|_)(?![A-Za-z0-9*_])/g
  let cursor = 0
  for (const match of text.matchAll(pattern)) {
    const at = match.index
    if (at > cursor) spans.push({ kind: 'plain', text: text.slice(cursor, at) })
    if (match[1] !== undefined) {
      spans.push({ kind: 'code', text: match[1] })
    } else if (match[2] !== undefined) {
      spans.push({ kind: 'link', text: match[2], href: match[3]! })
    } else if (match[4] !== undefined) {
      spans.push({ kind: 'strong', text: match[4] })
    } else {
      spans.push({ kind: 'em', text: match[5]! })
    }
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
    .map((block) =>
      block.kind === 'text' || block.kind === 'heading' || block.kind === 'quote'
        ? block.text
        : block.kind === 'code'
          ? block.code
          : block.kind === 'rule'
            ? ''
            : block.kind === 'table'
              ? [block.header, ...block.rows].map((row) => row.join(' ')).join('\n')
              : block.items.join('\n')
    )
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim()
  const expected = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !FENCE.test(line))
    // A list marker is punctuation the renderer redraws, not words: the
    // bullet becomes a real bullet. Everything AFTER the marker still has to
    // survive, which is what this is checking.
    /*
     * Punctuation the renderer REDRAWS is not content it dropped. A bullet
     * becomes a real bullet, a `>` becomes an indent, `---` becomes a line,
     * and a table's pipes become its columns -- what has to survive is the
     * words either side of each of them.
     */
    .filter((line) => !RULE.test(line) && !TABLE_RULE.test(line))
    .map((line) =>
      line
        .replace(HEADING, '$2')
        .replace(BULLET, '$1')
        .replace(NUMBERED, '$1')
        .replace(QUOTE, '$1')
        .trim()
    )
    .map((line) => (TABLE_ROW.test(line) ? tableCells(line).join(' ') : line))
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim()
  return kept === expected
}
