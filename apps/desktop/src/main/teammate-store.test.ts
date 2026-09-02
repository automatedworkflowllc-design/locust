import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { seedAvatar } from '../shared/avatar.js'
import { createTeammateStore, MAX_MISSION_OWNERS, parsedTeammate, validName } from './teammate-store.js'

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

describe('how many missions the roster will hold', () => {
  it('refuses a new assignment past its cap, instead of growing until the file empties itself', async () => {
    // The file has a size cliff: past its byte limit it READS as empty, and
    // the next write saves that empty file over the real one. Unbounded
    // assignments walk straight into it, taking the roster with them.
    const { root, store: teammates } = await store()
    const wren = await teammates.create({ name: 'Wren', hue: 'lime', role: 'Code & Migrations' })

    const owners: Record<string, string> = {}
    for (let index = 0; index < MAX_MISSION_OWNERS; index += 1) {
      owners[`mission_${String(index)}`] = wren.teammateId
    }
    await writeFile(
      join(root, 'teammates.json'),
      JSON.stringify({ schemaVersion: 1, teammates: [wren], missionOwners: owners, settings: { swarm: false } }),
      'utf8'
    )

    const reopened = createTeammateStore({ rootDirectory: root })
    await expect(reopened.assignMission(wren.teammateId, 'mission_one_too_many')).rejects.toThrow()
    // Re-assigning one it already holds is not growth, and stays allowed.
    await expect(reopened.assignMission(wren.teammateId, 'mission_0')).resolves.toBeUndefined()
  })

  it('reads no more assignments than it would write', async () => {
    const { root, store: teammates } = await store()
    const wren = await teammates.create({ name: 'Wren', hue: 'lime', role: 'Code & Migrations' })
    const owners: Record<string, string> = {}
    for (let index = 0; index < MAX_MISSION_OWNERS + 50; index += 1) {
      owners[`mission_${String(index)}`] = wren.teammateId
    }
    await writeFile(
      join(root, 'teammates.json'),
      JSON.stringify({ schemaVersion: 1, teammates: [wren], missionOwners: owners, settings: { swarm: false } }),
      'utf8'
    )

    const held = await createTeammateStore({ rootDirectory: root }).missionOwners()
    expect(Object.keys(held)).toHaveLength(MAX_MISSION_OWNERS)
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

describe('teammate faces', () => {
  it('seeds a face from the id, never the name', async () => {
    const { store: teammates } = await store()
    const first = await teammates.create({ name: 'Wren', hue: 'lime', role: 'Code & Migrations' })
    const second = await teammates.create({ name: 'Wren', hue: 'lime', role: 'Code & Migrations' })
    expect(first.avatar).toEqual(seedAvatar(first.teammateId))
    expect(second.avatar).toEqual(seedAvatar(second.teammateId))
    // Same name, different ids: a face is identity, and identity is the id.
    expect(first.teammateId).not.toBe(second.teammateId)
  })

  it('keeps the look chosen in the dialog, and refuses one outside the tables', async () => {
    const { root, store: teammates } = await store()
    const chosen = { headwear: 4 as const, accessory: 1 as const, mouth: 3 as const }
    const created = await teammates.create({ name: 'Atlas', hue: 'blue', role: 'Research & Briefs', avatar: chosen })
    expect(created.avatar).toEqual(chosen)
    const reopened = await createTeammateStore({ rootDirectory: root }).list()
    expect(reopened[0]?.avatar).toEqual(chosen)
    await expect(
      teammates.create({ name: 'Nova', hue: 'violet', role: 'Docs & QA', avatar: { headwear: 9, accessory: 0, mouth: 0 } })
    ).rejects.toThrow('avatar is invalid')
  })

  it('keeps a persisted face rather than re-seeding it, and seeds one for a record without', () => {
    const base = { teammateId: 'tm_abc', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-01T00:00:00.000Z' }
    const chosen = { headwear: 2, accessory: 2, mouth: 1 }
    expect(parsedTeammate({ ...base, avatar: chosen })?.avatar).toEqual(chosen)
    // A roster written before faces were persisted: the id's face, the same
    // one every reader derives, so nothing changes on upgrade.
    expect(parsedTeammate(base)?.avatar).toEqual(seedAvatar('tm_abc'))
    expect(parsedTeammate({ ...base, avatar: { headwear: 'cap' } })?.avatar).toEqual(seedAvatar('tm_abc'))
  })
})

describe('editing a teammate', () => {
  it('changes name, hue, role and face while the id and its missions stay', async () => {
    const { root, store: teammates } = await store()
    const created = await teammates.create({ name: 'Wren', hue: 'lime', role: 'Code & Migrations' })
    await teammates.assignMission(created.teammateId, 'mission_1')
    const look = { headwear: 5 as const, accessory: 2 as const, mouth: 2 as const }

    const updated = await teammates.update({
      teammateId: created.teammateId,
      name: '  Wrenna ',
      hue: 'violet',
      role: 'Docs & QA',
      avatar: look
    })

    expect(updated).toEqual({ ...created, name: 'Wrenna', hue: 'violet', role: 'Docs & QA', avatar: look })
    const reopened = createTeammateStore({ rootDirectory: root })
    expect(await reopened.list()).toEqual([updated])
    expect(await reopened.missionOwners()).toEqual({ mission_1: created.teammateId })
  })

  it('refuses an unknown teammate and an invalid field, changing nothing', async () => {
    const { store: teammates } = await store()
    const created = await teammates.create({ name: 'Wren', hue: 'lime', role: 'Code & Migrations' })
    await expect(
      teammates.update({ teammateId: 'tm_nobody', name: 'X', hue: 'lime', role: 'Custom', avatar: created.avatar })
    ).rejects.toThrow('Unknown teammate')
    await expect(
      teammates.update({ teammateId: created.teammateId, name: 'X', hue: 'lime', role: 'Custom', avatar: { headwear: 99 } })
    ).rejects.toThrow('avatar is invalid')
    expect(await teammates.list()).toEqual([created])
  })
})
