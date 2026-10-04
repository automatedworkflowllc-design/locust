import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createAntigravityHostProbe } from './antigravity-host.js'

/**
 * Fable's probing review, 2026-09-21, #7. Every sweep ran two PowerShell
 * round trips to find Antigravity's language server -- 4.2-5.5 s of the
 * sweep on Colin's machine -- for an answer that changes only when
 * Antigravity opens or closes. `tasklist` (264 ms here) says whether a
 * language server exists and which; the same pids mean the same answer.
 */

const SERVER_CMD =
  'C:\\lad\\Programs\\antigravity\\resources\\bin\\language_server.exe --standalone --override_ide_name antigravity --subclient_type hub --override_ide_version 2.11.0 --https_server_port 0 --csrf_token 60843f52-6d41-4d97-9b31-53157a780b5e --app_data_dir antigravity'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

/** A LOCALAPPDATA with Antigravity installed, so the probe gets past the disk check. */
async function installed(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'locust-ag-'))
  roots.push(root)
  const bin = join(root, 'Programs', 'antigravity', 'resources', 'bin')
  await mkdir(bin, { recursive: true })
  await writeFile(join(bin, 'language_server.exe'), '')
  return root
}

function harness(localAppData: string, pids: () => Promise<readonly number[] | undefined>) {
  let powershell = 0
  let now = 1_000_000
  const probe = createAntigravityHostProbe({
    platform: 'win32',
    localAppData,
    home: 'C:\\Users\\dev',
    now: () => now,
    listPids: pids,
    listProcesses: async () => {
      powershell += 1
      return [{ pid: 5344, commandLine: SERVER_CMD }]
    },
    listeningPorts: async () => [49839],
    run: async () => ({ stdout: '{"error":"conversation not found"}', stderr: '', code: 0 })
  })
  return { probe, powershell: () => powershell, tick: (ms: number) => { now += ms; return now } }
}

describe('a language server that did not change is not asked again', () => {
  it('runs PowerShell once, then answers from tasklist while the pids are the same', async () => {
    const { probe, powershell, tick } = harness(await installed(), async () => [5344])
    const first = await probe.probe()
    expect(first?.address).toBe('localhost:49839')
    expect(powershell()).toBe(1)
    // Past the TTL, so the cache alone would not answer.
    tick(11_000)
    const again = await probe.probe()
    expect(again?.address).toBe('localhost:49839')
    // Same pids, same answer, no second PowerShell.
    expect(powershell()).toBe(1)
  })

  it('runs no PowerShell at all when tasklist finds no language server', async () => {
    const { probe, powershell } = harness(await installed(), async () => [])
    expect(await probe.probe()).toBeUndefined()
    expect(powershell()).toBe(0)
    const record = await probe.discoveryRecord()
    expect(record.readiness).toBe('unhealthy')
  })

  it('falls back to PowerShell when tasklist could not say', async () => {
    const { probe, powershell } = harness(await installed(), async () => undefined)
    const host = await probe.probe()
    expect(host?.address).toBe('localhost:49839')
    expect(powershell()).toBe(1)
  })

  it('asks PowerShell again when the set of processes changed', async () => {
    let pids: readonly number[] = [5344]
    const { probe, powershell, tick } = harness(await installed(), async () => pids)
    await probe.probe()
    expect(powershell()).toBe(1)
    // Antigravity restarted: a different pid past the TTL is a new look.
    pids = [7001]
    tick(11_000)
    await probe.probe()
    expect(powershell()).toBe(2)
  })

  it('answers from the cache inside the TTL without even asking tasklist', async () => {
    let asked = 0
    const { probe, powershell } = harness(await installed(), async () => {
      asked += 1
      return [5344]
    })
    await probe.probe()
    await probe.probe()
    expect(asked).toBe(1)
    expect(powershell()).toBe(1)
  })
})
