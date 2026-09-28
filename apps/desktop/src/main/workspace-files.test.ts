import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { listWorkspaceFiles, MAX_LISTED_FILES } from './workspace-files.js'

/** The project's files for `@` in the composer (0.436). */
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
const folder = async (files: readonly string[]): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'locust-files-'))
  roots.push(root)
  for (const file of files) {
    await mkdir(join(root, file, '..'), { recursive: true })
    await writeFile(join(root, file), 'x', 'utf8')
  }
  return root
}
const noGit = async (): Promise<undefined> => undefined

describe("the folder's files", () => {
  it("are git's own list in a repository, and never a path that climbs out or Locust's own folder", async () => {
    const listed = await listWorkspaceFiles('C:/work/shop', { git: async () => ['README.md', 'src\\cart.py', '../secret.txt', '/etc/passwd', 'C:/x.txt', '.locust/memory.md'] })
    expect(listed).toEqual({ paths: ['README.md', 'src/cart.py'], truncated: false })
  })

  it('are walked outside a repository, skipping the folders nobody attaches from', async () => {
    const root = await folder(['README.md', 'src/cart.py', 'node_modules/x/index.js', '.git/HEAD', 'dist/app.js', '.locust/memory.md'])
    expect((await listWorkspaceFiles(root, { git: noGit })).paths).toEqual(['README.md', 'src/cart.py'])
  })

  it('stop at the cap, and say so', async () => {
    const listed = await listWorkspaceFiles('C:/work/big', { git: async () => Array.from({ length: MAX_LISTED_FILES + 5 }, (_, i) => `f${String(i)}.ts`) })
    expect(listed.paths).toHaveLength(MAX_LISTED_FILES)
    expect(listed.truncated).toBe(true)
  })
})
