import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { seedAvatar } from '../shared/avatar.js'
import { MAX_TEAMMATE_INSTRUCTIONS } from '../shared/ipc.js'
import { createTeammateStore } from './teammate-store.js'
import { teammateSection } from './workspace-brief.js'

/**
 * A TEAMMATE'S OWN INSTRUCTIONS (0.706, from the Paperclip scrub). Kept like
 * the monthly limit: an edit sets them, clears them with null or an empty
 * box, and -- omitted -- carries them, so no other edit loses them.
 */
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})
async function store() {
  const directory = await mkdtemp(join(tmpdir(), 'locust-instructions-'))
  roots.push(directory)
  return { directory, teammates: createTeammateStore({ rootDirectory: directory }) }
}
const edit = (teammateId: string, extra: Record<string, unknown>) => ({ teammateId, name: 'Wren', hue: 'lime', role: 'Code & Migrations', avatar: seedAvatar(teammateId), ...extra })

describe('a teammate has its own instructions', () => {
  it('are made with the teammate, trimmed, and read back after a restart', async () => {
    const s = await store()
    const made = await s.teammates.create({ name: 'Wren', hue: 'lime', role: 'Code & Migrations', instructions: '  Answer in bullet points.  ' })
    expect(made.instructions).toBe('Answer in bullet points.')
    const again = await createTeammateStore({ rootDirectory: s.directory }).list()
    expect(again.find((t) => t.teammateId === made.teammateId)?.instructions).toBe('Answer in bullet points.')
  })
  it('are carried by an edit that does not mention them, changed by one that does, and cleared by null or an empty box', async () => {
    const s = await store()
    const made = await s.teammates.create({ name: 'Wren', hue: 'lime', role: 'Code & Migrations', instructions: 'First.' })
    expect((await s.teammates.update(edit(made.teammateId, {}))).instructions).toBe('First.')
    expect((await s.teammates.update(edit(made.teammateId, { instructions: 'Second.' }))).instructions).toBe('Second.')
    expect((await s.teammates.update(edit(made.teammateId, { instructions: null }))).instructions).toBeUndefined()
    await s.teammates.update(edit(made.teammateId, { instructions: 'Third.' }))
    expect((await s.teammates.update(edit(made.teammateId, { instructions: '   ' }))).instructions).toBeUndefined()
  })
  it('refuses instructions past the cap or not text, and changes nothing', async () => {
    const s = await store()
    const made = await s.teammates.create({ name: 'Wren', hue: 'lime', role: 'Code & Migrations', instructions: 'Kept.' })
    for (const bad of ['x'.repeat(MAX_TEAMMATE_INSTRUCTIONS + 1), 42, ['a']]) {
      await expect(s.teammates.update(edit(made.teammateId, { instructions: bad }))).rejects.toThrow('Teammate instructions are invalid')
    }
    expect((await s.teammates.list()).find((t) => t.teammateId === made.teammateId)?.instructions).toBe('Kept.')
  })
  it('are quoted whole in the brief, named as the teammate\'s own', () => {
    expect(teammateSection('Wren', 'Answer in bullet points.\nAsk before adding a dependency.')).toBe(
      'Standing instructions for you, Wren, from the person. Every turn you take is given these:\nAnswer in bullet points.\nAsk before adding a dependency.'
    )
  })
})
