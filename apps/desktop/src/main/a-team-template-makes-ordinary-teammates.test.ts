import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { isBotSpec, seedAvatar } from '../shared/avatar.js'
import { TEAM_TEMPLATES } from '../shared/team-templates.js'
import { createTeammateStore } from './teammate-store.js'

/**
 * A TEAM TEMPLATE MAKES ORDINARY TEAMMATES (0.354).
 *
 * Every teammate a template offers is made through the same store as one
 * made by hand, so each must be something the store accepts: a real role, a
 * name no one else on the team has, a face that is a real bot. Made here,
 * against the real store, for every template.
 */
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('the team templates', () => {
  it('are three teams of three, each with names and colours of its own', () => {
    expect(TEAM_TEMPLATES.map((template) => template.templateId)).toEqual(['software', 'money', 'writing'])
    for (const template of TEAM_TEMPLATES) {
      expect(template.teammates).toHaveLength(3)
      expect(new Set(template.teammates.map((mate) => mate.name.toLowerCase())).size).toBe(3)
      expect(new Set(template.teammates.map((mate) => mate.hue)).size).toBe(3)
      for (const mate of template.teammates) {
        expect(isBotSpec(mate.bot)).toBe(true)
        // A Custom teammate says what they do; a built-in role says it itself.
        expect(mate.role === 'Custom' ? (mate.roleTitle ?? '').length > 0 : mate.roleTitle === undefined).toBe(true)
        // Three first messages of their own, each one the store keeps (0.359).
        expect(mate.starters).toHaveLength(3)
        expect(new Set(mate.starters).size).toBe(3)
        for (const starter of mate.starters) expect(starter.length).toBeLessThanOrEqual(300)
      }
    }
  })

  it('each makes three teammates the store accepts, with the faces the cards showed', async () => {
    for (const template of TEAM_TEMPLATES) {
      const root = await mkdtemp(join(tmpdir(), 'locust-template-'))
      roots.push(root)
      const store = createTeammateStore({ rootDirectory: root })
      for (const mate of template.teammates) {
        const avatar = { ...seedAvatar(`template_${template.templateId}_${mate.name}`), bot: mate.bot }
        const made = await store.create({ name: mate.name, hue: mate.hue, role: mate.role, ...(mate.roleTitle === undefined ? {} : { roleTitle: mate.roleTitle }), avatar, starters: mate.starters })
        expect(made.avatar.bot).toEqual(mate.bot)
        expect(made.route).toBeUndefined()
        expect(made.starters).toEqual(mate.starters)
      }
      expect((await store.list()).map((mate) => mate.name)).toEqual(template.teammates.map((mate) => mate.name))
    }
  })

  it("keep a teammate's first messages through an edit, and refuse a list that is not one (0.359)", async () => {
    const root = await mkdtemp(join(tmpdir(), 'locust-template-'))
    roots.push(root)
    const store = createTeammateStore({ rootDirectory: root })
    const sable = TEAM_TEMPLATES[1]!.teammates[0]!
    const made = await store.create({ name: sable.name, hue: sable.hue, role: sable.role, starters: sable.starters })
    // An edit of the name must not turn her money questions back into her role's.
    const renamed = await store.update({ teammateId: made.teammateId, name: 'Sable Two', hue: made.hue, role: made.role, avatar: made.avatar })
    expect(renamed.starters).toEqual(sable.starters)
    expect((await store.list())[0]?.starters).toEqual(sable.starters)
    for (const bad of [[], ['one', ''], ['x'.repeat(301)], ['a', 'b', 'c', 'd', 'e'], 'one line', [7]]) {
      await expect(store.create({ name: 'Nope', hue: 'lime', role: 'Custom', starters: bad })).rejects.toThrow(/starters are invalid/)
    }
  })
})
