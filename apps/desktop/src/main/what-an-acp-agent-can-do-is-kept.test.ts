// W12 (0.566): what an Agent Client Protocol agent says it can do is kept per
// runtime, survives a relaunch, reaches Settings through discovery, and a
// file that is not the right shape is read as nothing.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'

import type { RuntimeDiscovery } from '@teammate/runtime-adapters'
import { createAcpCapabilitiesStore } from './acp-capabilities.js'
import { createRuntimeDiscoveryService } from './runtime-discovery.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function scratch(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'locust-acp-capabilities-'))
  roots.push(root)
  return root
}
const said = { continuesSessions: true, images: true, audio: false, embeddedContext: true, mcpOverHttp: false, mcpOverSse: false }
const at = () => new Date('2026-10-03T12:00:00.000Z')

it('keeps what the agent said, and reads it back after a relaunch', async () => {
  const root = await scratch()
  const first = createAcpCapabilitiesStore({ rootDirectory: root, now: at })
  await first.load()
  expect(first.get('copilot')).toBeUndefined()
  first.record('copilot', said)
  await first.settled()
  const again = createAcpCapabilitiesStore({ rootDirectory: root })
  await again.load()
  expect(again.get('copilot')).toEqual({ ...said, toldAt: '2026-10-03T12:00:00.000Z' })
  expect(again.get('codex')).toBeUndefined()
})

it('reads a file of the wrong shape as nothing, entry by entry', async () => {
  const root = await scratch()
  await writeFile(join(root, 'acp-capabilities.json'), JSON.stringify({
    schemaVersion: 1,
    runtimes: {
      copilot: { ...said, toldAt: '2026-10-03T12:00:00.000Z' },
      cursor: { ...said, images: 'yes', toldAt: '2026-10-03T12:00:00.000Z' },
      gemini: { ...said, toldAt: 'whenever' }
    }
  }))
  const store = createAcpCapabilitiesStore({ rootDirectory: root })
  await store.load()
  expect(store.get('copilot')?.images).toBe(true)
  expect(store.get('cursor')).toBeUndefined()
  expect(store.get('gemini')).toBeUndefined()
  await writeFile(join(root, 'acp-capabilities.json'), '{ not json')
  const broken = createAcpCapabilitiesStore({ rootDirectory: root })
  await broken.load()
  expect(broken.get('copilot')).toBeUndefined()
})

it('reaches Settings on the runtime it was said by, and no other', async () => {
  const root = await scratch()
  const store = createAcpCapabilitiesStore({ rootDirectory: root, now: at })
  store.record('copilot', said)
  const runtime = (id: string, displayName: string) => ({ id, displayName, availability: 'available', readiness: 'ready' }) as unknown as RuntimeDiscovery
  const discovery = createRuntimeDiscoveryService({
    probe: async () => [runtime('copilot', 'GitHub Copilot'), runtime('codex', 'Codex')],
    agentCapabilities: (id) => store.get(id)
  })
  const answer = await discovery.get()
  if (!answer.ok) throw new Error('discovery failed')
  expect(answer.data.runtimes.find((entry) => entry.id === 'copilot')?.agentCapabilities).toEqual({ ...said, toldAt: '2026-10-03T12:00:00.000Z' })
  expect(answer.data.runtimes.find((entry) => entry.id === 'codex')).not.toHaveProperty('agentCapabilities')
  await store.settled()
})

it('reaches an answer discovery already cached, without probing a CLI again (measured on 0.566)', async () => {
  const root = await scratch()
  const store = createAcpCapabilitiesStore({ rootDirectory: root, now: at })
  let probes = 0
  const runtime = { id: 'copilot', displayName: 'GitHub Copilot', availability: 'available', readiness: 'ready' } as unknown as RuntimeDiscovery
  const discovery = createRuntimeDiscoveryService({
    probe: async () => {
      probes += 1
      return [runtime]
    },
    agentCapabilities: (id) => store.get(id),
    cacheTtlMs: 60_000
  })
  const before = await discovery.get()
  if (!before.ok) throw new Error('discovery failed')
  expect(before.data.runtimes[0]).not.toHaveProperty('agentCapabilities')
  // A Copilot run starts and says what it can do; the next ask is answered from the cache.
  store.record('copilot', said)
  const after = await discovery.get()
  if (!after.ok) throw new Error('discovery failed')
  expect(after.data.runtimes[0]?.agentCapabilities?.continuesSessions).toBe(true)
  expect(probes).toBe(1)
  await store.settled()
})
