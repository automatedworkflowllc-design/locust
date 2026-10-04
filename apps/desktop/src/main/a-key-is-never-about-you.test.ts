import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { aboutYouSecretRefusal, secretIn } from '../shared/secrets.js'
import { createTeammateStore } from './teammate-store.js'

/**
 * A KEY IS NEVER PART OF ABOUT YOU; A PERSON IS (0.433).
 *
 * About you (0.423) is read by every teammate on every provider, like a
 * memory, and it was the one such thing with no guard. Colin, 2026-09-28:
 * "honestly agents keep personal details about the user to help understand
 * them, i dont see why its an issue ... maybe just passwords and api
 * keys/stuff like that." So the guard is keys, and only keys.
 */
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
const store = async () => {
  const root = await mkdtemp(join(tmpdir(), 'locust-about-you-key-'))
  roots.push(root)
  return createTeammateStore({ rootDirectory: root })
}
const PERSON = 'Sam, in Fairhaven. Daughter Juniper. Email sam@example.com, phone 352-555-0142. Likes short answers.'

describe('About you', () => {
  it('keeps personal details: names, places, family, an email, a phone number', async () => {
    expect(secretIn(PERSON)).toBeUndefined()
    const teammates = await store()
    expect((await teammates.writeSettings({ aboutYou: PERSON })).aboutYou).toBe(PERSON)
  })

  it('refuses a key or a password, whoever sends it, and the note is left as it was', async () => {
    const teammates = await store()
    await teammates.writeSettings({ aboutYou: PERSON })
    for (const keyed of ['My OpenAI key is sk-proj-abcdefghijklmnopqrstuvwxyz0123', 'password: hunter2hunter2', 'github token ghp_abcdefghijklmnopqrstuvwxyz0123456789']) {
      await expect(teammates.writeSettings({ aboutYou: keyed })).rejects.toThrow(/every teammate on every provider/)
    }
    expect((await teammates.readSettings()).aboutYou).toBe(PERSON)
  })

  it('says why in plain words, without repeating the key', () => {
    const said = aboutYouSecretRefusal('an OpenAI API key')
    expect(said).toBe("That holds an OpenAI API key, and About you is read by every teammate on every provider, so it was not saved. Keep keys in the runtime's own sign-in or an environment variable.")
    expect(aboutYouSecretRefusal('a password or key', 'Ada')).toMatch(/^A line Ada suggested for About you held a password or key, so it was not put to you/)
  })
})
