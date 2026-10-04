import type { RuntimeDiscovery, RuntimeProcessCompletion, RuntimeProcessRun, RuntimeProcessRunner } from '@teammate/runtime-adapters'
import type { MissionLedger } from '@teammate/mission-store'
import { describe, expect, it, vi } from 'vitest'

import { createCodexMissionService } from './codex-mission.js'

/**
 * A Cursor run outside Auto is given connector rules before it starts and
 * gives them back when its process ends -- completed, failed or cancelled --
 * or when it never starts. A read-only run is given none.
 */

const NOW = '2026-10-04T00:00:00.000Z'
const WORKSPACE = process.platform === 'win32' ? 'C:\\safe-workspace' : '/safe-workspace'

const cursor = {
  id: 'cursor',
  kind: 'agent-runtime',
  displayName: 'Cursor Agent',
  optional: true,
  availability: 'available',
  readiness: 'ready',
  executable: {
    commandName: 'cursor-agent',
    discoveredPath: process.platform === 'win32' ? 'C:\\tools\\cursor-agent.exe' : '/tools/cursor-agent',
    executablePath: process.platform === 'win32' ? 'C:\\tools\\cursor-agent.exe' : '/tools/cursor-agent',
    prefixArgs: [],
    kind: 'native'
  },
  version: { raw: 'cursor-agent 2026.09.01', version: '2026.09.01', major: 2026, minor: 9, patch: 1, prerelease: null },
  supportedFeatures: [],
  requiredFeatures: [],
  diagnostics: []
} as unknown as RuntimeDiscovery

function completion(overrides: Partial<RuntimeProcessCompletion> = {}): RuntimeProcessCompletion {
  return {
    exitCode: 0,
    signal: null,
    stderr: '',
    stderrTruncated: false,
    recordCount: 0,
    cancelled: false,
    forcedTerminationAttempted: false,
    terminationUnconfirmed: false,
    inputDeliveryFailed: false,
    outputLimitExceeded: false,
    oversizedRecordsDropped: 0,
    startedAt: NOW,
    finishedAt: NOW,
    ...overrides
  }
}

const noRecords = {
  async *[Symbol.asyncIterator]() {
    // nothing printed
  },
  drainAvailable: () => []
}

const ledger = {
  createMission: async () => undefined,
  appendEvents: async () => undefined,
  appendHostFailure: async () => undefined,
  flush: async () => undefined,
  getMission: async () => undefined
} as unknown as MissionLedger

function harness(run: () => RuntimeProcessRun) {
  const events: string[] = []
  const start = vi.fn(() => {
    events.push('process-started')
    return run()
  }) satisfies RuntimeProcessRunner['start']
  const allowConnectors = vi.fn(async () => {
    events.push('rules-added')
    return {
      added: ['Mcp(robinhood-local:*)'],
      release: async () => {
        events.push('rules-taken-back')
      }
    }
  })
  const service = createCodexMissionService({
    workspacePath: WORKSPACE,
    platform: 'darwin',
    discover: async () => [cursor],
    runner: { start },
    ledger,
    allowConnectors,
    createId: (() => { let n = 0; return () => String(++n) })(),
    now: () => new Date(NOW),
    schedule: () => undefined
  })
  return { service, events, allowConnectors }
}

describe('a Cursor mission and the connector rules it was given', () => {
  it('gives them back when its process completes', async () => {
    let finish!: (value: RuntimeProcessCompletion) => void
    const { service, events } = harness(() => ({
      records: noRecords,
      completion: new Promise<RuntimeProcessCompletion>((resolve) => { finish = resolve })
    }))
    await service.start('Do work.', 'cursor', 'accept-edits', {}, () => undefined)
    expect(events).toEqual(['rules-added', 'process-started'])
    finish(completion())
    await vi.waitFor(() => expect(events).toEqual(['rules-added', 'process-started', 'rules-taken-back']))
  })

  it('gives them back when it is cancelled', async () => {
    let finish!: (value: RuntimeProcessCompletion) => void
    const { service, events } = harness(() => ({
      records: noRecords,
      completion: new Promise<RuntimeProcessCompletion>((resolve) => { finish = resolve })
    }))
    await service.start('Do work.', 'cursor', 'accept-edits', {}, () => undefined)
    finish(completion({ cancelled: true, exitCode: null, signal: 'SIGTERM' }))
    await vi.waitFor(() => expect(events.at(-1)).toBe('rules-taken-back'))
  })

  it('gives them back when its process fails', async () => {
    const { service, events } = harness(() => ({
      records: noRecords,
      completion: Promise.reject(new Error('the process died'))
    }))
    await service.start('Do work.', 'cursor', 'accept-edits', {}, () => undefined)
    await vi.waitFor(() => expect(events.at(-1)).toBe('rules-taken-back'))
  })

  it('gives them back when the process cannot be started at all', async () => {
    const { service, events } = harness(() => { throw new Error('spawn failed') })
    const response = await service.start('Do work.', 'cursor', 'accept-edits', {}, () => undefined)
    expect(response).toMatchObject({ ok: false })
    await vi.waitFor(() => expect(events).toEqual(['rules-added', 'process-started', 'rules-taken-back']))
  })

  it('is given none, and so has none to give back, when it only reads', async () => {
    const { service, events, allowConnectors } = harness(() => ({ records: noRecords, completion: Promise.resolve(completion()) }))
    await service.start('Read notes.txt.', 'cursor', 'ask', {}, () => undefined)
    expect(allowConnectors).not.toHaveBeenCalled()
    expect(events).toEqual(['process-started'])
  })
})
