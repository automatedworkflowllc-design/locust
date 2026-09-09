/**
 * Attaching a file that is not in the workspace.
 *
 * The picker used to refuse one outright -- "Those files are outside the
 * folder your teammates work in, so they cannot be read." Colin, 2026-09-08,
 * with a screenshot of exactly that: "we should definitely be able to share
 * photos or attach stuff outside of the folder much like claude."
 *
 * MEASURED first, because the refusal was not wrong about every runtime
 * (`docs/ATTACHMENTS-OUTSIDE-2026-09-08.md`). Asked to read an absolute path
 * outside the folder they were started in:
 *
 *   Cursor Agent  read it
 *   Claude Code   "CANNOT READ"
 *   Copilot CLI   "Permission denied and could not request permission"
 *   OpenCode      "permission requested: external_directory ... auto-rejecting"
 *
 * So a reference to an outside path is real on ONE of four. The native flags
 * fare better but not consistently -- `opencode -f` reads an outside file
 * fine, `copilot --attachment` takes an outside IMAGE and rejects an outside
 * `.txt` outright ("must be an image or native document") -- which would make
 * "can I attach this?" depend on the route and the file type together, and
 * that is a question no one should have to hold in their head.
 *
 * So: bring the file to where every runtime can already read it. One copy,
 * into a folder Locust owns inside the workspace, and the same reference path
 * every attachment already uses. It works on all six with no adapter change,
 * and it is honest -- the file really is there, and the app says it put it
 * there.
 *
 * The two rules it keeps:
 *   - It is the only thing Locust writes into someone's project uninvited, so
 *     it goes in ONE named folder and that folder is kept out of git.
 *   - It never overwrites. A second `report.pdf` becomes `report-2.pdf`, so
 *     attaching two files that happen to share a name cannot silently send
 *     the same one twice.
 */

import { basename, extname } from 'node:path'

// One definition, in shared: the renderer's attachment tile names this folder
// too, and two copies of a path constant is how they drift.
import { ATTACHMENT_DIR } from '../shared/attachments.js'

export { ATTACHMENT_DIR }

/** What `.git/info/exclude` needs so the folder never reaches a commit. */
export const GIT_EXCLUDE_LINE = '.locust/'

/**
 * A workspace-relative destination for an outside file that collides with
 * nothing already taken.
 *
 * `taken` is every name already in the folder plus every name chosen earlier
 * in the same batch -- both matter, because attaching two `notes.md` from two
 * folders at once is the case a directory listing alone would miss.
 */
export function attachmentDestination(source: string, taken: ReadonlySet<string>): string {
  const name = basename(source)
  /*
   * The name has to be a NAME, not a way out of the folder.
   *
   * `basename` does not always return a plain filename. Measured:
   *
   *   basename('C:\\a\\..')  ->  '..'     ->  .locust/attachments/..  ->  .locust
   *   basename('C:\\a\\.')   ->  '.'      ->  the attachments folder itself
   *   basename('C:\\')       ->  ''       ->  the attachments folder itself
   *
   * So a source of that shape produced a destination ABOVE the folder this is
   * supposed to write into, and two others produced the folder itself, which
   * would try to write a file over a directory.
   *
   * The OS file dialog cannot return those, so nothing a person does reaches
   * this today -- but a function that BUILDS A WRITE PATH must not depend on
   * its caller to be safe. `LOCUST_ATTACH_PATHS` already feeds it strings from
   * somewhere else, and the next caller will not read this comment first.
   *
   * A colon is refused with them: on Windows `file.txt:stream` names an
   * alternate data stream rather than a file, and a picked file never has one.
   */
  if (name === '' || name === '.' || name === '..' || /[\\/:]/.test(name)) {
    throw new Error(`That file cannot be attached: "${basename(source)}" is not a file name.`)
  }
  if (!taken.has(name)) return `${ATTACHMENT_DIR}/${name}`
  const extension = extname(name)
  const stem = extension.length === 0 ? name : name.slice(0, -extension.length)
  // Starts at 2, because the file it is avoiding is the first one.
  for (let suffix = 2; suffix < 1_000; suffix += 1) {
    const candidate = `${stem}-${String(suffix)}${extension}`
    if (!taken.has(candidate)) return `${ATTACHMENT_DIR}/${candidate}`
  }
  throw new Error(`Too many files named ${name} are already attached.`)
}

/**
 * The exclude file's new contents, or undefined when it already covers us.
 *
 * `.git/info/exclude` rather than `.gitignore`: the project's own ignore file
 * is a tracked file that belongs to whoever owns the repository, and adding a
 * line to it would show up in their next `git status` as a change they did not
 * make. This one is local, untracked, and exists for exactly this.
 */
export function excludeWith(current: string): string | undefined {
  const lines = current.split('\n').map((line) => line.trim())
  if (lines.includes(GIT_EXCLUDE_LINE) || lines.includes('.locust') || lines.includes('/.locust/')) {
    return undefined
  }
  const body = current.length === 0 || current.endsWith('\n') ? current : `${current}\n`
  return `${body}${GIT_EXCLUDE_LINE}\n`
}
