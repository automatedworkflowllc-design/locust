import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { withAttachments } from '../shared/attachments.js'
import { attachmentsForRun } from './attachments-for-run.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function project(): Promise<{ readonly root: string; readonly tree: string; readonly own: string }> {
  const root = await mkdtemp(join(tmpdir(), 'locust-attach-run-'))
  roots.push(root)
  const tree = join(root, '.locust', 'worktrees', 'tm_wren')
  const own = join(root, 'elsewhere')
  await mkdir(join(root, '.locust', 'attachments'), { recursive: true })
  await mkdir(join(tree, 'src'), { recursive: true })
  await mkdir(join(root, 'src'), { recursive: true })
  await mkdir(own, { recursive: true })
  await writeFile(join(root, '.locust', 'attachments', 'shot.png'), 'PNG')
  await writeFile(join(root, 'src', 'app.ts'), 'project copy')
  await writeFile(join(tree, 'src', 'app.ts'), 'branch copy')
  await writeFile(join(root, 'NOTES.md'), 'notes')
  return { root, tree, own }
}

/**
 * M16 (the code review): the message named its files relative to the
 * project folder, and a teammate with Own branch or its own folder runs
 * somewhere else -- so the paths pointed at nothing there.
 */
describe('attached files, placed where the run reads', () => {
  it('changes nothing for a run in the project folder', async () => {
    const { root } = await project()
    const prompt = withAttachments('Look at this.', ['.locust/attachments/shot.png'])
    expect(await attachmentsForRun(prompt, root, root)).toBe(prompt)
  })

  it('copies a pasted file into a worktree at the same path', async () => {
    const { root, tree } = await project()
    const prompt = withAttachments('Look at this.', ['.locust/attachments/shot.png'])
    expect(await attachmentsForRun(prompt, root, tree)).toBe(prompt)
    expect(await readFile(join(tree, '.locust', 'attachments', 'shot.png'), 'utf8')).toBe('PNG')
  })

  it('leaves a project file the worktree has alone: its own branch’s copy', async () => {
    const { root, tree } = await project()
    const prompt = withAttachments('Fix this.', ['src/app.ts'])
    expect(await attachmentsForRun(prompt, root, tree)).toBe(prompt)
    expect(await readFile(join(tree, 'src', 'app.ts'), 'utf8')).toBe('branch copy')
  })

  it('copies a project file a folder of its own lacks, and names the copy', async () => {
    const { root, own } = await project()
    const sent = await attachmentsForRun(withAttachments('Read these.', ['NOTES.md', 'src/app.ts']), root, own)
    expect(sent).toBe(withAttachments('Read these.', ['.locust/attachments/NOTES.md', '.locust/attachments/app.ts']))
    expect(await readFile(join(own, '.locust', 'attachments', 'NOTES.md'), 'utf8')).toBe('notes')
    expect(await readFile(join(own, '.locust', 'attachments', 'app.ts'), 'utf8')).toBe('project copy')
  })

  it('never reads outside the project for a path that climbs out of it', async () => {
    const { root, own } = await project()
    const prompt = withAttachments('Read this.', ['../../secret.txt'])
    expect(await attachmentsForRun(prompt, root, own)).toBe(prompt)
  })

  it('leaves a message without attachments exactly as typed', async () => {
    const { root, tree } = await project()
    expect(await attachmentsForRun('Just words.', root, tree)).toBe('Just words.')
  })
})
