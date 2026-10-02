import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { contains, decideReveal, insideOnDisk } from './reveal-file.js'

/**
 * The renderer asks; the host decides.
 *
 * These are the tests for the deciding. The feature they serve is small — show
 * me the file my teammate wrote — but the way to get it wrong is not: an IPC
 * that reveals any path the renderer names is a hole through the egress rules
 * the rest of the host keeps, because `showItemInFolder` hands a string to the
 * operating system where none of those rules apply.
 *
 * So the interesting cases here are all refusals.
 */

const WORKSPACE = process.platform === 'win32' ? 'C:\\work\\shop' : '/work/shop'
const inside = (...rest: string[]) => [WORKSPACE, ...rest].join(process.platform === 'win32' ? '\\' : '/')

describe('is this path inside that folder', () => {
  it('says yes to a file in the folder and in a folder below it', () => {
    expect(contains(WORKSPACE, inside('notes.md'))).toBe(true)
    expect(contains(WORKSPACE, inside('src', 'deep', 'file.ts'))).toBe(true)
  })

  it('says yes to the folder itself', () => {
    expect(contains(WORKSPACE, WORKSPACE)).toBe(true)
  })

  it('is not fooled by a sibling whose name starts the same way', () => {
    // THE test. `startsWith` is the obvious implementation and it answers true
    // here, which would hand out a folder the person never chose.
    expect(contains(WORKSPACE, `${WORKSPACE}-secrets`)).toBe(false)
    expect(contains(WORKSPACE, `${WORKSPACE}-secrets${process.platform === 'win32' ? '\\' : '/'}keys.txt`)).toBe(false)
  })

  it('refuses a walk back up and out', () => {
    expect(contains(WORKSPACE, inside('..', '..', 'Windows', 'System32'))).toBe(false)
    expect(contains(WORKSPACE, inside('sub', '..', '..', 'elsewhere.txt'))).toBe(false)
  })

  it('refuses an unrelated folder', () => {
    expect(contains(WORKSPACE, process.platform === 'win32' ? 'C:\\Users\\someone\\.ssh\\id_rsa' : '/home/someone/.ssh/id_rsa')).toBe(false)
  })
})

describe('deciding whether to reveal what the renderer asked for', () => {
  const roots = [WORKSPACE]

  it('honours a file in a workspace the host knows about', () => {
    expect(decideReveal(inside('docs', 'report.md'), roots)).toEqual({ ok: true, path: inside('docs', 'report.md') })
  })

  it('refuses everything when no mission has run', () => {
    // An empty root list is the state at launch. It must refuse rather than
    // fall open, which is the direction this kind of check usually fails.
    expect(decideReveal(inside('report.md'), [])).toEqual({ ok: false, reason: 'outside', path: inside('report.md') })
  })

  it('refuses a path outside every known workspace', () => {
    const outside = process.platform === 'win32' ? 'C:\\Users\\someone\\.aws\\credentials' : '/home/someone/.aws/credentials'
    expect(decideReveal(outside, roots)).toEqual({ ok: false, reason: 'outside', path: outside })
  })

  it('refuses a relative path rather than trying each root until one exists', () => {
    // Trying roots in turn would answer a different question -- "does this
    // exist anywhere I can see" -- which is a way to probe the disk from the
    // renderer, one guess per call.
    expect(decideReveal('../../etc/passwd', roots).ok).toBe(false)
    expect(decideReveal('report.md', roots).ok).toBe(false)
  })

  it('refuses anything that is not a string, and an empty one', () => {
    for (const nonsense of [undefined, null, 42, {}, [], '', '   ']) {
      expect(decideReveal(nonsense, roots)).toEqual({ ok: false, reason: 'no-path' })
    }
  })

  it('honours a file under any one of several workspaces', () => {
    const other = process.platform === 'win32' ? 'D:\\other' : '/other'
    const target = process.platform === 'win32' ? 'D:\\other\\out.md' : '/other/out.md'
    expect(decideReveal(target, [WORKSPACE, other]).ok).toBe(true)
  })
})

describe('a file READ is inside the folder on disk, links followed (0.543, the 0.536 review SEC-01)', () => {
  it('refuses a link that leads out; keeps the folder’s own files, and a project reached through a junction', async () => {
    const base = await mkdtemp(join(tmpdir(), 'locust-linked-out-'))
    try {
      const project = join(base, 'project')
      const outside = join(base, 'outside')
      await mkdir(project)
      await mkdir(outside)
      await writeFile(join(project, 'own.txt'), 'mine')
      await writeFile(join(outside, 'secret.txt'), 'not the folder’s')
      // Junctions need no special rights on Windows; a dir symlink elsewhere.
      await symlink(outside, join(project, 'linked'), 'junction')
      await symlink(project, join(base, 'alias'), 'junction')
      // By path arithmetic the linked file is inside; on disk it is not.
      expect(contains(project, join(project, 'linked', 'secret.txt'))).toBe(true)
      expect(await insideOnDisk(join(project, 'linked', 'secret.txt'), [project])).toBe(false)
      expect(await insideOnDisk(join(project, 'own.txt'), [project])).toBe(true)
      expect(await insideOnDisk(join(base, 'alias', 'own.txt'), [join(base, 'alias')])).toBe(true)
      // A file never written has no link to follow; the read itself says it is missing.
      expect(await insideOnDisk(join(project, 'missing.txt'), [project])).toBe(true)
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })
})
