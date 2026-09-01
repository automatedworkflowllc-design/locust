import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createTeammateStore, parsedTeammate, validName } from './teammate-store.js'

const roots: string[] = []

async function store() {
  const root = await mkdtemp(join(tmpdir(), 'locust-teammates-'))
  roots.push(root)
  return { root, store: createTeammateStore({ rootDirectory: root }) }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const NUL = String.fromCharCode(0)

describe('teammate names', () => {
  it('accepts an ordinary name and trims it', async () => {
    const { store: teammates } = await store()
    const created = await teammates.create({ name: '  Wren  ', hue: 'lime', role: 'Code & Migrations' })
    expect(created.name).toBe('Wren')
  })

  it('refuses control characters rather than silently rewriting them', () => {
    // A name is shown back to the user; quietly stripping what they typed is
    // worse than refusing it.
    expect(validName(`Wren${NUL}`)).toBe(false)
    expect(validName('Wren' + String.fromCharCode(27) + '[31m')).toBe(false)
    expect(validName('Wren')).toBe(true)
  })

  it('refuses empty, whitespace-only and over-long names', () => {
    expect(validName('')).toBe(false)
    expect(validName('   ')).toBe(false)
    expect(validName('x'.repeat(41))).toBe(false)
    expect(validName('x'.repeat(40))).toBe(true)
  })
})

describe('teammate store', () => {
  it('persists a teammate and reads it back from disk', async () => {
    const { root, store: teammates } = await store()
    const created = await teammates.create({ name: 'Atlas', hue: 'blue', role: 'Research & Briefs' })

    const reopened = createTeammateStore({ rootDirectory: root })
    const list = await reopened.list()

    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ name: 'Atlas', hue: 'blue', role: 'Research & Briefs' })
    expect(created.teammateId).toMatch(/^tm_[0-9a-f]{24}$/)
  })

  it('rejects an unknown hue or role instead of storing it', async () => {
    const { store: teammates } = await store()
    await expect(teammates.create({ name: 'X', hue: 'chartreuse', role: 'Code & Migrations' })).rejects.toThrow()
    await expect(teammates.create({ name: 'X', hue: 'lime', role: 'Overlord' })).rejects.toThrow()
    expect(await teammates.list()).toEqual([])
  })

  it('drops a malformed record but keeps the rest of the roster usable', async () => {
    const { root, store: teammates } = await store()
    const good = await teammates.create({ name: 'Wren', hue: 'lime', role: 'Code & Migrations' })
    const path = join(root, 'teammates.json')
    const file = JSON.parse(await readFile(path, 'utf8'))
    file.teammates.push({ teammateId: 'tm_bad', name: '', hue: 'lime', role: 'Code & Migrations', createdAt: 'x' })
    await writeFile(path, JSON.stringify(file), 'utf8')

    const list = await createTeammateStore({ rootDirectory: root }).list()

    // The file is in the user's profile and anything can edit it. One bad row
    // must not take the roster down with it.
    expect(list.map((entry) => entry.teammateId)).toEqual([good.teammateId])
  })

  it('treats a file from an unknown schema as empty rather than guessing', async () => {
    const { root } = await store()
    await writeFile(
      join(root, 'teammates.json'),
      JSON.stringify({ schemaVersion: 99, teammates: [{ teammateId: 'tm_x' }] }),
      'utf8'
    )
    expect(await createTeammateStore({ rootDirectory: root }).list()).toEqual([])
  })

  it('survives a corrupt file', async () => {
    const { root } = await store()
    await writeFile(join(root, 'teammates.json'), 'not json at all', 'utf8')
    expect(await createTeammateStore({ rootDirectory: root }).list()).toEqual([])
  })

  it('assigns missions and forgets them when the teammate is removed', async () => {
    const { store: teammates } = await store()
    const wren = await teammates.create({ name: 'Wren', hue: 'lime', role: 'Code & Migrations' })
    await teammates.assignMission(wren.teammateId, 'mission_1')
    expect(await teammates.missionOwners()).toEqual({ mission_1: wren.teammateId })

    await teammates.remove(wren.teammateId)

    // A mission pointing at a teammate who no longer exists reads as
    // unassigned, never as a dangling reference the UI has to guess about.
    expect(await teammates.list()).toEqual([])
    expect(await teammates.missionOwners()).toEqual({})
  })

  it('refuses to assign a mission to a teammate that does not exist', async () => {
    const { store: teammates } = await store()
    await expect(teammates.assignMission('tm_ghost', 'mission_1')).rejects.toThrow()
  })

  it('refuses unsafe ids', async () => {
    const { store: teammates } = await store()
    const wren = await teammates.create({ name: 'Wren', hue: 'lime', role: 'Docs & QA' })
    await expect(teammates.assignMission(wren.teammateId, '../escape')).rejects.toThrow()
    await expect(teammates.remove('../../etc')).rejects.toThrow()
  })

  it('serializes concurrent creates without losing any', async () => {
    const { store: teammates } = await store()
    await Promise.all([
      teammates.create({ name: 'A', hue: 'lime', role: 'Docs & QA' }),
      teammates.create({ name: 'B', hue: 'blue', role: 'Docs & QA' }),
      teammates.create({ name: 'C', hue: 'violet', role: 'Docs & QA' })
    ])
    expect((await teammates.list()).map((entry) => entry.name).sort()).toEqual(['A', 'B', 'C'])
  })

  it('leaves no temporary files behind', async () => {
    const { root, store: teammates } = await store()
    await teammates.create({ name: 'Wren', hue: 'lime', role: 'Docs & QA' })
    const { readdir } = await import('node:fs/promises')
    expect((await readdir(root)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })
})

describe('teammate record parsing', () => {
  it('accepts a well-formed record', () => {
    expect(
      parsedTeammate({
        teammateId: 'tm_1',
        name: 'Wren',
        hue: 'lime',
        role: 'Code & Migrations',
        createdAt: '2026-08-31T16:00:00.000Z'
      })
    ).toBeDefined()
  })

  it('refuses records missing or malforming any field', () => {
    const base = {
      teammateId: 'tm_1',
      name: 'Wren',
      hue: 'lime',
      role: 'Code & Migrations',
      createdAt: '2026-08-31T16:00:00.000Z'
    }
    expect(parsedTeammate({ ...base, teammateId: '../x' })).toBeUndefined()
    expect(parsedTeammate({ ...base, hue: 'gold' })).toBeUndefined()
    expect(parsedTeammate({ ...base, role: 'Anything' })).toBeUndefined()
    expect(parsedTeammate({ ...base, createdAt: 'not a date' })).toBeUndefined()
    expect(parsedTeammate(null)).toBeUndefined()
  })
})

describe('workspace settings', () => {
  it('defaults swarm off and persists a change', async () => {
    const { root, store: teammates } = await store()
    expect(await teammates.readSettings()).toEqual({ swarm: false })

    await teammates.writeSettings({ swarm: true })

    expect(await createTeammateStore({ rootDirectory: root }).readSettings()).toEqual({ swarm: true })
  })

  it('only a literal true turns it on', async () => {
    // A malformed message must not be able to enable a workspace-wide setting.
    const { store: teammates } = await store()
    for (const value of ['true', 1, {}, [], null, undefined]) {
      await teammates.writeSettings({ swarm: value })
      expect(await teammates.readSettings()).toEqual({ swarm: false })
    }
  })

  it('reads a corrupt settings block as off without losing the roster', async () => {
    const { root, store: teammates } = await store()
    const wren = await teammates.create({ name: 'Wren', hue: 'lime', role: 'Docs & QA' })
    const path = join(root, 'teammates.json')
    const file = JSON.parse(await readFile(path, 'utf8'))
    file.settings = 'not an object'
    await writeFile(path, JSON.stringify(file), 'utf8')

    const reopened = createTeammateStore({ rootDirectory: root })
    expect(await reopened.readSettings()).toEqual({ swarm: false })
    expect((await reopened.list()).map((entry) => entry.teammateId)).toEqual([wren.teammateId])
  })

  it('keeps teammates when settings are written', async () => {
    const { store: teammates } = await store()
    await teammates.create({ name: 'Wren', hue: 'lime', role: 'Docs & QA' })
    await teammates.writeSettings({ swarm: true })
    expect(await teammates.list()).toHaveLength(1)
  })
})
