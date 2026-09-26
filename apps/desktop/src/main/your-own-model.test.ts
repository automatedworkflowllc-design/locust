import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createOwnModelStore, isOwnRouteModel, ownRouteModel, testOwnEndpoint } from './own-models.js'
import type { SecretBox } from './own-models.js'

/**
 * YOUR OWN MODEL (0.357): kept, keyed, listed and tested.
 *
 * The key is the part that must be right. It is encrypted by the operating
 * system before it touches the disk, it is never handed to the window, and a
 * machine that cannot encrypt keeps no key rather than writing it in the
 * clear.
 */
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

/** A stand-in for safeStorage that visibly changes the text, and can be switched off. */
const box = (available = true): SecretBox => ({
  available: () => available,
  encrypt: (text) => Buffer.from(`sealed:${[...text].reverse().join('')}`, 'utf8'),
  decrypt: (cipher) => [...cipher.toString('utf8').replace(/^sealed:/, '')].reverse().join('')
})

async function store(available = true) {
  const rootDirectory = await mkdtemp(join(tmpdir(), 'locust-own-models-'))
  roots.push(rootDirectory)
  let id = 0
  return {
    rootDirectory,
    models: createOwnModelStore({ rootDirectory, secrets: box(available), createId: () => `a1b2c3d${String(id++)}`, now: () => new Date('2026-09-26T09:00:00.000Z') })
  }
}

const ACME = { name: 'Acme Chat', baseUrl: 'https://llm.acme.example/v1/', model: 'acme-70b', key: 'sk-acme-secret' }

describe('a model of your own', () => {
  it('is kept with its key encrypted, and the window is told only that a key is kept', async () => {
    const { rootDirectory, models } = await store()
    const added = await models.add(ACME)
    expect(added).toEqual({ ownId: 'a1b2c3d0', name: 'Acme Chat', baseUrl: 'https://llm.acme.example/v1', model: 'acme-70b', hasKey: true, createdAt: '2026-09-26T09:00:00.000Z' })
    expect(JSON.stringify(await models.list())).not.toContain('sk-acme-secret')
    const onDisk = await readFile(join(rootDirectory, 'own-models.json'), 'utf8')
    expect(onDisk).not.toContain('sk-acme-secret')
    expect(onDisk).toContain(Buffer.from('sealed:terces-emca-ks', 'utf8').toString('base64'))
  })

  it('gives a run the provider it needs, key decrypted, and nothing for one no longer kept', async () => {
    const { models } = await store()
    const added = await models.add(ACME)
    const route = ownRouteModel(added)
    expect(route).toBe('own-a1b2c3d0/acme-70b')
    expect(isOwnRouteModel(route)).toBe(true)
    expect(await models.providerFor(route)).toEqual({
      id: 'own-a1b2c3d0',
      provider: { name: 'Acme Chat', baseUrl: 'https://llm.acme.example/v1', models: ['acme-70b'], apiKey: 'sk-acme-secret' }
    })
    await models.remove(added.ownId)
    expect(await models.providerFor(route)).toBeUndefined()
  })

  it('is in the model list under OpenCode, by its own name, marked as yours', async () => {
    const { models } = await store()
    await models.add({ ...ACME, key: undefined })
    expect(await models.catalog()).toEqual([
      { id: 'own-a1b2c3d0/acme-70b', runtime: 'opencode', displayName: 'Acme Chat', description: 'Your model · llm.acme.example', supportedEfforts: [], own: true }
    ])
  })

  it('keeps no key on a machine that cannot protect one -- and says so', async () => {
    const { models } = await store(false)
    await expect(models.add(ACME)).rejects.toThrow(/cannot protect a key/)
    // Without a key it is kept: a model on this machine usually needs none.
    expect((await models.add({ ...ACME, key: '' })).hasKey).toBe(false)
  })

  it('refuses what is not a name, an http(s) address or a model id, in words', async () => {
    const { models } = await store()
    await expect(models.add({ ...ACME, name: '' })).rejects.toThrow(/name/)
    await expect(models.add({ ...ACME, baseUrl: 'ftp://llm.example' })).rejects.toThrow(/http:\/\/ or https:\/\//)
    await expect(models.add({ ...ACME, model: 'two words' })).rejects.toThrow(/model is the id/)
    await models.add(ACME)
    await expect(models.add(ACME)).rejects.toThrow(/already have a model called Acme Chat/)
  })
})

describe('testing an endpoint', () => {
  const answering = (status: number, body: unknown): typeof fetch =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

  it('says it answered and serves the model', async () => {
    expect(await testOwnEndpoint({ baseUrl: 'https://x/v1', model: 'acme-70b' }, answering(200, { data: [{ id: 'acme-70b' }] }))).toEqual({ ok: true, said: 'It answered, and serves acme-70b.' })
  })

  it('catches a model name the endpoint does not know, naming what it does', async () => {
    const said = await testOwnEndpoint({ baseUrl: 'https://x/v1', model: 'acme-7b' }, answering(200, { data: [{ id: 'acme-70b' }, { id: 'acme-8b' }] }))
    expect(said).toEqual({ ok: false, said: 'It answered, but does not list acme-7b. It lists acme-70b, acme-8b.' })
  })

  it('says a refused key is a refused key', async () => {
    expect((await testOwnEndpoint({ baseUrl: 'https://x/v1', model: 'm', key: 'bad' }, answering(401, {}))).said).toBe('It answered, and refused the key.')
  })

  it('sends the key as a bearer token, to that address only', async () => {
    let asked: { url: string; auth: string | undefined } | undefined
    const recording = (async (url: string, init?: RequestInit) => {
      asked = { url, auth: (init?.headers as Record<string, string> | undefined)?.authorization }
      return new Response(JSON.stringify({ data: [] }), { status: 200 })
    }) as unknown as typeof fetch
    await testOwnEndpoint({ baseUrl: 'https://llm.acme.example/v1', model: 'm', key: 'sk-1' }, recording)
    expect(asked).toEqual({ url: 'https://llm.acme.example/v1/models', auth: 'Bearer sk-1' })
  })

  it('says it could not be reached, rather than throwing', async () => {
    const down = (async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:11434')
    }) as unknown as typeof fetch
    expect((await testOwnEndpoint({ baseUrl: 'http://127.0.0.1:11434/v1', model: 'm' }, down)).said).toBe('It could not be reached: connect ECONNREFUSED 127.0.0.1:11434.')
  })
})
