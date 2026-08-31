import type {
  RuntimeDiscovery,
  RuntimeJsonlRecord,
  RuntimeProcessCompletion,
  RuntimeProcessRun,
  RuntimeProcessRunner
} from '@teammate/runtime-adapters'
import { describe, expect, it, vi } from 'vitest'
import type { CodexMissionUpdate } from '../shared/ipc.js'
import { createCodexMissionService } from './codex-mission.js'

const NOW = '2026-08-31T15:00:00.000Z'
const WORKSPACE = process.platform === 'win32' ? 'C:\\safe-workspace' : '/safe-workspace'

function codexRuntime(readiness: RuntimeDiscovery['readiness'] = 'ready'): RuntimeDiscovery {
  return {
    id: 'codex',
    kind: 'agent-runtime',
    displayName: 'Codex CLI',
    optional: false,
    availability: 'available',
    readiness,
    executable: {
      commandName: 'codex',
      discoveredPath: process.platform === 'win32' ? 'C:\\tools\\codex.exe' : '/tools/codex',
      executablePath: process.platform === 'win32' ? 'C:\\tools\\codex.exe' : '/tools/codex',
      prefixArgs: [],
      kind: 'native'
    },
    version: {
      raw: 'codex-cli 0.151.0-alpha.7.2',
      version: '0.151.0-alpha.7.2',
      major: 0,
      minor: 151,
      patch: 0,
      prerelease: 'alpha.7.2'
    },
    supportedFeatures: [
      'non-interactive',
      'jsonl-events',
      'stdin-prompt',
      'workspace-selection',
      'read-only-sandbox'
    ],
    requiredFeatures: [
      'non-interactive',
      'jsonl-events',
      'stdin-prompt',
      'workspace-selection',
      'read-only-sandbox'
    ],
    diagnostics: []
  }
}

function completion(overrides: Partial<RuntimeProcessCompletion> = {}): RuntimeProcessCompletion {
  return {
    exitCode: 0,
    signal: null,
    stderr: '',
    stderrTruncated: false,
    recordCount: 4,
    cancelled: false,
    forcedTerminationAttempted: false,
    terminationUnconfirmed: false,
    inputDeliveryFailed: false,
    outputLimitExceeded: false,
    startedAt: NOW,
    finishedAt: NOW,
    ...overrides
  }
}

function records(values: readonly Record<string, unknown>[]): AsyncIterable<RuntimeJsonlRecord> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const [index, value] of values.entries()) {
        yield { sequence: index + 1, raw: JSON.stringify(value) }
      }
    }
  }
}

function scheduledService(runner: RuntimeProcessRunner) {
  const scheduled: Array<() => void> = []
  let nextId = 0
  const service = createCodexMissionService({
    workspacePath: WORKSPACE,
    discover: async () => [codexRuntime()],
    runner,
    createId: () => String(++nextId),
    now: () => new Date(NOW),
    schedule: (task) => scheduled.push(task)
  })
  return { service, scheduled }
}

