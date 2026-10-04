import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { MAX_FOLDER_DEPTH, changedPaths, observedEditEvents, observedPatches, snapshotFolder, snapshotWorkspace } from './disk-observation.js'

/**
 * A PLAIN FOLDER IS WATCHED TOO (0.365).
 *
 * The host's look at what a run changed rested on git, and someone who is
 * not a coder keeps their work in a plain folder -- often with no git on the
 * machine at all. There, Penny's budget workbook, made by a Python command,
 * was never seen (0.364 could only say it might be missing). These run
 * against a real folder on disk; git is made to fail, as it does there.
 */
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function folder(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'locust-plain-folder-'))
  roots.push(root)
  return root
}

const noGit = { runGit: async (): Promise<string> => { throw new Error('git is not installed') } }

describe('a folder with no git', () => {
  it('is looked at directly, and a file a command made is a change', async () => {
    const root = await folder()
    await writeFile(join(root, 'notes.md'), '# Notes\n')
    await mkdir(join(root, 'reports'))
    await writeFile(join(root, 'reports', 'march.md'), 'March\n')
    const before = await snapshotWorkspace(root, noGit)
    expect(before).toBeDefined()
    expect(before?.partial).toBeUndefined()

    // What a Python command does: a workbook, bytes, no tool naming it as an edit.
    await writeFile(join(root, 'monthly_budget.xlsx'), Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 1]))
    await writeFile(join(root, 'reports', 'march.md'), 'March, revised\n')
    const after = await snapshotWorkspace(root, noGit)

    const changed = changedPaths(before!, after!)
    expect(changed).toEqual(['monthly_budget.xlsx', 'reports/march.md'])
    // Each becomes an ordinary observed row; the edited text file carries its diff.
    const patches = await observedPatches(root, after!, changed, noGit, before)
    const rows = observedEditEvents({ runId: 'r', missionId: 'm', sourceAdapter: 'opencode', nextSequence: 1, paths: changed, at: '2026-09-26T12:00:00.000Z', patches })
    expect(rows.filter((row) => row.type === 'tool.completed').map((row) => (row.payload as { command?: string }).command)).toEqual(['monthly_budget.xlsx', 'reports/march.md'])
    expect(patches.has('monthly_budget.xlsx')).toBe(false)
  })

  it('never walks into a program\'s own folders, and ignores the files the system rewrites', async () => {
    const root = await folder()
    for (const inside of ['node_modules', '.git', '.venv', '.locust', '__pycache__']) {
      await mkdir(join(root, inside))
      await writeFile(join(root, inside, 'x.txt'), 'x')
    }
    for (const noise of ['desktop.ini', 'Thumbs.db', '.DS_Store', '~$budget.xlsx']) await writeFile(join(root, noise), 'x')
    await writeFile(join(root, 'kept.txt'), 'kept')
    const snapshot = await snapshotFolder(root)
    expect([...snapshot!.keys()]).toEqual(['kept.txt'])
  })

  it('says when it stopped short, and then reports no disappearances', async () => {
    const root = await folder()
    let deep = root
    for (let level = 0; level <= MAX_FOLDER_DEPTH; level += 1) {
      deep = join(deep, `d${String(level)}`)
      await mkdir(deep)
    }
    await writeFile(join(deep, 'too-deep.txt'), 'x')
    await writeFile(join(root, 'top.txt'), 'x')
    const before = await snapshotFolder(root)
    expect(before?.partial).toBe(true)
    expect(before?.has('top.txt')).toBe(true)
    // A path gone from a partial look is not a deletion it can vouch for.
    const after = Object.assign(new Map([...before!].filter(([path]) => path !== 'top.txt')), { partial: true as const })
    expect(changedPaths(before!, after)).toEqual([])
  })

  it('is nothing when the folder itself cannot be read', async () => {
    expect(await snapshotWorkspace(join(tmpdir(), 'locust-no-such-folder-0365'), noGit)).toBeUndefined()
  })

  it('never follows a link out of the folder', async () => {
    const listed = await snapshotFolder('C:/work', {
      listDirectory: async (directory) =>
        directory === 'C:/work'
          ? [
              { name: 'elsewhere', kind: 'link' },
              { name: 'real.txt', kind: 'file' }
            ]
          : [{ name: 'secret.txt', kind: 'file' }],
      statOf: async () => ({ size: 1, mtimeMs: 1 }),
      readText: async () => 'x'
    })
    expect([...listed!.keys()]).toEqual(['real.txt'])
  })
})
