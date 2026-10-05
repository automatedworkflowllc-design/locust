import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  bringInCopy,
  COMPARE_ROOT_ENV,
  compareRoot,
  copyChanges,
  makeCompareCopy,
  removeCompareCopies
} from './compare-copies.js'

/**
 * COMPARISON COPIES FOLLOW LOCUST_COMPARE_ROOT (2026-10-05).
 *
 * Drives launch with a scratch profile, but copies still landed in the real
 * `~/.locust/compare` beside the person's own. When the variable is set, every
 * make/read/keep/remove uses that folder; when it is not, home is unchanged.
 */
const roots: string[] = []
afterEach(async () => {
  delete process.env[COMPARE_ROOT_ENV]
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })))
})
const made = async (prefix: string): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), prefix))
  roots.push(root)
  return root
}
const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false)

describe('where comparison copies live', () => {
  it('is LOCUST_COMPARE_ROOT when set, and ~/.locust/compare when not', () => {
    expect(compareRoot({})).toBe(join(homedir(), '.locust', 'compare'))
    expect(compareRoot({ [COMPARE_ROOT_ENV]: '' })).toBe(join(homedir(), '.locust', 'compare'))
    expect(compareRoot({ [COMPARE_ROOT_ENV]: '  ' })).toBe(join(homedir(), '.locust', 'compare'))
    expect(compareRoot({ [COMPARE_ROOT_ENV]: 'D:\\drive-scratch\\compare' })).toBe('D:\\drive-scratch\\compare')
    expect(compareRoot({ [COMPARE_ROOT_ENV]: '  C:/tmp/cmp  ' })).toBe('C:/tmp/cmp')
  })

  it('makes, reads, keeps and removes under a set root and never touches the home one', async () => {
    const home = join(homedir(), '.locust', 'compare')
    const beforeHome = new Set(await readdir(home).catch(() => [] as string[]))

    const folder = await made('locust-cmpenv-src-')
    const root = await made('locust-cmpenv-root-')
    await writeFile(join(folder, 'page.html'), '<h1>was</h1>\n', 'utf8')
    process.env[COMPARE_ROOT_ENV] = root

    const copy = await makeCompareCopy({ folder, compareId: 'cmp_drive1', slot: 'a' })
    expect(copy.startsWith(root)).toBe(true)
    expect(copy.includes(join('.locust', 'compare'))).toBe(false)
    await writeFile(join(copy, 'page.html'), '<h1>now</h1>\n', 'utf8')
    expect(await copyChanges({ compareId: 'cmp_drive1', slot: 'a' })).toEqual({
      changed: ['page.html'],
      deleted: []
    })
    expect(await bringInCopy({ folder, compareId: 'cmp_drive1', slot: 'a' })).toEqual({
      kind: 'brought',
      files: ['page.html']
    })
    expect(await readFile(join(folder, 'page.html'), 'utf8')).toBe('<h1>now</h1>\n')
    await removeCompareCopies('cmp_drive1')
    expect(await exists(copy)).toBe(false)
    expect((await readdir(root)).some((name) => name.startsWith('cmp_drive1'))).toBe(false)

    const afterHome = await readdir(home).catch(() => [] as string[])
    expect(afterHome.filter((name) => !beforeHome.has(name))).toEqual([])
  })
})
