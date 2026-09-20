/**
 * Reading a file a teammate wrote, to show it beside the conversation.
 *
 * Colin, 2026-09-20: *"is there a way like what claude code has where when you
 * click a file/md it opens it over here near where our activity would be if
 * opened?"* Today a teammate writes you a report and the most the app can do
 * is put a file manager in front of it.
 *
 * THE RULE THIS INHERITS, and does not get to reinterpret: a file in the
 * workspace was written by a MODEL. `reveal-file.ts` explains why
 * `shell.openPath` is refused -- opening a `.bat` or a `.ps1` is running it --
 * and the same reasoning applies one step further in. This module decides
 * what may be READ and how much of it; the renderer decides how to draw it,
 * and it draws it the way it draws a reply, which is to say escaped.
 */

/**
 * What the viewer will read, by extension.
 *
 * An allowlist rather than "anything that is not binary". Sniffing bytes to
 * decide whether something is text is a guess, and a wrong guess here means
 * a megabyte of machine code rendered as mojibake in a panel. Every entry is
 * something a teammate plausibly writes and a person plausibly wants to read.
 */
const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  'md', 'markdown', 'txt', 'text', 'log',
  'json', 'jsonl', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env',
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rb', 'go', 'rs', 'java',
  'c', 'h', 'cpp', 'hpp', 'cs', 'swift', 'kt', 'sh', 'bash', 'ps1', 'bat',
  'css', 'scss', 'html', 'htm', 'xml', 'svg', 'sql', 'graphql', 'diff', 'patch',
  'gitignore', 'dockerignore', 'editorconfig'
])

/**
 * A quarter of a megabyte.
 *
 * Enough for any report, brief or source file a teammate writes, and small
 * enough that a runaway log cannot be handed to the renderer whole. The
 * bound is a REFUSAL rather than a truncation: half a file shown as if it
 * were the whole one is the kind of quiet lie this project keeps finding.
 */
export const MAX_TEXT_BYTES = 256 * 1024

/** The extension, lowercased, or empty for a file that has none. */
export function extensionOf(path: string): string {
  const name = path.replace(/\\/g, '/').split('/').pop() ?? ''
  // A dotfile with no second dot IS its extension: `.gitignore`, `.env`.
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return dot === 0 ? name.slice(1).toLowerCase() : ''
  return name.slice(dot + 1).toLowerCase()
}

/** Whether the viewer will open this path at all. */
export function isViewableText(path: string): boolean {
  return TEXT_EXTENSIONS.has(extensionOf(path))
}

/**
 * How the renderer should draw it: as prose, or as code.
 *
 * Markdown goes through the same renderer a reply does, which already draws
 * headings, lists, tables and fenced code exactly the way we want and escapes
 * every value on the way. Everything else is monospace in its own scroll box,
 * because a `.ts` file rendered as Markdown would eat its own asterisks.
 */
export function viewerMode(path: string): 'markdown' | 'code' {
  const extension = extensionOf(path)
  return extension === 'md' || extension === 'markdown' ? 'markdown' : 'code'
}
