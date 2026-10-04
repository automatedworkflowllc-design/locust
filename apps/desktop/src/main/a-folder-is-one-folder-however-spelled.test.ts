import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createFolderRegistry, sameFolderAtStart } from './folders.js'
import { workspaceIdFor } from './workspace.js'

/**
 * A FOLDER IS ONE FOLDER HOWEVER IT IS SPELLED (QA-2026-09-29 round 2, N13).
 * The id hashes the path as written, so a link to a project -- or, on Windows,
 * the same path in other letters -- was a second folder with none of the
 * conversations. The known folder is found by what it is on disk, and its
 * first spelling (and so its id) is kept.
 */
let root: string
let real: string
let link: string
let other: string
const file = (): string => join(root, 'folders.json')

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'locust-same-folder-'))
  real = join(root, 'Workspace')
  other = join(root, 'Elsewhere')
  link = join(root, 'alpha-link')
  await mkdir(real)
  await mkdir(other)
  // A junction on Windows needs no admin rights; a symlink elsewhere.
  await symlink(real, link, process.platform === 'win32' ? 'junction' : 'dir')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('a folder reached another way', () => {
  it('is the known folder, spelled as it was first known', async () => {
    const folders = createFolderRegistry({ file: file() })
    await folders.use(real)
    expect(await folders.sameAs(link)).toBe(real)
    expect(workspaceIdFor(await folders.sameAs(link))).toBe(workspaceIdFor(real))
  })

  it.runIf(process.platform === 'win32')('in other letters, on Windows', async () => {
    const folders = createFolderRegistry({ file: file() })
    await folders.use(real)
    expect(await folders.sameAs(real.toUpperCase())).toBe(real)
    expect(await folders.sameAs(real.toLowerCase())).toBe(real)
  })

  it('and at start, before the registry is open', async () => {
    const folders = createFolderRegistry({ file: file() })
    await folders.use(real)
    expect(sameFolderAtStart(file(), link)).toBe(real)
  })

  it('a different folder stays itself', async () => {
    const folders = createFolderRegistry({ file: file() })
    await folders.use(real)
    expect(await folders.sameAs(other)).toBe(other)
    expect(sameFolderAtStart(file(), other)).toBe(other)
  })

  it('a folder that is not there, or no registry yet, is left as written', async () => {
    const folders = createFolderRegistry({ file: file() })
    await folders.use(real)
    const gone = join(root, 'gone')
    expect(await folders.sameAs(gone)).toBe(gone)
    expect(sameFolderAtStart(join(root, 'none.json'), link)).toBe(link)
  })
})
