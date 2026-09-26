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
        const made = await store.create({ name: mate.name, hue: mate.hue, role: mate.role, ...(mate.roleTitle === undefined ? {} : { roleTitle: mate.roleTitle }), avatar })
        expect(made.avatar.bot).toEqual(mate.bot)
        expect(made.route).toBeUndefined()
      }
      expect((await store.list()).map((mate) => mate.name)).toEqual(template.teammates.map((mate) => mate.name))
    }
  })
})
