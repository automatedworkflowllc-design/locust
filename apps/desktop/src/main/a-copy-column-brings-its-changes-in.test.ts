import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { bringInCopy, copyChanges, copyLineChanges, makeCompareCopy, removeCompareCopies } from './compare-copies.js'
import { defaultRunGit } from './worktrees.js'

/**
 * A COMPARISON THAT EDITS, IN A FOLDER THAT IS NOT A GIT PROJECT (0.448).
 *
 * 0.445 compared work only in a git project, and a new person's folder is
 * not one -- so the Home starters (Colin, 2026-09-28: "Keep working big dog",
 * to "a starter makes its own new project folder") had no clean place to run
 * without restarting the app in another folder. Instead each column edits a
 * plain copy, and Keep writes back only what that column changed.
 */
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })))
})
const made = async (prefix: string): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), prefix))
  roots.push(root)
  return root
}
const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false)

async function aFolderAndACopy() {
  const folder = await made('locust-copyedit-src-')
  const root = await made('locust-copyedit-root-')
  await mkdir(join(folder, 'site'), { recursive: true })
  await writeFile(join(folder, 'notes.md'), 'keep me\n', 'utf8')
  await writeFile(join(folder, 'old.txt'), 'going\n', 'utf8')
  await writeFile(join(folder, 'site', 'style.css'), 'body {}\n', 'utf8')
  const copy = await makeCompareCopy({ folder, compareId: 'cmp_1', slot: 'a', root })
  // The column's work: a new page, a changed stylesheet, a deleted file.
  await writeFile(join(copy, 'index.html'), '<h1>Ember</h1>\n<p>Coffee</p>\n', 'utf8')
  await writeFile(join(copy, 'site', 'style.css'), 'body { color: tan }\n', 'utf8')
  await rm(join(copy, 'old.txt'))
  return { folder, root, copy }
}

// Real files, hashed and copied: a busy machine takes longer than the 5 s default (it timed out under ship's full run).
describe('a column that edits a copy', { timeout: 60_000 }, () => {
  it('knows what it changed and what it deleted, and nothing else', async () => {
    const { root } = await aFolderAndACopy()
    expect(await copyChanges({ compareId: 'cmp_1', slot: 'a', root })).toEqual({ changed: ['index.html', 'site/style.css'], deleted: ['old.txt'] })
    // Its bookkeeping sits beside the copy, never in it.
    expect((await readdir(root)).sort()).toEqual(['cmp_1-a', 'cmp_1-a.manifest.json'])
  })

  it('counts its lines the way git does', async () => {
    const { folder, root } = await aFolderAndACopy()
    expect(await copyLineChanges({ folder, compareId: 'cmp_1', slot: 'a', root, runGit: defaultRunGit })).toEqual({ files: 3, added: 3, removed: 2 })
  }, 30_000)

  it('keeps: writes what it changed into the folder, removes what it deleted, and leaves the rest', async () => {
    const { folder, root } = await aFolderAndACopy()
    expect(await bringInCopy({ folder, compareId: 'cmp_1', slot: 'a', root })).toEqual({ kind: 'brought', files: ['index.html', 'old.txt', 'site/style.css'] })
    expect(await readFile(join(folder, 'index.html'), 'utf8')).toBe('<h1>Ember</h1>\n<p>Coffee</p>\n')
    expect(await readFile(join(folder, 'site', 'style.css'), 'utf8')).toBe('body { color: tan }\n')
    expect(await exists(join(folder, 'old.txt'))).toBe(false)
    expect(await readFile(join(folder, 'notes.md'), 'utf8')).toBe('keep me\n')
    // And the copy, with its manifest, goes when the comparison is done with.
    await removeCompareCopies('cmp_1', root)
    expect(await readdir(root)).toEqual([])
  })

  it('refuses, changing nothing, when the person has changed one of those files since', async () => {
    const { folder, root } = await aFolderAndACopy()
    await writeFile(join(folder, 'site', 'style.css'), 'body { color: red }\n', 'utf8')
    expect(await bringInCopy({ folder, compareId: 'cmp_1', slot: 'a', root })).toEqual({ kind: 'your-changes', files: ['site/style.css'] })
    expect(await exists(join(folder, 'index.html'))).toBe(false)
    expect(await readFile(join(folder, 'site', 'style.css'), 'utf8')).toBe('body { color: red }\n')
    expect(await exists(join(folder, 'old.txt'))).toBe(true)
  })

  it('refuses when the person made a file of the same name meanwhile', async () => {
    const { folder, root } = await aFolderAndACopy()
    await writeFile(join(folder, 'index.html'), '<h1>Mine</h1>\n', 'utf8')
    expect(await bringInCopy({ folder, compareId: 'cmp_1', slot: 'a', root })).toMatchObject({ kind: 'your-changes', files: ['index.html'] })
    expect(await readFile(join(folder, 'index.html'), 'utf8')).toBe('<h1>Mine</h1>\n')
  })

  it('says so when a column changed nothing', async () => {
    const folder = await made('locust-copyedit-src-')
    const root = await made('locust-copyedit-root-')
    await writeFile(join(folder, 'a.txt'), 'a\n', 'utf8')
    await makeCompareCopy({ folder, compareId: 'cmp_2', slot: 'b', root })
    expect(await bringInCopy({ folder, compareId: 'cmp_2', slot: 'b', root })).toEqual({ kind: 'nothing' })
  })
})
