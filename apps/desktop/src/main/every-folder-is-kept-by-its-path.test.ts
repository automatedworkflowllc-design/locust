import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { folderSectionsOf } from '../shared/folder-sections.js'
import { createFolderRegistry, recoverFolderPath } from './folders.js'
import { workspaceIdFor } from './workspace.js'

/**
 * EVERY FOLDER IS KEPT BY ITS PATH, AND LISTED AS A PROJECT (0.458).
 *
 * A mission records its folder only as a hash of the path. To list and
 * continue another folder's conversations the path has to be kept -- and for
 * a folder from before it was, recovered from the conversation's own record.
 */
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('a folder with no known path', () => {
  const project = 'C:\\Users\\someone\\Documents\\Codex\\locust-astra'
  const id = workspaceIdFor(project)

  it('is found from a file path its conversation named, JSON-escaped, deep inside it', () => {
    const record = JSON.stringify({ type: 'tool', input: { file_path: `${project}\\apps\\desktop\\src\\main\\index.ts` } })
    expect(recoverFolderPath(id, record)).toBe(project)
  })

  it('is found from forward slashes too, as some runtimes write Windows paths', () => {
    expect(recoverFolderPath(id, '"cwd":"C:/Users/someone/Documents/Codex/locust-astra/docs"')).toBe(project)
  })

  it('is never guessed: no path that hashes to it, no answer', () => {
    expect(recoverFolderPath(id, '"C:\\\\Users\\\\someone\\\\Documents\\\\elsewhere\\\\a.txt"')).toBeUndefined()
    expect(recoverFolderPath(id, 'no paths at all')).toBeUndefined()
  })

  it('is found on macOS and Linux paths', () => {
    const unix = '/Users/someone/projects/site'
    expect(recoverFolderPath(workspaceIdFor(unix), '"path":"/Users/someone/projects/site/index.html"')).toBe(unix)
  })
})

describe('the folder registry', () => {
  it('keeps each folder once, newest used first, and what was only recovered after', async () => {
    const root = await mkdtemp(join(tmpdir(), 'locust-folders-'))
    roots.push(root)
    let clock = Date.parse('2026-09-29T10:00:00.000Z')
    const registry = createFolderRegistry({ file: join(root, 'folders.json'), now: () => new Date((clock += 60_000)) })
    const a = join(root, 'alpha')
    const b = join(root, 'beta')
    await registry.use(a)
    await registry.use(b)
    await registry.use(a)
    await registry.learn([{ id: workspaceIdFor(join(root, 'old')), path: join(root, 'old') }, { id: workspaceIdFor(a), path: 'ignored' }])
    const listed = await registry.list()
    expect(listed.map((folder) => folder.name)).toEqual(['alpha', 'beta', 'old'])
    expect(await registry.pathOf(workspaceIdFor(b))).toBe(b)
    // Written to disk, and read back by a fresh registry.
    await expect.poll(async () => (await readFile(join(root, 'folders.json'), 'utf8').catch(() => '')).includes('old')).toBe(true)
    const again = createFolderRegistry({ file: join(root, 'folders.json') })
    expect((await again.list()).map((folder) => folder.name)).toEqual(['alpha', 'beta', 'old'])
  })
})

describe('the sidebar, by project', () => {
  const row = (missionId: string, folderId: string | undefined, lastAt: string): { missionId: string; lastAt: string; folderId?: string } => ({
    missionId,
    lastAt,
    ...(folderId === undefined ? {} : { folderId })
  })

  it('puts the window\'s folder first, then the others by their newest conversation', () => {
    const sections = folderSectionsOf(
      [row('m1', 'ws_old', '2026-09-01'), row('m2', 'ws_here', '2026-09-02'), row('m3', 'ws_recent', '2026-09-20'), row('m4', undefined, '2026-09-29')],
      'ws_here'
    )
    expect(sections.map((section) => section.id)).toEqual(['ws_here', 'ws_recent', 'ws_old'])
    // A run still starting belongs where it was started.
    expect(sections[0]!.missions.map((mission) => mission.missionId)).toEqual(['m2', 'm4'])
  })

  it('is one section when there is one folder, so it draws as it always did', () => {
    expect(folderSectionsOf([row('m1', 'ws_here', '2026-09-01')], 'ws_here')).toHaveLength(1)
  })

  it('keeps the window\'s folder even with nothing in it yet: a folder just switched to', () => {
    const sections = folderSectionsOf([row('m1', 'ws_old', '2026-09-01')], 'ws_new')
    expect(sections.map((section) => [section.id, section.missions.length])).toEqual([['ws_new', 0], ['ws_old', 1]])
  })
})
