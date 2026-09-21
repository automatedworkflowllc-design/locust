import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createTeammateStore, parsedTeammate } from './teammate-store.js'

/**
 * The hub is identity, like a route: the conversation a teammate's replies
 * to other teammates land in. It has to survive everything a route survives
 * -- a rename, a new face, a relaunch -- and read as absent, never as
 * garbage, from a file anything could have edited.
 */

const roots: string[] = []

async function store() {
  const root = await mkdtemp(join(tmpdir(), 'locust-hub-'))
  roots.push(root)
  return { root, store: createTeammateStore({ rootDirectory: root }) }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('a teammate keeps the hub their replies live in', () => {
  it('records the newest turn, and reads it back after a relaunch', async () => {
    const { root, store: teammates } = await store()
    const wren = await teammates.create({ name: 'Wren', hue: 'lime', role: 'Code & Migrations' })
    await teammates.rememberHub(wren.teammateId, 'mission_hub1')
    await teammates.rememberHub(wren.teammateId, 'mission_hub2')
    expect((await teammates.list())[0]?.hubMissionId).toBe('mission_hub2')
    const again = createTeammateStore({ rootDirectory: root })
    expect((await again.list())[0]?.hubMissionId).toBe('mission_hub2')
  })

  it('survives a rename and a new face, the way the route does', async () => {
    const { store: teammates } = await store()
    const wren = await teammates.create({ name: 'Wren', hue: 'lime', role: 'Code & Migrations' })
    await teammates.rememberHub(wren.teammateId, 'mission_hub1')
    const renamed = await teammates.update({
      teammateId: wren.teammateId,
      name: 'Wrenna',
      hue: 'blue',
      role: 'Docs & QA',
      avatar: wren.avatar
    })
    expect(renamed.hubMissionId).toBe('mission_hub1')
    expect((await teammates.list())[0]?.hubMissionId).toBe('mission_hub1')
  })

  it('ignores an unknown teammate and a bad id rather than throwing at the relay', async () => {
    const { store: teammates } = await store()
    const wren = await teammates.create({ name: 'Wren', hue: 'lime', role: 'Code & Migrations' })
    await expect(teammates.rememberHub('tm_nobody', 'mission_hub1')).resolves.toBeUndefined()
    await expect(teammates.rememberHub(wren.teammateId, 'not a mission id')).resolves.toBeUndefined()
    await expect(teammates.rememberHub(wren.teammateId, 7)).resolves.toBeUndefined()
    expect((await teammates.list())[0]?.hubMissionId).toBeUndefined()
  })

  it('reads a hub that is not a mission id as no hub', () => {
    const base = {
      teammateId: 'tm_wren',
      name: 'Wren',
      hue: 'lime',
      role: 'Code & Migrations',
      createdAt: '2026-09-21T00:00:00.000Z'
    }
    expect(parsedTeammate({ ...base, hubMissionId: 'mission_hub1' })?.hubMissionId).toBe('mission_hub1')
    expect(parsedTeammate({ ...base, hubMissionId: '../etc/passwd' })?.hubMissionId).toBeUndefined()
    expect(parsedTeammate({ ...base, hubMissionId: 42 })?.hubMissionId).toBeUndefined()
    expect(parsedTeammate(base)?.hubMissionId).toBeUndefined()
  })

  it('goes with the teammate when they are removed', async () => {
    const { root, store: teammates } = await store()
    const wren = await teammates.create({ name: 'Wren', hue: 'lime', role: 'Code & Migrations' })
    await teammates.rememberHub(wren.teammateId, 'mission_hub1')
    await teammates.remove(wren.teammateId)
    const text = await readFile(join(root, 'teammates.json'), 'utf8').catch(() => '')
    expect(text).not.toContain('mission_hub1')
  })

  it('is untouched by an edit of the file that drops it', async () => {
    // A hand-edited roster with no hub reads as "no hub yet", and the next
    // relayed reply begins one. Nothing crashes, nothing is invented.
    const { root, store: teammates } = await store()
    const wren = await teammates.create({ name: 'Wren', hue: 'lime', role: 'Code & Migrations' })
    await teammates.rememberHub(wren.teammateId, 'mission_hub1')
    const path = join(root, 'teammates.json')
    const file = JSON.parse(await readFile(path, 'utf8')) as { teammates: Record<string, unknown>[] }
    delete file.teammates[0]?.hubMissionId
    await writeFile(path, JSON.stringify(file))
    expect((await teammates.list())[0]?.hubMissionId).toBeUndefined()
  })
})
