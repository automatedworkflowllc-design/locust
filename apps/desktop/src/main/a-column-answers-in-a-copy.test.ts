import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { compareNeedsCopy, compareRefusalOf } from '../shared/compare.js'
import { copyRefusal, makeCompareCopy, MAX_COPIED_FILE_BYTES, MAX_COPY_BYTES, removeCompareCopies } from './compare-copies.js'

/**
 * A COLUMN THAT CANNOT BE HELD READ-ONLY ANSWERS IN A COPY (0.443).
 *
 * Colin, 2026-09-28: "gemini/grok not selectable on compare?" -- they reach
 * this machine through Cursor, which cannot be held read-only on Windows, and
 * a comparison answers read-only. Such a column now answers in a copy of the
 * folder as it is (uncommitted work included), and the folder is untouched.
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

describe('a copy for a column', () => {
  it('holds the folder as it is, without what is rebuilt or fetched, and is reused for follow-ups', async () => {
    const folder = await made('locust-copy-src-')
    const root = await made('locust-copy-root-')
    await mkdir(join(folder, 'src'), { recursive: true })
    await writeFile(join(folder, 'src', 'cart.py'), 'unsaved work\n', 'utf8')
    for (const left of ['.git', 'node_modules', '.locust']) {
      await mkdir(join(folder, left), { recursive: true })
      await writeFile(join(folder, left, 'x'), 'x', 'utf8')
    }
    const copy = await makeCompareCopy({ folder, compareId: 'cmp_1', slot: 'b', root })
    expect(await readFile(join(copy, 'src', 'cart.py'), 'utf8')).toBe('unsaved work\n')
    for (const left of ['.git', 'node_modules', '.locust']) expect(await exists(join(copy, left))).toBe(false)

    // A follow-up reuses it: what the column did there is still there.
    await writeFile(join(copy, 'notes.md'), 'its own\n', 'utf8')
    expect(await makeCompareCopy({ folder, compareId: 'cmp_1', slot: 'b', root })).toBe(copy)
    expect(await readFile(join(copy, 'notes.md'), 'utf8')).toBe('its own\n')
    // And the folder itself never saw it.
    expect(await exists(join(folder, 'notes.md'))).toBe(false)
  })

  it('says so, and makes nothing, when the folder is too big to copy', async () => {
    const folder = await made('locust-copy-big-')
    const root = await made('locust-copy-root-')
    await Promise.all(Array.from({ length: 6 }, (_, index) => writeFile(join(folder, `f${String(index)}.txt`), '', 'utf8')))
    await expect(makeCompareCopy({ folder, compareId: 'cmp_2', slot: 'a', root, limits: { files: 5, bytes: MAX_COPY_BYTES } })).rejects.toThrow(/too big to copy \(more than 5 files/)
    expect(await readdir(root)).toEqual([])
  })

  /*
   * 0.555: one big file -- a video, a database -- is left out of the copy,
   * not a reason to turn the whole folder away.
   */
  it('leaves a file too big to copy out, and copies the rest', async () => {
    const folder = await made('locust-copy-bigfile-')
    const root = await made('locust-copy-root-')
    await writeFile(join(folder, 'index.html'), '<p>x</p>', 'utf8')
    await writeFile(join(folder, 'clip.mp4'), Buffer.alloc(MAX_COPIED_FILE_BYTES + 1))
    expect(await copyRefusal(folder, { files: 1, bytes: 1024 })).toBeUndefined()
    const copy = await makeCompareCopy({ folder, compareId: 'cmp_9', slot: 'a', root })
    expect(await exists(join(copy, 'index.html'))).toBe(true)
    expect(await exists(join(copy, 'clip.mp4'))).toBe(false)
  })

  it('removes the comparison\'s copies and nothing else', async () => {
    const folder = await made('locust-copy-src-')
    const root = await made('locust-copy-root-')
    await writeFile(join(folder, 'a.txt'), 'a', 'utf8')
    await makeCompareCopy({ folder, compareId: 'cmp_3', slot: 'a', root })
    await makeCompareCopy({ folder, compareId: 'cmp_3', slot: 'b', root })
    await makeCompareCopy({ folder, compareId: 'cmp_4', slot: 'a', root })
    await removeCompareCopies('cmp_3', root)
    // Each copy has its manifest beside it (0.448); both go together.
    expect((await readdir(root)).sort()).toEqual(['cmp_4-a', 'cmp_4-a.manifest.json'])
    // A name that is not a comparison's removes nothing.
    await removeCompareCopies('../x', root)
    expect((await readdir(root)).sort()).toEqual(['cmp_4-a', 'cmp_4-a.manifest.json'])
  })

  it('refuses an id that could name a path outside its root', async () => {
    const folder = await made('locust-copy-src-')
    await expect(makeCompareCopy({ folder, compareId: '../escape', slot: 'a', root: await made('locust-copy-root-') })).rejects.toThrow(/cannot name a copy/)
  })
})

describe('who answers in a copy', () => {
  it('is nobody now; Antigravity cannot join at all; everyone else answers in the folder', () => {
    // Cursor answers read-only in its own ask mode on Windows too (0.485),
    // so its copy -- "could not start" in any big folder -- is gone.
    expect(compareNeedsCopy('cursor', 'win32')).toBe(false)
    expect(compareNeedsCopy('cursor', 'darwin')).toBe(false)
    expect(compareNeedsCopy('claude', 'win32')).toBe(false)
    expect(compareRefusalOf('antigravity')).toMatch(/only in the folder it has open/)
    // Through Antigravity CLI it answers in any folder, so it may join (0.543).
    expect(compareRefusalOf('antigravity', true)).toBeUndefined()
    expect(compareRefusalOf('cursor')).toBeUndefined()
  })
})
