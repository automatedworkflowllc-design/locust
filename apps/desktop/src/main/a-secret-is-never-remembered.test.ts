import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { secretIn } from '../shared/secrets.js'
import { createMemoryStore } from './memory-store.js'

/**
 * A SECRET IS NEVER REMEMBERED (0.394).
 *
 * A kept memory is pasted into every teammate's brief, on every runtime and
 * provider, and into .locust/memory.md. The brief asks models never to
 * remember a secret; this is the host refusing one anyway. From the
 * agentmemory review (read-only, 2026-09-27): their store redacts these
 * shapes at the door, ours relied on the model behaving.
 *
 * The keys below are made up in the right SHAPE -- none is real.
 */
const FAKE = {
  anthropic: `sk-ant-api03-${'a1B2c3D4'.repeat(4)}`,
  openai: `sk-proj-${'Zx9Yw8Vu'.repeat(4)}`,
  aws: 'AKIAIOSFODNN7EXAMPLE',
  google: `AIza${'SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6q'.slice(0, 35)}`,
  github: `ghp_${'R2d2C3po'.repeat(5)}`,
  jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
  bearer: `Bearer ${'q7W8e9R0t1Y2u3I4o5P6'.repeat(2)}`,
  password: 'password=hunter2hunter2'
}

describe('a secret, by its shape', () => {
  it.each(Object.entries(FAKE))('%s is recognised', (_name, key) => {
    expect(secretIn(`The deploy uses ${key} for the staging account.`)).toBeDefined()
  })

  it.each([
    'Keep the API key in .env, never in the repo.',
    'The password is set in the admin panel, not here.',
    'Tokens expire after an hour; refresh with pnpm auth.',
    'api_key: <your key here>',
    'Commit 8ca60791 fixed the Bearer header parsing.',
    'mission_bc5e76ad-fe34-4489-a4e8-c26eb1eba22f was the interrupted run.',
    'Use sk-ant keys only through the Claude sign-in.',
    'Tests run with pnpm test; the suite is 5,828 tests.'
  ])('an ordinary note is not taken for one: %s', (note) => {
    expect(secretIn(note)).toBeUndefined()
  })

  // QA-2026-09-29 round 2, R2 and R10: secrets as people say them, all kept before.
  it.each([
    ['a login inside an address', 'postgres://admin:hunter2@db.internal:5432/app is the dev database'],
    ['an AWS secret key', 'AWS key [redacted] and secret wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'],
    ['a password', 'The admin login is admin / P@ssw0rd-2026!'],
    ['a password', 'The database password is hunter2hunter2 and the admin login is admin@example.com'],
    ['a passphrase', 'ssh key passphrase is correct horse battery staple'],
    ['a card number', "The person's card number is 4111 1111 1111 1111 exp 12/29"],
    ['a card number', 'Billing uses 4242-4242-4242-4242.']
  ])('%s is recognised when said in words: %s', (kind, note) => {
    expect(secretIn(note)).toBe(kind)
  })

  it.each([
    'The password is stored in the vault.',
    'The password is required on every deploy.',
    'Login is at /login; the form posts to /api/session.',
    'The login page is admin / settings in the menu.',
    'Credentials live in the runtime sign-in, never here.',
    'The passphrase prompt appears on first run.',
    'Postgres runs at postgres://db.internal:5432/app for the tests.',
    'The AWS region is us-east-1 and the bucket is shop-assets.',
    'Order 1234 5678 9012 3456 shipped on Tuesday.',
    'Call the shop at 352-555-0142 or +1 703 555 0174.',
    'The build number was 20260929104512.',
    // Passes Luhn, opens like no card network: a millisecond timestamp.
    'The run started at 1727600000001.',
    'Its secret sauce is caching: see src/cache/index.ts.'
  ])('an ordinary note is still kept: %s', (note) => {
    expect(secretIn(note)).toBeUndefined()
  })
})

let root: string | undefined
afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
})
const WREN = { teammateId: 'tm_wren', name: 'Wren' }
const SHOP = { workspaceId: 'ws_shop', workspaceName: 'shop' }

describe('the memory store', () => {
  it('refuses a memory holding a key, saying why, and writes nothing', async () => {
    root = await mkdtemp(join(tmpdir(), 'locust-secret-'))
    const memories = createMemoryStore({ rootDirectory: root })
    await expect(memories.add({ text: `Staging key is ${FAKE.openai}.`, scope: 'workspace', ...SHOP, by: WREN, status: 'kept' }))
      .rejects.toThrow('It held an OpenAI API key, and a memory is given to every teammate on every provider, so it was not kept.')
    expect(await memories.list()).toEqual([])
    const disk = await readFile(join(root, 'memories.json'), 'utf8').catch(() => '')
    expect(disk).not.toContain(FAKE.openai)
  })

  it('refuses an edit that would put one in, and a tidy pass that would write one', async () => {
    root = await mkdtemp(join(tmpdir(), 'locust-secret-'))
    const memories = createMemoryStore({ rootDirectory: root })
    const { memory } = await memories.add({ text: 'Staging deploys from main.', scope: 'workspace', ...SHOP, by: WREN, status: 'kept' })
    await expect(memories.update({ memoryId: memory.memoryId, text: `Staging deploys with ${FAKE.github}.` })).rejects.toThrow('It held a GitHub token')
    const tidy = await memories.proposeTidy({ workspaceId: SHOP.workspaceId, by: WREN, suggestions: [{ kind: 'rewrite', id: memory.memoryId, text: `Deploy token ${FAKE.aws}.` }] })
    expect(tidy.proposed).toBe(0)
    expect(tidy.refused).toEqual([expect.stringContaining('It held an AWS access key')])
    expect((await memories.list()).map((kept) => kept.text)).toEqual(['Staging deploys from main.'])
  })
})
