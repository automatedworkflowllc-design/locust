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
   * A displayed equation: `$$...$$` or `\[...\]` (a tester's math homework,
   * 2026-09-29, came out as raw LaTeX). `source` is the lines as written, so
   * the coverage check can see nothing was dropped.
   */
  | { readonly kind: 'math'; readonly tex: string; readonly source: string }
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
      /** Item text, marker already removed, with how deeply it was nested. */
      readonly items: readonly ListItem[]
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
  /** Inline math: `$...$` or `\(...\)`, drawn by KaTeX. */
  | { readonly kind: 'math'; readonly text: string }

/** `- item`, `* item`, `+ item`. */
/**
 * One item of a list, and how deeply it was nested.
 *
 * `depth` is derived from the INDENT STACK rather than from a fixed number of
 * spaces per level, because models indent with two spaces, four spaces and
 * tabs interchangeably -- often inside one answer. What matters is that an
 * item indented further than the one above it is a child of it, whatever the
 * width; anything else turns a two-space list into depth 1 and a four-space
 * list into depth 2 and draws the same structure two ways.
 */
export interface ListItem {
  readonly text: string
  /** 0 is top level. */
  readonly depth: number
  /**
   * The numeral the model wrote, on an ordered item. A list that something
   * interrupted -- a code block between step 2 and step 3 -- resumes at the
   * number written rather than starting again at 1.
   */
  readonly number?: number
  /** Paragraphs after the first, when the item has more than one. */
  readonly paragraphs?: readonly string[]
}

/** A tab counts as four columns, which is what every runtime here emits. */
function indentWidth(prefix: string): number {
  let width = 0
  for (const char of prefix) width += char === '	' ? 4 : 1
  return width
}

