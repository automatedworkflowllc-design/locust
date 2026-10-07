import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { comparePagePath } from './compare-page-path.js'
import { createPageServer } from './page-preview.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('a comparison page after its copy was removed', () => {
  const copy = join(tmpdir(), 'comparison-copy-a')

  it('keeps a relative page name as it was', () => {
    expect(comparePagePath('site/index.html', copy)).toBe('site/index.html')
  })

  it('makes an absolute page inside this copy relative, without needing the copy to exist', () => {
    expect(comparePagePath(join(copy, 'site', 'index.html'), copy)).toBe(join('site', 'index.html'))
  })

  it('does not reinterpret an absolute page outside this copy or in a similarly named sibling', () => {
    expect(comparePagePath(join(tmpdir(), 'index.html'), copy)).toBeUndefined()
    expect(comparePagePath(join(copy + '-other', 'index.html'), copy)).toBeUndefined()
    expect(comparePagePath(join(copy, '..', 'index.html'), copy)).toBeUndefined()
  })

  it('does not mistake an inside file beginning with two dots for a parent path', () => {
    expect(comparePagePath(join(copy, '..notes.html'), copy)).toBe('..notes.html')
  })

  it.skipIf(process.platform !== 'win32')('accepts the same Windows copy with different casing and separators', () => {
    expect(comparePagePath(join(copy, 'index.html').toUpperCase().replace(/\\/g, '/'), copy)).toBe('INDEX.HTML')
  })

  it('serves the kept page from the folder when the recorded tool path names a removed copy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'locust-kept-page-'))
    roots.push(root)
    const folder = join(root, 'folder')
    const removedCopy = join(root, 'removed-copy')
    await mkdir(folder)
    await writeFile(join(folder, 'index.html'), '<h1>kept</h1>')
    const requested = join(removedCopy, 'index.html')
    const pages = createPageServer({ roots: async () => [folder], base: () => folder })
    const result = await pages.urlFor(comparePagePath(requested, removedCopy) ?? requested)
    expect(result.ok).toBe(true)
    if (result.ok) expect(await (await pages.handle(result.url)).text()).toBe('<h1>kept</h1>')
  })
})