describe('Codex mission service', () => {
  it('runs one fixed read-only Codex route and streams normalized events', async () => {
    const start = vi.fn((_spec, _prompt, _options): RuntimeProcessRun => ({
      records: records([
        { type: 'thread.started', thread_id: 'thread-live' },
        { type: 'turn.started' },
        { type: 'item.completed', item: { id: 'answer', type: 'agent_message', text: 'Safe result' } },
        { type: 'turn.completed', usage: { output_tokens: 2 } }
      ]),
      completion: Promise.resolve(completion())
    })) satisfies RuntimeProcessRunner['start']
    const { service, scheduled } = scheduledService({ start })
    const updates: CodexMissionUpdate[] = []

    const response = await service.start('Inspect the workspace without changing it.', (update) => {
      updates.push(update)
    })
    expect(response).toMatchObject({
      ok: true,
      data: {
        runId: 'run_1',
        missionId: 'mission_2',
        runtime: 'codex',
        model: 'account-default',
        cliVersion: '0.151.0-alpha.7.2'
      }
    })
    expect(start).toHaveBeenCalledTimes(1)
    const [spec, prompt] = start.mock.calls[0] ?? []
    expect(spec).toMatchObject({ runtime: 'codex', cwd: WORKSPACE, stdin: 'prompt', stdout: 'jsonl' })
    expect(spec?.args).toEqual(expect.arrayContaining(['exec', '--json', '--sandbox', 'read-only', '-C', WORKSPACE, '-']))
    expect(spec?.args).not.toContain(prompt)

    scheduled[0]?.()
    await vi.waitFor(() => {
      expect(updates.some((update) => update.kind === 'event' && update.event.type === 'run.completed')).toBe(true)
    })
    const eventUpdates = updates.filter((update) => update.kind === 'event')
    expect(eventUpdates.every(({ event }) => event.cliVersion === '0.151.0-alpha.7.2')).toBe(true)
    expect(JSON.stringify(updates)).toContain('Safe result')
  })

  it('rejects invalid prompts before discovery or process launch', async () => {
    const discover = vi.fn(async () => [codexRuntime()])
    const start = vi.fn() satisfies RuntimeProcessRunner['start']
    const service = createCodexMissionService({
      workspacePath: WORKSPACE,
      discover,
      runner: { start }
    })

    await expect(service.start('   ', () => undefined)).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_PROMPT' }
    })
    expect(discover).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
  })

  it('returns an actionable generic error when Codex is not ready', async () => {
    const start = vi.fn() satisfies RuntimeProcessRunner['start']
    const service = createCodexMissionService({
      workspacePath: WORKSPACE,
      discover: async () => [codexRuntime('authentication-required')],
      runner: { start }
    })

    await expect(service.start('Do safe work.', () => undefined)).resolves.toEqual({
      ok: false,
      error: {
        code: 'CODEX_UNAVAILABLE',
        message: 'Codex is not ready. Install or sign in to the Codex CLI, then retry discovery.'
      }
    })
    expect(start).not.toHaveBeenCalled()
  })

  it('does not launch a process when its owning window closes during discovery', async () => {
    let finishDiscovery!: (value: readonly RuntimeDiscovery[]) => void
    const discovery = new Promise<readonly RuntimeDiscovery[]>((resolve) => {
      finishDiscovery = resolve
    })
    const start = vi.fn() satisfies RuntimeProcessRunner['start']
    const service = createCodexMissionService({
      workspacePath: WORKSPACE,
      discover: () => discovery,
      runner: { start }
    })

    const response = service.start('Do safe work.', () => undefined)
    service.dispose()
    finishDiscovery([codexRuntime()])

    await expect(response).resolves.toMatchObject({
      ok: false,
      error: { code: 'RUNTIME_START_FAILED' }
    })
    expect(start).not.toHaveBeenCalled()
  })

  it('allows one active run and synthesizes cancellation from the host signal', async () => {
    let releaseRecords!: () => void
    const recordsReleased = new Promise<void>((resolve) => {
      releaseRecords = resolve
    })
    let resolveCompletion!: (value: RuntimeProcessCompletion) => void
    const processCompletion = new Promise<RuntimeProcessCompletion>((resolve) => {
      resolveCompletion = resolve
    })
    const start = vi.fn((_spec, _prompt, options): RuntimeProcessRun => {
      options?.signal?.addEventListener('abort', () => {
        releaseRecords()
        resolveCompletion(completion({
          exitCode: null,
          signal: 'SIGINT',
          recordCount: 1,
          cancelled: true
        }))
      }, { once: true })
      return {
        records: {
          async *[Symbol.asyncIterator]() {
            yield { sequence: 1, raw: JSON.stringify({ type: 'thread.started', thread_id: 'thread-cancel' }) }
            await recordsReleased
          }
        },
        completion: processCompletion
      }
    }) satisfies RuntimeProcessRunner['start']
    const { service, scheduled } = scheduledService({ start })
    const updates: CodexMissionUpdate[] = []
    const first = await service.start('Wait safely.', (update) => updates.push(update))
    expect(first.ok).toBe(true)
    await expect(service.start('A second run.', () => undefined)).resolves.toMatchObject({
      ok: false,
      error: { code: 'RUN_ALREADY_ACTIVE' }
    })
    if (!first.ok) return

    scheduled[0]?.()
    expect(service.cancel(first.data.runId)).toEqual({
      ok: true,
      data: { runId: first.data.runId, state: 'cancellation-requested' }
    })
    await vi.waitFor(() => {
      expect(updates.some((update) => update.kind === 'event' && update.event.type === 'run.cancelled')).toBe(true)
    })
    expect(updates.some((update) => update.kind === 'event' && update.event.type === 'run.failed')).toBe(false)
  })

  it('never forwards process rejection details to the renderer', async () => {
    const secret = 'C:\\private\\token.txt sk-should-never-leak'
    const process: RuntimeProcessRun = {
      records: records([]),
      completion: Promise.reject(new Error(secret))
    }
    const { service, scheduled } = scheduledService({ start: () => process })
    const updates: CodexMissionUpdate[] = []
    await service.start('Safe prompt.', (update) => updates.push(update))
    scheduled[0]?.()

    await vi.waitFor(() => expect(updates).toHaveLength(1))
    expect(updates[0]).toMatchObject({
      kind: 'transport-error',
      error: { code: 'RUNTIME_TRANSPORT_FAILED' }
    })
    expect(JSON.stringify(updates)).not.toContain(secret)
    expect(JSON.stringify(updates)).not.toContain('private')
  })
})
