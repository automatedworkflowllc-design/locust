import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createTeammateStore, TeammateNameTakenError } from './teammate-store.js'

/**
 * A2.18: TWO TEAMMATES MAY NOT SHARE A NAME.
 *
 * A teammate is reached by the name a model writes in `to=`, and a name two
 * teammates share is refused as ambiguous -- with two Wrens a message could
 * reach neither. The store refuses the second, however it is spelled.
 */
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function store() {
  const root = await mkdtemp(join(tmpdir(), 'locust-names-'))
  roots.push(root)
  return createTeammateStore({ rootDirectory: root })
}
const WREN = { name: 'Wren', hue: 'lime', role: 'Code & Migrations' }

describe('a teammate name', () => {
  it('cannot be given to a second teammate, whatever its case or spaces', async () => {
    const teammates = await store()
    await teammates.create(WREN)
    for (const name of ['Wren', 'wren', '  WREN  ']) {
      await expect(teammates.create({ ...WREN, name })).rejects.toThrow('Another teammate is already called Wren. Pick another name.')
    }
    await expect(teammates.create({ ...WREN, name: 'wren' })).rejects.toBeInstanceOf(TeammateNameTakenError)
    expect((await teammates.list()).map((teammate) => teammate.name)).toEqual(['Wren'])
  })

  it('cannot be taken by a rename, but a teammate keeps its own', async () => {
    const teammates = await store()
    const wren = await teammates.create(WREN)
    const booty = await teammates.create({ ...WREN, name: 'Booty' })
    await expect(
      teammates.update({ teammateId: booty.teammateId, name: 'WREN', hue: booty.hue, role: booty.role, avatar: booty.avatar })
    ).rejects.toBeInstanceOf(TeammateNameTakenError)
    // Its own name, unchanged or in another case, is still its own.
    const kept = await teammates.update({ teammateId: wren.teammateId, name: 'wren', hue: 'blue', role: wren.role, avatar: wren.avatar })
    expect(kept.name).toBe('wren')
  })
})
