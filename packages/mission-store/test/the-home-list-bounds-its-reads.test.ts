import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createFileMissionLedger } from '../src/index.js'

const counts = vi.hoisted(() => ({ enabled: false, reads: 0, stats: 0, readPeak: 0, statPeak: 0 }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  async function tracked<T>(kind: 'reads' | 'stats', work: () => Promise<T>): Promise<T> {
    if (!counts.enabled) return work()
    const peak = kind === 'reads' ? 'readPeak' : 'statPeak'
    counts[kind] += 1
    counts[peak] = Math.max(counts[peak], counts[kind])
    try {
      // Hold the actual filesystem operation briefly so overlap is measurable,
      // regardless of how quickly the local disk serves these tiny files.
      await new Promise((resolve) => setTimeout(resolve, 1))
      return await work()
    } finally {
      counts[kind] -= 1
    }
  }
  return {
    ...fs,
    stat: (...args: Parameters<typeof fs.stat>) => tracked('stats', () => fs.stat(...args)),
    open: async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args)
      return new Proxy(handle, {
        get(target, key) {
          if (key === 'readFile') return (...args: Parameters<typeof handle.readFile>) =>
            tracked('reads', () => handle.readFile(...args))
          const value = Reflect.get(target, key)
          return typeof value === 'function' ? value.bind(target) : value
        }
      })
    }
  }
})

let root: string | undefined
afterEach(async () => {
  counts.enabled = false
  if (root !== undefined) await rm(root, { recursive: true, force: true })
})

it('lists all 40 ledgers in order with no more than 16 reads or stats in flight', async () => {
  root = await mkdtemp(join(tmpdir(), 'locust-home-list-'))
  const ledger = createFileMissionLedger({ rootDirectory: root })
  const ids = Array.from({ length: 40 }, (_, i) => `mission_${i}`)
  for (const [i, missionId] of ids.entries()) {
    await ledger.createMission({
      missionId, runId: `run_${i}`, prompt: 'Test history.', runtime: 'codex',
      model: 'account-default', requestedRouteId: 'codex', resolvedRouteId: 'codex-account:default',
      cliVersion: 'test', workspaceId: 'ws_test', sandbox: 'read-only', executionPolicyVersion: 1,
      createdAt: new Date(Date.UTC(2026, 9, 4, 0, 0, i)).toISOString()
    })
  }
  Object.assign(counts, { enabled: true, reads: 0, stats: 0, readPeak: 0, statPeak: 0 })
  const first = await ledger.listMissions({ limit: 40 })
  expect(first.issues).toEqual([])
  expect(first.missions.map((mission) => mission.metadata.missionId)).toEqual([...ids].reverse())
  expect(counts.readPeak).toBeGreaterThan(1)
  expect(counts.readPeak).toBeLessThanOrEqual(16)

  // The recency stat batch only runs above the 2,000-file cap. Empty files
  // exercise that path without creating more valid missions than the 40 above.
  counts.enabled = false
  for (let start = 0; start < 1961; start += 64) {
    await Promise.all(Array.from({ length: Math.min(64, 1961 - start) }, async (_, i) => {
      const path = join(root!, `empty_${start + i}.jsonl`)
      await writeFile(path, '')
      await utimes(path, 0, 0)
    }))
  }
  counts.enabled = true
  const crowded = await ledger.listMissions({ limit: 40 })
  expect(crowded.missions.map((mission) => mission.metadata.missionId)).toEqual([...ids].reverse())
  expect(counts.statPeak).toBeGreaterThan(1)
  expect(counts.statPeak).toBeLessThanOrEqual(16)
  expect(counts.readPeak).toBeLessThanOrEqual(16)
  expect(counts.reads).toBe(0)
  expect(counts.stats).toBe(0)
}, 60_000)
