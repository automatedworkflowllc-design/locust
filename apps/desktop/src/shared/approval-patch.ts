/**
 * Composing one unified diff out of Codex's per-file changes, so an
 * approval card can draw the change with the same viewer the activity fold
 * uses. Pure and shared: the host composes it, the renderer's tests parse
 * it back.
 *
 * What Codex sends (schema generated from the CLI on 2026-09-05, then
 * checked live with the app-server smoke): `changes: [{ path, kind: { type:
 * add | delete | update, move_path? }, diff }]`. The smoke found what the
 * schema does not say: for an ADD, `diff` is the new file's content, not a
 * unified hunk (`"smoke ok.\n"`), and `path` is absolute. So an add or a
 * delete gets its hunk synthesised here, an update's hunks are kept as
 * sent, and paths are shown relative to the folder.
 */

export interface FileChangeRecord {
  readonly path: string
  readonly kind: 'add' | 'delete' | 'update'
  readonly movePath: string | undefined
  readonly diff: string
}

/**
 * What the body STARTS with (QA-2026-09-29 round 2, R32). Both used to be
 * asked of the whole body, so an edit removing a `-- comment` line (sent as
 * `--- comment`) was taken for headers and lost its file. A diff's headers or
 * its first hunk come first; anything later is the change's own lines.
 */
const firstLine = (diff: string): string => diff.split('\n').find((line) => line.trim().length > 0) ?? ''
const hasHeaders = (diff: string): boolean => /^(---|\+\+\+) /.test(firstLine(diff))
const hasHunks = (diff: string): boolean => /^@@ /.test(firstLine(diff))

/** A path under the folder, as the folder sees it; anything else unchanged. */
export function relativeToFolder(path: string, workspacePath: string | undefined): string {
  if (workspacePath === undefined || workspacePath.length === 0) return path
  const normal = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/, '')
  const root = normal(workspacePath)
  const candidate = normal(path)
  if (candidate.toLowerCase().startsWith(`${root.toLowerCase()}/`)) return candidate.slice(root.length + 1)
  return path
}

/** Whole-file content as one hunk of added (or removed) lines. */
function contentHunk(content: string, sign: '+' | '-'): string {
  const text = content.replace(/\r\n?/g, '\n')
  const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n')
  if (lines.length === 1 && lines[0] === '') return ''
  const range = String(lines.length)
  const header = sign === '+' ? `@@ -0,0 +1,${range} @@` : `@@ -1,${range} +0,0 @@`
  return [header, ...lines.map((line) => `${sign}${line}`)].join('\n')
}

/**
 * One unified diff for the whole item: a `---` / `+++` pair per file,
 * `/dev/null` for an add or a delete, the moved-to path for a move, and a
 * synthesised hunk when Codex sent whole-file content instead of one.
 */
export function unifiedPatchText(changes: readonly FileChangeRecord[], workspacePath?: string): string {
  const parts: string[] = []
  for (const change of changes) {
    const body = change.diff.replace(/\r\n?/g, '\n').trimEnd()
    // An add or a delete is whole-file CONTENT, whatever it looks like (R32):
    // a new run-me.sh whose first lines were `--- a/README.md`, `+++ b/...`
    // and a hunk was drawn as "README.md MODIFIED", its own curl line nowhere
    // on the card. Its hunk is always built here, never read out of it.
    const whole = change.kind === 'add' || change.kind === 'delete'
    if (!whole && hasHeaders(body)) {
      parts.push(body)
      continue
    }
    const path = relativeToFolder(change.path, workspacePath)
    const moved = change.movePath === undefined ? undefined : relativeToFolder(change.movePath, workspacePath)
    const oldPath = change.kind === 'add' ? '/dev/null' : `a/${path}`
    const newPath = change.kind === 'delete' ? '/dev/null' : `b/${moved ?? path}`
    const hunks = !whole && hasHunks(body)
      ? body
      : change.kind === 'add'
        ? contentHunk(change.diff, '+')
        : change.kind === 'delete'
          ? contentHunk(change.diff, '-')
          : body
    parts.push(`--- ${oldPath}\n+++ ${newPath}${hunks.length === 0 ? '' : `\n${hunks}`}`)
  }
  return parts.join('\n')
}
