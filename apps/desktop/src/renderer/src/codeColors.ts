import type { HighlighterCore, LanguageRegistration, ThemedToken } from 'shiki/core'

/**
 * CODE IN A REPLY, IN COLOUR (0.719).
 *
 * The plan of 2026-10-10, from a look through t3code: Claude Code, Codex
 * and t3code colour the code in a reply; Locust drew it in one grey. Shiki
 * (MIT) colours it with the same grammars VS Code uses.
 *
 * Nothing is fetched and nothing loads until a reply has code: the
 * highlighter and each language's grammar are bundled chunks, imported the
 * first time a block in that language is drawn. The regex engine is Shiki's
 * JavaScript one, not its WebAssembly one, so the page needs nothing its
 * rules do not already allow. The colours are CSS variables (Shiki's
 * css-variables theme), set from Locust's own tokens in shell.css, so a
 * block follows the theme like everything around it.
 *
 * A block in a language not listed here, or too large to be worth it, stays
 * as it was: plain text, which is never wrong.
 */

type Grammar = () => Promise<{ readonly default: LanguageRegistration[] }>

/** Each grammar Locust carries, by Shiki's name. */
const GRAMMARS: Readonly<Record<string, Grammar>> = {
  typescript: () => import('shiki/langs/typescript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  jsonc: () => import('shiki/langs/jsonc.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  powershell: () => import('shiki/langs/powershell.mjs'),
  bat: () => import('shiki/langs/bat.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  dockerfile: () => import('shiki/langs/dockerfile.mjs'),
  ini: () => import('shiki/langs/ini.mjs'),
  lua: () => import('shiki/langs/lua.mjs')
}

/** What a fence says -> the grammar it means. */
const ALIASES: Readonly<Record<string, string>> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  sh: 'shellscript',
  bash: 'shellscript',
  zsh: 'shellscript',
  shell: 'shellscript',
  console: 'shellscript',
  ps1: 'powershell',
  pwsh: 'powershell',
  ps: 'powershell',
  cmd: 'bat',
  batch: 'bat',
  htm: 'html',
  md: 'markdown',
  yml: 'yaml',
  rs: 'rust',
  golang: 'go',
  kt: 'kotlin',
  'c++': 'cpp',
  cc: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  'c#': 'csharp',
  rb: 'ruby',
  patch: 'diff',
  svg: 'xml',
  docker: 'dockerfile',
  cfg: 'ini',
  conf: 'ini'
}

/** Larger than this is drawn plain: colouring it would cost more than it gives. */
export const MAX_COLOURED_CHARACTERS = 60_000

export interface ColouredToken {
  readonly content: string
  /** A `var(--shiki-…)` colour, or undefined for the block's own. */
  readonly color?: string
}

/** The grammar a fence's word names, or undefined when Locust carries none for it. */
export function grammarFor(language: string | undefined): string | undefined {
  if (language === undefined) return undefined
  const word = language.trim().toLowerCase()
  const name = ALIASES[word] ?? word
  return Object.hasOwn(GRAMMARS, name) ? name : undefined
}

let highlighter: Promise<HighlighterCore> | undefined
const loaded = new Map<string, Promise<void>>()
/** The last blocks coloured, so a reply drawn again is coloured at once. */
const kept = new Map<string, readonly (readonly ColouredToken[])[]>()
const KEPT = 200

function theHighlighter(): Promise<HighlighterCore> {
  highlighter ??= (async () => {
    const [{ createHighlighterCore, createCssVariablesTheme }, { createJavaScriptRegexEngine }] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript')
    ])
    return createHighlighterCore({
      themes: [createCssVariablesTheme({ name: 'locust', variablePrefix: '--shiki-', fontStyle: false })],
      langs: [],
      engine: createJavaScriptRegexEngine()
    })
  })()
  return highlighter
}

const keyOf = (code: string, grammar: string): string => `${grammar}\u0000${code}`

/** What was coloured before, at once, or undefined. */
export function colouredAlready(code: string, language: string | undefined): readonly (readonly ColouredToken[])[] | undefined {
  const grammar = grammarFor(language)
  return grammar === undefined ? undefined : kept.get(keyOf(code, grammar))
}

/** The block's lines as coloured tokens, or undefined when it stays plain. */
export async function colourCode(code: string, language: string | undefined): Promise<readonly (readonly ColouredToken[])[] | undefined> {
  const grammar = grammarFor(language)
  if (grammar === undefined || code.length === 0 || code.length > MAX_COLOURED_CHARACTERS) return undefined
  const key = keyOf(code, grammar)
  const before = kept.get(key)
  if (before !== undefined) return before
  try {
    const shiki = await theHighlighter()
    let loading = loaded.get(grammar)
    if (loading === undefined) {
      loading = GRAMMARS[grammar]!().then((module) => shiki.loadLanguage(...module.default))
      loaded.set(grammar, loading)
    }
    await loading
    const lines = shiki.codeToTokensBase(code, { lang: grammar, theme: 'locust' }).map((line) =>
      line.map((token: ThemedToken) => (token.color === undefined || /--shiki-foreground\b/.test(token.color) ? { content: token.content } : { content: token.content, color: token.color }))
    )
    kept.set(key, lines)
    if (kept.size > KEPT) kept.delete(kept.keys().next().value!)
    return lines
  } catch {
    // A grammar that would not load or a block it could not read: plain, as before.
    loaded.delete(grammar)
    return undefined
  }
}
