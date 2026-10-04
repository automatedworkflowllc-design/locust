import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative } from 'node:path'

import { ATTACHMENT_DIR, splitAttachments, withAttachments } from '../shared/attachments.js'
import { excludeWith } from './attach-outside.js'

/**
 * The files a message attached, placed where THIS run can read them.
 *
 * M16 (the code review): the message names its files relative to the project
 * folder, and copies of outside files land in `<project>/.locust/attachments`.
 * A teammate with Own branch runs in `<project>/.locust/worktrees/<id>`, and
 * one with its own folder runs somewhere else entirely, so the paths pointed
 * at nothing -- and Claude Code and OpenCode refuse reads outside the folder
 * they run in, so the file never reached the model.
 *
 * So, when the run's folder is not the project folder:
 *
 *   - a copy under `.locust/attachments` is copied to the same path in the
 *     run's folder, and the line is unchanged;
 *   - a project file the run's folder also has is left alone: in a worktree
 *     that is the teammate's own branch's copy of it, the one it works on;
 *   - a project file the run's folder does not have is copied into that
 *     folder's `.locust/attachments`, and the line names the copy.
 *
 * Only what the runtime is SENT changes; the recorded prompt keeps the
 * project's paths, which is what the thread's tiles open. A file that cannot
 * be placed is left as it was named: the runtime's own read then says what
 * is missing, which is more than a silent drop would.
 */
export async function attachmentsForRun(prompt: string, workspacePath: string, runCwd: string): Promise<string> {
  if (samePath(workspacePath, runCwd)) return prompt
  const split = splitAttachments(prompt)
  if (split.attachments.length === 0) return prompt
  const taken = new Set<string>()
  const placed: string[] = []
  let copied = false
  for (const path of split.attachments) {
    const source = join(workspacePath, path)
    if (!inside(workspacePath, source)) {
      placed.push(path)
      continue
    }
    try {
      if (path.startsWith(`${ATTACHMENT_DIR}/`)) {
        const destination = join(runCwd, path)
        await mkdir(dirname(destination), { recursive: true })
        await copyFile(source, destination)
        copied = true
        placed.push(path)
        continue
      }
      if (await isFile(join(runCwd, path))) {
        placed.push(path)
        continue
      }
      const name = distinctName(basename(path), taken)
      taken.add(name)
      const destination = join(runCwd, ATTACHMENT_DIR, name)
      await mkdir(dirname(destination), { recursive: true })
      await copyFile(source, destination)
      copied = true
      placed.push(`${ATTACHMENT_DIR}/${name}`)
    } catch {
      placed.push(path)
    }
  }
  if (copied) await keepOutOfGit(runCwd)
  return withAttachments(split.text, placed)
}

const samePath = (a: string, b: string): boolean =>
  relative(a, b).length === 0 && relative(b, a).length === 0

const inside = (root: string, path: string): boolean => {
  const rel = relative(root, path)
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel)
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

function distinctName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name
  const extension = extname(name)
  const stem = extension.length === 0 ? name : name.slice(0, -extension.length)
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${stem}-${String(suffix)}${extension}`
    if (!taken.has(candidate)) return candidate
  }
}

/**
 * `.locust/` out of the run folder's commits, the way the project's copies
 * are kept out: `.git/info/exclude`, never the owner's `.gitignore`. A
 * worktree's `.git` is a file and its exclude is the project's, which
 * already has the line; a folder that is not a repository has nothing to do.
 */
export async function keepOutOfGit(folder: string): Promise<void> {
  try {
    if (!(await stat(join(folder, '.git'))).isDirectory()) return
    const excludePath = join(folder, '.git', 'info', 'exclude')
    const current = await readFile(excludePath, 'utf8').catch(() => '')
    const next = excludeWith(current)
    if (next === undefined) return
    await mkdir(dirname(excludePath), { recursive: true })
    await writeFile(excludePath, next, 'utf8')
  } catch {
    // Not a repository, or not writable: the copy still reaches the run.
  }
}
