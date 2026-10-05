import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readWorkspaceImage } from './workspace-image.js'

const scratch: string[] = []
afterEach(async () => { await Promise.all(scratch.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function folders() {
  const root = await mkdtemp(join(tmpdir(), 'locust-image-test-'))
  scratch.push(root)
  const folder = join(root, 'conversation')
  const copy = join(root, 'compare', 'slot-a')
  await mkdir(folder, { recursive: true }); await mkdir(copy, { recursive: true })
  await writeFile(join(folder, 'chart.png'), 'folder-image')
  await writeFile(join(copy, 'chart.png'), 'copy-image')
  await writeFile(join(root, 'private.png'), 'outside')
  return { root, folder, copy }
}

describe('an image preview stays in its folder', () => {
  it('reads relative and absolute images from the conversation', async () => {
    const { folder } = await folders()
    for (const path of ['chart.png', join(folder, 'chart.png')]) {
      expect(await readWorkspaceImage(path, folder, [folder])).toEqual({ ok: true, path: join(folder, 'chart.png'), dataUrl: `data:image/png;base64,${Buffer.from('folder-image').toString('base64')}` })
    }
  })
  it('refuses a path outside the conversation even when another allowed root holds it', async () => {
    const { root, folder } = await folders()
    expect((await readWorkspaceImage('../private.png', folder, [root])).ok).toBe(false)
    expect((await readWorkspaceImage(join(root, 'private.png'), folder, [root])).ok).toBe(false)
    expect((await readWorkspaceImage('chart.png', root, [folder])).ok).toBe(false)
  })
  it('reads a comparison column from its own copy and never substitutes the workspace', async () => {
    const { root, folder, copy } = await folders()
    expect(await readWorkspaceImage('chart.png', copy, [folder, join(root, 'compare')])).toMatchObject({ ok: true, path: join(copy, 'chart.png'), dataUrl: `data:image/png;base64,${Buffer.from('copy-image').toString('base64')}` })
    await rm(copy, { recursive: true })
    expect((await readWorkspaceImage('chart.png', copy, [folder, join(root, 'compare')])).ok).toBe(false)
  })
  it('refuses a link that leads outside the conversation', async () => {
    const { root, folder } = await folders()
    await mkdir(join(root, 'outside'))
    await writeFile(join(root, 'outside', 'secret.png'), 'secret')
    await symlink(join(root, 'outside'), join(folder, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    expect((await readWorkspaceImage('linked/secret.png', folder, [root])).ok).toBe(false)
  })
  it('draws no SVG, network URL, missing file, folder, or oversized image', async () => {
    const { folder } = await folders()
    await mkdir(join(folder, 'directory.png'))
    await writeFile(join(folder, 'big.png'), Buffer.alloc(8 * 1024 * 1024 + 1))
    for (const path of ['x.svg', 'https://example.com/chart.png', '//server/share/chart.png', 'data:image/png', 'missing.png', 'directory.png', 'big.png']) {
      expect((await readWorkspaceImage(path, folder, [folder])).ok, path).toBe(false)
    }
  })
})
