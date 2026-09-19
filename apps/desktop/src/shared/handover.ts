/**
 * The file block: how a teammate hands a file to the person.
 *
 * Locust could already take files IN -- the `+` in the composer attaches
 * them, and the person's turn draws each one as a button that reveals it.
 * Nothing went the other way. Colin, 2026-09-19, with a screenshot: he asked
 * Yurt to "send me an md of your report" and got back a file path as text,
 * which is the app telling a person to go and find it themselves.
 *
 *     <locust-file>
 *     docs/report.md :: the rollup you asked for
 *     </locust-file>
 *
 * One path per line, the note after `::` optional, paths relative to the
 * folder the teammates work in. Same shape as every other block this host
 * reads, for the same reason `peer-share.ts` gives: `codex exec` and
 * `claude -p` are one prompt in and one transcript out, so a decision has to
 * travel in the transcript in a form the host can find without guessing.
 *
 * WHAT THIS BLOCK CANNOT DO, which is what makes it safe to let a model write
 * one. It hands over a file that is ALREADY on disk -- the teammate wrote it
 * during the turn, through the same sandbox every other write goes through.
 * Nothing here creates, moves or reads a file, and nothing is recorded to the
 * ledger. The card is a pointer, and pressing it reveals the file in the
 * person's file manager. It never opens it: `shell.openPath` would RUN a
 * `.bat` or a `.ps1` a model had just written, which is why the host's
 * reveal handler refuses to open and says so in its own comment. Do not add
 * an Open button here.
 *
 * Shared between main and renderer so the parser that draws the card and the
 * one that hides the block from the bubble are the same function.
 */

export const FILE_TAG = 'locust-file'

/**
 * Four, matching `MAX_SHARES_PER_MISSION`.
 *
 * Not a safety bound -- the paths are already on disk. It is a drawing bound:
 * a reply that ends in eleven file buttons has buried its own answer, and a
 * model that wants to hand over eleven files wants to hand over a folder.
 */
export const MAX_FILES_PER_REPLY = 4

/** A note is a caption for a button, so it is bounded like one. */
export const MAX_FILE_NOTE_LENGTH = 120

const BLOCK = /<locust-file\s*>([\s\S]*?)<\/locust-file>/g

export interface HandedFile {
  /** Workspace-relative, forward slashes, never absolute and never `..`. */
  readonly path: string
  readonly note?: string
}

/**
 * Paths this app will not draw a button for.
 *
 * The rule is narrow on purpose: a handed path is joined to the workspace
 * folder and handed to the host's reveal, so anything that could ESCAPE that
 * folder is refused here rather than being resolved and argued about later.
 * A dropped line is simply not drawn -- no card, no error to the model -- the
 * same way `parseShareBlocks` drops a block with no recipient.
 */
function acceptable(path: string): boolean {
  if (path.length === 0 || path.length > 400) return false
  // A control character in a path is never a real path and is exactly what a
  // terminal-escape trick looks like; the store refuses them too.
  if (/[\u0000-\u001f\u007f]/.test(path)) return false
  // Absolute, in either spelling, plus a Windows drive letter and a UNC
  // share. The path is relative to the workspace by definition.
  if (path.startsWith('/') || path.startsWith('\\') || /^[a-z]:/i.test(path)) return false
  // `..` anywhere, as a whole segment. `..foo` is a legal file name.
  if (path.split(/[\\/]/).some((segment) => segment === '..')) return false
  return true
}

/** `docs\report.md` -> `docs/report.md`. One spelling reaches the host. */
function normalize(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').trim()
}

/**
 * The files a reply hands over, in the order they were written.
 *
 * Every line of every block is read, so a model that writes two blocks gets
 * both -- the cap is on files, not on blocks, because the cap is about what
 * the thread can usefully draw.
 */
export function parseFileBlocks(text: string): readonly HandedFile[] {
  const files: HandedFile[] = []
  const seen = new Set<string>()
  for (const match of text.matchAll(BLOCK)) {
    for (const line of (match[1] ?? '').split('\n')) {
      if (files.length >= MAX_FILES_PER_REPLY) return files
      const trimmed = line.trim().replace(/^[-*]\s+/, '')
      if (trimmed.length === 0) continue
      const [rawPath, ...rest] = trimmed.split('::')
      const path = normalize(rawPath ?? '')
      if (!acceptable(path)) continue
      // The same file twice is one button. A model listing a file it wrote
      // and then summarising its files is not handing it over twice.
      if (seen.has(path)) continue
      seen.add(path)
      const note = rest.join('::').trim()
      files.push({
        path,
        ...(note.length === 0
          ? {}
          : { note: note.length <= MAX_FILE_NOTE_LENGTH ? note : `${note.slice(0, MAX_FILE_NOTE_LENGTH - 1)}…` })
      })
    }
  }
  return files
}

/**
 * The reply without its file blocks. The files are drawn as their own row of
 * buttons under the message; leaving the raw tags in the bubble would show
 * the person the protocol instead of the answer.
 */
export function stripFileBlocks(text: string): string {
  return text.replace(BLOCK, '').replace(/\n{3,}/g, '\n\n').trimEnd()
}