const BULLET = /^([ \t]*)[-*+][ \t]+(.+)$/
/** `1. item`, `2) item`. */
const NUMBERED = /^([ \t]*)\d+[.)][ \t]+(.+)$/

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
// A closing run of hashes only after whitespace, as CommonMark has it: the
// old pattern ate any trailing `#`, so "## Why C#" read "Why C" (L15).
const HEADING = /^[ \t]{0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/

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
 * A tool call a model wrote as TEXT, fenced so it is drawn as code.
 *
 * Some free models answer with the call they meant to make --
 * `<tool_call><function=edit>...` -- as words, and the thread drew it as the
 * reply's first paragraph (the 0.271 design recheck). It is the model's
 * technical detail, not something it said to the person, so it is shown as a
 * code block labelled "tool call". An unclosed one runs to the end.
 */
export function fenceToolCalls(text: string): string {
  if (!/<tool_call>/i.test(text)) return text
  return text.replace(/<tool_call>([\s\S]*?)(?:<\/tool_call>|$)/gi, (_match, body: string) => `\n\`\`\`tool call\n${body.trim()}\n\`\`\`\n`)
}

/**
 * Split a reply into prose and fenced code blocks, in the order written.
 */
export function parseAgentText(text: string): readonly AgentBlock[] {
  const lines = fenceToolCalls(text).replace(/\r\n/g, '\n').split('\n')
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
    let items: ListItem[] = []
    let ordered = false
    /** Indent widths of the open list levels, outermost first. */
    const indents: number[] = []
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
      // A displayed equation (the 'math' block): a line opening with `$$` or
      // `\[`, to its closing mark on this line or a later one. Only when
      // nothing but punctuation follows the close, so no words are lost.
      const opening = /^\s*(\$\$|\\\[)/.exec(line)
      if (opening !== null) {
        const close = opening[1] === '$$' ? '$$' : '\\]'
        const gathered: string[] = []
        let at = index
        let rest = line.slice(line.indexOf(opening[1]!) + 2)
        let found = -1
        for (;;) {
          const end = rest.indexOf(close)
          if (end >= 0) {
            if (/^[\s.,;:]*$/.test(rest.slice(end + 2))) found = at
            gathered.push(rest.slice(0, end))
            break
          }
          gathered.push(rest)
          at += 1
          if (at >= prose.length) break
          rest = prose[at] ?? ''
        }
        const tex = gathered.join('\n').trim()
        if (found >= 0 && tex.length > 0) {
          flushList()
          flushParagraph()
          blocks.push({ kind: 'math', tex, source: prose.slice(index, found + 1).join('\n') })
          index = found
          continue
        }
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
        // A change of list kind ends the one before it -- but only at the SAME
        // depth. A numbered list nested under a bullet is a child of it, not a
        // new list, and treating it as new was half of the flattening.
        const width = indentWidth((numbered?.[1] ?? bullet![1]!))
        // Deeper than the list's OUTERMOST level, not than the innermost.
        // Compared against the innermost, the SECOND numbered child looked
        // like a sibling of the first and ended the list under it.
        const nested = indents.length > 0 && width > indents[0]!
        if (items.length > 0 && isOrdered !== ordered && !nested) flushList()
        if (items.length === 0) {
          flushParagraph()
          ordered = isOrdered
          indents.length = 0
        }
        // The indent stack: deeper pushes, shallower pops back to its level,
        // equal stays. Depth is then just how deep the stack is.
        if (indents.length === 0 || width > indents[indents.length - 1]!) {
          indents.push(width)
        } else {
          while (indents.length > 1 && width < indents[indents.length - 1]!) indents.pop()
        }
        const numeral = isOrdered ? Number(/^[ \t]*(\d+)/.exec(line)?.[1]) : Number.NaN
        items.push({
          text: (numbered?.[2] ?? bullet![2]!).trim(),
          depth: indents.length - 1,
          ...(Number.isFinite(numeral) ? { number: numeral } : {})
        })
        continue
      }
      /*
       * A WRAPPED LINE BELONGS TO THE ITEM IT IS WRAPPING.
       *
       * An item whose text ran past one line ENDED the list here, and
       * everything after the first line became a paragraph under it: the
       * bullet kept one line and the rest of the sentence sat outside the
       * list, at the left margin, in its own block. Colin saw it in the
       * "What changed" banner, which is written with two-space continuations
       * like the rest of `CHANGELOG.md` (2026-09-19, screenshot): "this
       * format is slightly off".
       *
       * Indented lines only. An UNINDENTED line after a list is ambiguous --
       * Markdown calls it a lazy continuation, and models mean it as new
       * prose about as often -- so that case keeps the old behaviour and
       * only text indented past its own marker is taken as a continuation.
       * A nested bullet never reaches here; the bullet branch above has it.
       */
      if (items.length > 0 && line.trim().length > 0) {
        const width = indentWidth(/^[ \t]*/.exec(line)?.[0] ?? '')
        if (width > (indents[indents.length - 1] ?? 0)) {
          const last = items[items.length - 1]
          if (last !== undefined) {
            items[items.length - 1] = { ...last, text: `${last.text} ${line.trim()}` }
            continue
          }
        }
      }
      /*
       * A BLANK LINE INSIDE A LIST DOES NOT END IT BY ITSELF.
       *
       * It used to, and two ordinary shapes broke on it. Models write numbered
       * steps with a blank line between each -- "1. ...", blank, "2. ..." --
       * and every step became a list of its own, each drawn as "1.". And an
       * item with a second paragraph, indented under it the way `CHANGELOG.md`
       * writes one, dropped out of the list to the left margin with its
       * source line breaks kept (the What changed page, 2026-09-22).
       *
       * So the line after the blank decides, as it does in Markdown: another
       * item continues the list; a line indented past the item's marker is
       * that item's next paragraph; anything else is prose, and the list ends
       * where it always did.
       */
      if (items.length > 0 && line.trim().length === 0) {
        let at = index + 1
        while (at < prose.length && (prose[at] ?? '').trim().length === 0) at += 1
        const after = prose[at]
        if (after !== undefined && (BULLET.test(after) || NUMBERED.test(after))) continue
        const marker = indents[indents.length - 1] ?? 0
        const indented = (text: string): boolean => indentWidth(/^[ \t]*/.exec(text)?.[0] ?? '') > marker
        const plain = (text: string): boolean =>
          !HEADING.test(text) && !QUOTE.test(text) && !RULE.test(text) && !TABLE_ROW.test(text)
        if (after !== undefined && indented(after) && plain(after)) {
          const said: string[] = []
          while (at < prose.length) {
            const next = prose[at] ?? ''
            if (next.trim().length === 0 || !indented(next) || !plain(next)) break
            if (BULLET.test(next) || NUMBERED.test(next)) break
            said.push(next.trim())
            at += 1
          }
          const last = items[items.length - 1]
          if (last !== undefined && said.length > 0) {
            items[items.length - 1] = { ...last, paragraphs: [...(last.paragraphs ?? []), said.join(' ')] }
            index = at - 1
            continue
          }
        }
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
 * A LONE TEX MACRO IS ITS SYMBOL.
 *
 * Yurt's beta report (#1): an Antigravity reply read `README.md $\rightarrow$
 * docs/README.md`. Models reach for inline math to write one arrow or one
 * sign, and the thread has no math renderer. A whole formula is better left
 * as the model wrote it than half drawn, so only a `$...$` that is exactly
 * one macro from this table becomes its character: never "$5 and $10", never
 * `$x \to y$`, and inside backticks it stays code.
 */
export const TEX_SYMBOLS: Readonly<Record<string, string>> = {
  rightarrow: '→',
  to: '→',
  longrightarrow: '⟶',
  leftarrow: '←',
  gets: '←',
  leftrightarrow: '↔',
  Rightarrow: '⇒',
  implies: '⇒',
  Leftarrow: '⇐',
  Leftrightarrow: '⇔',
  iff: '⇔',
  mapsto: '↦',
  uparrow: '↑',
  downarrow: '↓',
  times: '×',
  div: '÷',
  cdot: '·',
  pm: '±',
  mp: '∓',
  le: '≤',
  leq: '≤',
  ge: '≥',
  geq: '≥',
  ne: '≠',
  neq: '≠',
  approx: '≈',
  equiv: '≡',
  sim: '∼',
  propto: '∝',
  ll: '≪',
  gg: '≫',
  infty: '∞',
  degree: '°',
  circ: '∘',
  bullet: '•',
  checkmark: '✓',
  ldots: '…',
  dots: '…',
  cdots: '⋯',
  in: '∈',
  notin: '∉',
  subset: '⊂',
  subseteq: '⊆',
  cup: '∪',
  cap: '∩',
  emptyset: '∅',
  forall: '∀',
  exists: '∃',
  neg: '¬',
  land: '∧',
  lor: '∨',
  therefore: '∴',
  sum: '∑',
  prod: '∏',
  partial: '∂',
  nabla: '∇',
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  theta: 'θ',
  lambda: 'λ',
  mu: 'μ',
  pi: 'π',
  sigma: 'σ',
  tau: 'τ',
  phi: 'φ',
  omega: 'ω',
  Gamma: 'Γ',
  Delta: 'Δ',
  Theta: 'Θ',
  Lambda: 'Λ',
  Pi: 'Π',
  Sigma: 'Σ',
  Phi: 'Φ',
  Omega: 'Ω'
}

/**
 * Inline math (a tester's math homework, 2026-09-29): `$...$` or `\(...\)`.
 *
 * A dollar is also money, so the pandoc rule: the opening `$` is followed by
 * a non-space and is not `$$`, the closing `$` follows a non-space and is not
 * followed by a digit, and an escaped `\$` is never one. "$5 and $10" stays
 * prose; "$x^2$" and "$c_1=y$" are math. Groups 9 and 10.
 */
const INLINE_MATH = /(?<![\\$])\$(?![\s$])([^$\n]*?[^\s\\$])\$(?![\d$])|\\\(([^\n]+?)\\\)/.source

/** `$\name$`, spaces allowed inside the dollars, for a name in the table and nothing else. */
const TEX_MACRO = `\\$[ \\t]*\\\\(${Object.keys(TEX_SYMBOLS)
  .sort((a, b) => b.length - a.length)
  .join('|')})[ \\t]*\\$`

/*
 * Inline code first, then links. Models write absolute paths inside link
 * targets -- `[src/streak.test.js](C:/Users/.../streaks/src/streak.test.js)`
 * -- and rendering the raw syntax put the whole path in the middle of a
 * sentence. The label is what the sentence needs; the target is kept on the
 * element's title so it is available without being in the way. Nothing is
 * linked: a thread must not become a way to navigate the app somewhere.
 * Emphasis after code and links, so `**` inside a code span stays literal
 * and a link label can itself be bold. `**bold**` and `__bold__` are
 * strong; `*em*` and `_em_` are emphasis, but only when the marker sits at
 * a word edge -- `snake_case_name` must not become "snake" + em("case") +
 * "name", and `2 * 3 * 4` is arithmetic. The QA pass on 0.21.2 read a
 * literal `**Yes, whitespace-only input is already covered.**` in a Claude
 * reply, which is the model's own emphasis drawn as four asterisks.
 *
 * An EMPHASISED link is its own alternative, and it has to come before the
 * emphasis ones.
 *
 * Colin, 2026-09-14, with a screenshot of a Cursor reply: a whole
 * `*[We Must Pace the Frontier](https://darioamodei.com/post/...)*` rendered
 * in italics with the brackets and the URL sitting in the middle of the
 * sentence. Models write this constantly -- an italicised article title
 * that is also the link.
 *
 * The scan finds the earliest match, and `*` comes before `[`, so the
 * emphasis alternative won and captured the entire link as its text. An
 * emphasis span's text is not parsed again, so the link syntax inside it
 * rendered literally. Handling the pair explicitly is enough; going
 * recursive would mean giving `strong` and `em` children instead of text,
 * which is a much larger change than one bad line deserves.
 *
 * A lone TeX macro last (TEX_SYMBOLS): nothing else starts with a dollar.
 */
const INLINE = new RegExp(
  `${
    /`([^`\n]+)`|\[([^\]\n]+)\]\(([^)\s]+)\)|(?:\*\*|__|\*|_)\[([^\]\n]+)\]\(([^)\s]+)\)(?:\*\*|__|\*|_)|(?:\*\*|(?<![A-Za-z0-9_])__)(?=\S)([^\n]+?\S)(?:\*\*|__(?![A-Za-z0-9_]))|(?<![A-Za-z0-9*_])(?:\*|_)(?=\S)([^\n*_]*?[^\s*_])(?:\*|_)(?![A-Za-z0-9*_])/
      .source
  }|${TEX_MACRO}|${INLINE_MATH}`,
  'g'
)

/**
 * Split prose into plain runs and `inline code` runs.
 *
 * Only a matched pair on one line counts. A lone backtick is a backtick a
 * person typed, and it stays visible as one.
 */
export function splitInlineCode(text: string): readonly InlineSpan[] {
  const spans: InlineSpan[] = []
  let cursor = 0
  for (const match of text.matchAll(INLINE)) {
    const at = match.index
    if (at > cursor) spans.push({ kind: 'plain', text: text.slice(cursor, at) })
    if (match[1] !== undefined) {
      spans.push({ kind: 'code', text: match[1] })
    } else if (match[2] !== undefined) {
      spans.push({ kind: 'link', text: match[2], href: match[3]! })
    } else if (match[4] !== undefined) {
      // `*[label](url)*` -- a link that happened to be italicised. It reads
      // as a link; the italics were decoration on the label.
      spans.push({ kind: 'link', text: match[4], href: match[5]! })
    } else if (match[6] !== undefined) {
      spans.push({ kind: 'strong', text: match[6] })
    } else if (match[7] !== undefined) {
      spans.push({ kind: 'em', text: match[7] })
    } else if (match[9] !== undefined || match[10] !== undefined) {
      spans.push({ kind: 'math', text: (match[9] ?? match[10]!).trim() })
    } else {
      spans.push({ kind: 'plain', text: TEX_SYMBOLS[match[8]!] ?? match[0] })
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
        : block.kind === 'math'
          ? block.source
        : block.kind === 'code'
          ? block.code
          : block.kind === 'rule'
            ? ''
            : block.kind === 'table'
              ? [block.header, ...block.rows].map((row) => row.join(' ')).join('\n')
              : block.items.map((item) => [item.text, ...(item.paragraphs ?? [])].join('\n')).join('\n')
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
        // `$2`, not `$1`: both matchers capture the INDENT first now, so a
        // list item's words are the second group. Caught by this very check
        // the moment nesting landed, which is what it is for.
        .replace(BULLET, '$2')
        .replace(NUMBERED, '$2')
        .replace(QUOTE, '$1')
        .trim()
    )
    .map((line) => (TABLE_ROW.test(line) ? tableCells(line).join(' ') : line))
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim()
  return kept === expected
}
