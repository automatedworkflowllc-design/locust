import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { citedPaths, memorySection, outOfDate } from '../shared/memory.js'
import { memoryFileText } from './memory-file.js'
import { changedSince } from './memory-provenance.js'

/*
 * A MEMORY WHOSE FILE CHANGED MAY BE OUT OF DATE (A1.3).
 *
 * "The retry logic lives in src/net.ts" is a claim about src/net.ts as it
 * was. Once the file changes, a teammate briefed with the memory should know
 * to check it: the brief, the file every teammate reads and the Memory screen
 * say "may be out of date: src/net.ts changed since". The memory is still
 * briefed -- a file changes for many reasons.
 */

describe('the files a memory names', () => {
  it('takes paths and project file names; not URLs, versions or abbreviations', () => {
    expect(citedPaths('The retry logic lives in src/net/fetch.ts, see also `README.md` and .env.')).toEqual(['src/net/fetch.ts', 'README.md', '.env'])
    expect(citedPaths('Docs are at https://example.com/a.md; we pin v1.2.3, e.g. for tests.')).toEqual([])
    expect(citedPaths('Tests run with pnpm test.')).toEqual([])
    // A Windows path is a path (2026-10-10 sweep); a scheme still is not.
    expect(citedPaths('see C:\\proj\\src\\net.ts for the fix')).toEqual(['C:\\proj\\src\\net.ts'])
    expect(citedPaths('open mailto:someone or file:x')).toEqual([])
    expect(citedPaths('Windows paths too: apps\\desktop\\src\\main.ts')).toEqual(['apps\\desktop\\src\\main.ts'])
  })

  it('names them in a sentence', () => {
    expect(outOfDate(['src/net.ts'])).toBe('src/net.ts changed since')
    expect(outOfDate(['a.ts', 'b.ts', 'c.ts'])).toBe('a.ts, b.ts and c.ts changed since')
  })
})

describe('whether they changed after the memory was written', () => {
  let root: string | undefined
  afterEach(async () => {
    if (root !== undefined) await rm(root, { recursive: true, force: true })
    root = undefined
  })

  it('a named file saved after the memory is listed; one saved before, missing, or outside the folder is not', async () => {
    root = await mkdtemp(join(tmpdir(), 'locust-provenance-'))
    const folder = join(root, 'project')
    await mkdir(join(folder, 'src'), { recursive: true })
    // A real, newer file just OUTSIDE the folder: a memory naming it says
    // nothing about this project, however recently it changed.
    await writeFile(join(root, 'outside.ts'), 'export {}', 'utf8')
    await writeFile(join(folder, 'src', 'net.ts'), 'export {}', 'utf8')
    await writeFile(join(folder, 'README.md'), '# x', 'utf8')
    const written = new Date('2026-09-20T12:00:00.000Z')
    await utimes(join(folder, 'README.md'), written.getTime() / 1000 - 3600, written.getTime() / 1000 - 3600)
    await utimes(join(folder, 'src', 'net.ts'), written.getTime() / 1000 + 3600, written.getTime() / 1000 + 3600)
    await utimes(join(root, 'outside.ts'), written.getTime() / 1000 + 3600, written.getTime() / 1000 + 3600)

    const text = 'Retries live in src/net.ts; setup is in README.md; the plan is in docs/gone.md and ../outside.ts.'
    expect(await changedSince(folder, text, written.toISOString())).toEqual(['src/net.ts'])
  })

  it('a date that does not read says nothing', async () => {
    expect(await changedSince(tmpdir(), 'src/net.ts', 'not a date')).toEqual([])
  })
})

describe('where a teammate reads it', () => {
  const line = { text: 'Retries live in src/net.ts.', scope: 'workspace' as const, by: 'you', where: undefined, at: '2026-09-20T12:00:00.000Z', changedSince: ['src/net.ts'] }

  it('the brief says so beside the memory', () => {
    const section = memorySection({ memories: [line], workspaceName: 'shop', askFirst: false, now: new Date('2026-09-24T12:00:00.000Z') })
    expect(section).toContain('- Retries live in src/net.ts. (this folder, by the person, 4 days ago; may be out of date: src/net.ts changed since)')
  })

  it('and so does the file', () => {
    expect(memoryFileText([{ ...line, id: 'mem_r' }], new Date('2026-09-24T12:00:00.000Z'))).toContain(
      '- Retries live in src/net.ts. (by the person -- 2026-09-20 (4 days ago) -- may be out of date: src/net.ts changed since) [mem_r]'
    )
  })
})
