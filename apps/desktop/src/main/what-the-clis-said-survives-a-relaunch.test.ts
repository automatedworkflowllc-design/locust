import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createRuntimeFactsStore, MAX_REMEMBERED_BINARIES } from './runtime-facts.js'

/**
 * The point of remembering what a CLI said about itself is to skip its
 * version and help probes on the NEXT launch, so the file has to come back.
 * Everything here is an optimisation, so nothing here may throw: a store
 * that cannot be read or written costs one extra probe, which is what the
 * app did before this existed.
 */

const roots: string[] = []
async function root(): Promise<string> {
  const made = await mkdtemp(join(tmpdir(), 'locust-facts-'))
  roots.push(made)
  return made
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((made) => rm(made, { recursive: true, force: true })))
})


describe('what the CLIs said survives a relaunch', () => {
  it('reads back what it wrote', async () => {
    const directory = await root()
    const first = createRuntimeFactsStore({ rootDirectory: directory })
    await first.load()
    first.set('claude:1000:10', { versionText: '2.1.0', capabilityText: '--resume' })
    await first.settled()
    const second = createRuntimeFactsStore({ rootDirectory: directory })
    await second.load()
    expect(second.get('claude:1000:10')).toEqual({ versionText: '2.1.0', capabilityText: '--resume' })
    expect(second.get('claude:1000:99')).toBeUndefined()
  })

  it('starts empty when there is no file, and when the file is rubbish', async () => {
    const directory = await root()
    const fresh = createRuntimeFactsStore({ rootDirectory: directory })
    await expect(fresh.load()).resolves.toBeUndefined()
    expect(fresh.size()).toBe(0)
    await writeFile(join(directory, 'runtime-facts.json'), '{ not json', 'utf8')
    const broken = createRuntimeFactsStore({ rootDirectory: directory })
    await broken.load()
    expect(broken.size()).toBe(0)
  })

  it('drops an entry whose shape is wrong rather than handing it to the parser', async () => {
    const directory = await root()
    await writeFile(
      join(directory, 'runtime-facts.json'),
      JSON.stringify({
        schemaVersion: 1,
        binaries: [
          { fingerprint: 'good:1:1', versionText: '1.0.0', capabilityText: 'help', at: 1 },
          { fingerprint: 'bad:1:1', versionText: 7, capabilityText: 'help', at: 1 },
          { fingerprint: '', versionText: '1.0.0', capabilityText: 'help', at: 1 },
          'not an entry'
        ]
      }),
      'utf8'
    )
    const store = createRuntimeFactsStore({ rootDirectory: directory })
    await store.load()
    expect(store.size()).toBe(1)
    expect(store.get('good:1:1')?.versionText).toBe('1.0.0')
  })

  it('ignores a file written by a schema it does not know', async () => {
    const directory = await root()
    await writeFile(
      join(directory, 'runtime-facts.json'),
      JSON.stringify({ schemaVersion: 99, binaries: [{ fingerprint: 'a:1:1', versionText: 'x', capabilityText: 'y', at: 1 }] }),
      'utf8'
    )
    const store = createRuntimeFactsStore({ rootDirectory: directory })
    await store.load()
    expect(store.size()).toBe(0)
  })

  it('keeps the newest when it is full, because those are the files on disk now', async () => {
    const directory = await root()
    let clock = 0
    const store = createRuntimeFactsStore({ rootDirectory: directory, now: () => (clock += 1) })
    await store.load()
    for (let index = 0; index < MAX_REMEMBERED_BINARIES + 20; index += 1) {
      store.set(`fp:${String(index)}`, { versionText: String(index), capabilityText: 'help' })
    }
    expect(store.size()).toBe(MAX_REMEMBERED_BINARIES)
    // The first twenty were the oldest, so they are the ones that went.
    expect(store.get('fp:0')).toBeUndefined()
    expect(store.get('fp:19')).toBeUndefined()
    expect(store.get('fp:20')?.versionText).toBe('20')
    await store.settled()
    const written = JSON.parse(await readFile(join(directory, 'runtime-facts.json'), 'utf8')) as { binaries: unknown[] }
    expect(written.binaries).toHaveLength(MAX_REMEMBERED_BINARIES)
  })

  it('does not rewrite the file when nothing changed', async () => {
    const directory = await root()
    const store = createRuntimeFactsStore({ rootDirectory: directory })
    await store.load()
    store.set('a:1:1', { versionText: '1', capabilityText: 'h' })
    await store.settled()
    const before = await readFile(join(directory, 'runtime-facts.json'), 'utf8')
    store.set('a:1:1', { versionText: '1', capabilityText: 'h' })
    await store.settled()
    expect(await readFile(join(directory, 'runtime-facts.json'), 'utf8')).toBe(before)
  })

  it('never throws when the directory it writes to is not there', async () => {
    const store = createRuntimeFactsStore({ rootDirectory: join(tmpdir(), 'locust-facts-absent', 'nope') })
    await expect(store.load()).resolves.toBeUndefined()
    expect(() => store.set('a:1:1', { versionText: '1', capabilityText: 'h' })).not.toThrow()
    await store.settled()
    // And it still answers from memory, so the sweep it is part of is fine.
    expect(store.get('a:1:1')?.versionText).toBe('1')
  })
})
