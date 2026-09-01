import type {
  RuntimeDiscovery,
  RuntimeJsonlRecord,
  RuntimeProcessCompletion,
  RuntimeProcessRun,
  RuntimeProcessRunner
} from '@teammate/runtime-adapters'
import type { MissionLedger } from '@teammate/mission-store'
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

function fakeLedger(overrides: Partial<MissionLedger> = {}): MissionLedger {
  return {
    createMission: async () => undefined,
    appendEvents: async () => undefined,
    appendHostFailure: async () => undefined,
    createCheckpoint: async () => { throw new Error('not used in this test') },
    getMission: async () => undefined,
    listMissions: async () => ({ missions: [], issues: [] }),
    flush: async () => undefined,
    ...overrides
  }
}

function scheduledService(runner: RuntimeProcessRunner, ledger = fakeLedger()) {
  const scheduled: Array<() => void> = []
  let nextId = 0
  const service = createCodexMissionService({
    workspacePath: WORKSPACE,
    discover: async () => [codexRuntime()],
    runner,
    ledger,
    createId: () => String(++nextId),
    now: () => new Date(NOW),
    schedule: (task) => scheduled.push(task)
  })
  return { service, scheduled, ledger }
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
    const createMission = vi.fn<MissionLedger['createMission']>(async () => undefined)
    const appendEvents = vi.fn<MissionLedger['appendEvents']>(async () => undefined)
    const { service, scheduled } = scheduledService({ start }, fakeLedger({
      createMission,
      appendEvents
    }))
    const updates: CodexMissionUpdate[] = []

    const response = await service.start('Inspect the workspace without changing it.', 'codex', 'ask', (update) => {
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
    expect(createMission).toHaveBeenCalledWith(expect.objectContaining({
      missionId: 'mission_2',
      runId: 'run_1',
      prompt: 'Inspect the workspace without changing it.',
      resolvedRouteId: 'codex-account:default'
    }))
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
    expect(appendEvents.mock.calls.flatMap(([, events]) => events).map(({ type }) => type)).toEqual([
      'run.started',
      'step.started',
      'message.delta',
      'step.completed',
      'run.completed'
    ])
  })

  it('rejects invalid prompts before discovery or process launch', async () => {
    const discover = vi.fn(async () => [codexRuntime()])
    const start = vi.fn() satisfies RuntimeProcessRunner['start']
    const service = createCodexMissionService({
      workspacePath: WORKSPACE,
      discover,
      runner: { start },
      ledger: fakeLedger()
    })

    await expect(service.start('   ', 'codex', 'ask', () => undefined)).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_PROMPT' }
    })
    expect(discover).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
  })

  it('never launches Codex when the durable mission header cannot be written', async () => {
    const start = vi.fn() satisfies RuntimeProcessRunner['start']
    const ledger = fakeLedger({
      createMission: async () => {
        throw new Error('private storage path')
      }
    })
    const { service } = scheduledService({ start }, ledger)

    await expect(service.start('Do safe work.', 'codex', 'ask', () => undefined)).resolves.toEqual({
      ok: false,
      error: {
        code: 'PERSISTENCE_FAILED',
        message: 'The mission could not be created in the durable local ledger.'
      }
    })
    expect(start).not.toHaveBeenCalled()
  })

  it('returns an actionable generic error when Codex is not ready', async () => {
    const start = vi.fn() satisfies RuntimeProcessRunner['start']
    const service = createCodexMissionService({
      workspacePath: WORKSPACE,
      discover: async () => [codexRuntime('authentication-required')],
      runner: { start },
      ledger: fakeLedger()
    })

    await expect(service.start('Do safe work.', 'codex', 'ask', () => undefined)).resolves.toEqual({
      ok: false,
      error: {
        code: 'CODEX_UNAVAILABLE',
        message: 'Codex CLI is not ready. Install or sign in to it, then retry discovery.'
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
      runner: { start },
      ledger: fakeLedger()
    })

    const response = service.start('Do safe work.', 'codex', 'ask', () => undefined)
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
    const first = await service.start('Wait safely.', 'codex', 'ask', (update) => updates.push(update))
    expect(first.ok).toBe(true)
    await expect(service.start('A second run.', 'codex', 'ask', () => undefined)).resolves.toMatchObject({
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
    await service.start('Safe prompt.', 'codex', 'ask', (update) => updates.push(update))
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

describe('Codex mission durability and lifecycle boundaries', () => {
  it('persists before emitting, aborts on a failed durable write, and frees the service afterwards', async () => {
    const timeline: string[] = []
    let aborted = false
    let resolveCompletion!: (value: RuntimeProcessCompletion) => void
    const processCompletion = new Promise<RuntimeProcessCompletion>((resolve) => {
      resolveCompletion = resolve
    })
    const start = vi.fn((_spec, _prompt, options): RuntimeProcessRun => {
      options?.signal?.addEventListener('abort', () => {
        aborted = true
        resolveCompletion(completion({ exitCode: null, signal: 'SIGINT', recordCount: 2, cancelled: true }))
      }, { once: true })
      return {
        records: records([
          { type: 'thread.started', thread_id: 'thread-durable' },
          { type: 'turn.started' },
          { type: 'item.completed', item: { id: 'answer', type: 'agent_message', text: 'never shown' } }
        ]),
        completion: processCompletion
      }
    }) satisfies RuntimeProcessRunner['start']
    let appendCalls = 0
    const ledger = fakeLedger({
      appendEvents: async (_missionId, events) => {
        appendCalls += 1
        if (appendCalls >= 2) throw new Error('disk full')
        timeline.push(`append:${events.map(({ type }) => type).join(',')}`)
      }
    })
    const { service, scheduled } = scheduledService({ start }, ledger)
    const updates: CodexMissionUpdate[] = []
    const response = await service.start('Persist safely.', 'codex', 'ask', (update) => {
      timeline.push(update.kind === 'event' ? `emit:${update.event.type}` : `emit:${update.kind}`)
      updates.push(update)
    })
    expect(response.ok).toBe(true)
    scheduled[0]?.()

    await vi.waitFor(() => {
      expect(updates.some((update) => update.kind === 'persistence-error')).toBe(true)
    })
    expect(aborted).toBe(true)
    expect(timeline).toEqual(['append:run.started', 'emit:run.started', 'emit:persistence-error'])
    expect(updates.filter((update) => update.kind === 'persistence-error')).toHaveLength(1)
    // The service is free again as soon as the renderer hears about the failure.
    await expect(service.start('Try again.', 'codex', 'ask', () => undefined)).resolves.toMatchObject({ ok: true })
  })

  it('records host launch failures durably and reports a persistence failure when even that write fails', async () => {
    const failingStart = vi.fn(() => {
      throw new Error('spawn blocked')
    }) satisfies RuntimeProcessRunner['start']
    const appendHostFailure = vi.fn<MissionLedger['appendHostFailure']>(async () => undefined)
    const { service } = scheduledService({ start: failingStart }, fakeLedger({ appendHostFailure }))
    await expect(service.start('Do safe work.', 'codex', 'ask', () => undefined)).resolves.toMatchObject({
      ok: false,
      error: { code: 'RUNTIME_START_FAILED' }
    })
    expect(appendHostFailure).toHaveBeenCalledWith('mission_2', expect.objectContaining({
      code: 'runtime-start-failed'
    }))

    const { service: doomed } = scheduledService({ start: failingStart }, fakeLedger({
      appendHostFailure: async () => {
        throw new Error('disk full')
      }
    }))
    await expect(doomed.start('Do safe work.', 'codex', 'ask', () => undefined)).resolves.toMatchObject({
      ok: false,
      error: { code: 'PERSISTENCE_FAILED' }
    })
  })

  it('persists a transport failure and downgrades to a persistence error when the write fails', async () => {
    const brokenProcess = (): RuntimeProcessRun => ({
      records: records([]),
      completion: Promise.reject(new Error('transport died'))
    })
    const appendHostFailure = vi.fn<MissionLedger['appendHostFailure']>(async () => undefined)
    const { service, scheduled } = scheduledService({ start: () => brokenProcess() }, fakeLedger({ appendHostFailure }))
    const updates: CodexMissionUpdate[] = []
    await service.start('Safe prompt.', 'codex', 'ask', (update) => updates.push(update))
    scheduled[0]?.()
    await vi.waitFor(() => expect(updates).toHaveLength(1))
    expect(updates[0]).toMatchObject({ kind: 'transport-error' })
    expect(appendHostFailure).toHaveBeenCalledWith('mission_2', expect.objectContaining({
      code: 'runtime-transport-failed'
    }))

    const { service: doomed, scheduled: doomedScheduled } = scheduledService({ start: () => brokenProcess() }, fakeLedger({
      appendHostFailure: async () => {
        throw new Error('disk full')
      }
    }))
    const doomedUpdates: CodexMissionUpdate[] = []
    await doomed.start('Safe prompt.', 'codex', 'ask', (update) => doomedUpdates.push(update))
    doomedScheduled[0]?.()
    await vi.waitFor(() => expect(doomedUpdates).toHaveLength(1))
    expect(doomedUpdates[0]).toMatchObject({ kind: 'persistence-error' })
  })

  it('rejects a second start while the first is still resolving discovery', async () => {
    let finishDiscovery!: (value: readonly RuntimeDiscovery[]) => void
    const discovery = new Promise<readonly RuntimeDiscovery[]>((resolve) => {
      finishDiscovery = resolve
    })
    const start = vi.fn((): RuntimeProcessRun => ({
      records: records([]),
      completion: Promise.resolve(completion())
    })) satisfies RuntimeProcessRunner['start']
    const service = createCodexMissionService({
      workspacePath: WORKSPACE,
      discover: () => discovery,
      runner: { start },
      ledger: fakeLedger(),
      schedule: () => undefined
    })

    const first = service.start('First mission.', 'codex', 'ask', () => undefined)
    await expect(service.start('Second mission.', 'codex', 'ask', () => undefined)).resolves.toMatchObject({
      ok: false,
      error: { code: 'RUN_ALREADY_ACTIVE' }
    })
    finishDiscovery([codexRuntime()])
    await expect(first).resolves.toMatchObject({ ok: true })
  })

  it('drains in-flight work on dispose, latches the service closed, and keeps interrupt reusable', async () => {
    let resolveCompletion!: (value: RuntimeProcessCompletion) => void
    const processCompletion = new Promise<RuntimeProcessCompletion>((resolve) => {
      resolveCompletion = resolve
    })
    const start = vi.fn((_spec, _prompt, options): RuntimeProcessRun => {
      options?.signal?.addEventListener('abort', () => {
        resolveCompletion(completion({ exitCode: null, signal: 'SIGINT', recordCount: 1, cancelled: true }))
      }, { once: true })
      return {
        records: {
          async *[Symbol.asyncIterator]() {
            yield { sequence: 1, raw: JSON.stringify({ type: 'thread.started', thread_id: 'thread-drain' }) }
            await processCompletion
          }
        },
        completion: processCompletion
      }
    }) satisfies RuntimeProcessRunner['start']
    const { service, scheduled } = scheduledService({ start })
    const updates: CodexMissionUpdate[] = []
    await service.start('Wait safely.', 'codex', 'ask', (update) => updates.push(update))
    scheduled[0]?.()

    await service.dispose()
    // dispose resolved only after consume settled, so the terminal receipt is already emitted.
    expect(updates.some((update) => update.kind === 'event' && update.event.type === 'run.cancelled')).toBe(true)
    await expect(service.start('After shutdown.', 'codex', 'ask', () => undefined)).resolves.toMatchObject({
      ok: false,
      error: { code: 'RUNTIME_START_FAILED' }
    })

    const { service: reusable } = scheduledService({
      start: () => ({ records: records([]), completion: Promise.resolve(completion()) })
    })
    reusable.interrupt()
    await expect(reusable.start('After interrupt.', 'codex', 'ask', () => undefined)).resolves.toMatchObject({ ok: true })
  })
  it('checkpoints the mission it cut short, after that run has finished settling', async () => {
    const calls: Array<[string, string]> = []
    const ledger = fakeLedger({
      createCheckpoint: async (missionId, reason) => {
        calls.push([missionId, reason])
        return { missionId } as never
      }
    })
    const start = vi.fn((_spec, _prompt, options): RuntimeProcessRun => {
      const signal = options?.signal
      return {
        records: records([{ type: 'thread.started', thread_id: 'thread-live' }]),
        completion: new Promise((resolve) => {
          signal?.addEventListener('abort', () => {
            resolve(completion({ cancelled: true }))
          })
        })
      }
    }) satisfies RuntimeProcessRunner['start']
    const { service, scheduled } = scheduledService({ start }, ledger)
    const updates: CodexMissionUpdate[] = []
    await service.start('Wait safely.', 'codex', 'ask', (update) => updates.push(update))
    scheduled[0]?.()

    // The real sequence: the window closes, the run settles and the service
    // forgets it, and only THEN does the app quit. Calling dispose() straight
    // after interrupt() leaves the mission still active, so dispose reads the
    // id itself and the test passes whether or not interrupt() recorded it --
    // which is exactly how this test first passed against a service that had
    // the line removed.
    service.interrupt()
    for (let tick = 0; tick < 20; tick += 1) {
      if (updates.some((update) => update.kind === 'event' && update.event.type === 'run.cancelled')) break
      await new Promise((resolve) => setImmediate(resolve))
    }
    expect(updates.some((update) => update.kind === 'event' && update.event.type === 'run.cancelled')).toBe(true)

    await service.dispose()

    expect(calls).toEqual([['mission_2', 'shutdown']])
  })

  it('does not checkpoint when no mission was running', async () => {
    const calls: string[] = []
    const ledger = fakeLedger({
      createCheckpoint: async (missionId) => {
        calls.push(missionId)
        return {} as never
      }
    })
    const { service } = scheduledService(
      { start: () => ({ records: records([]), completion: Promise.resolve(completion()) }) },
      ledger
    )

    await service.dispose()

    expect(calls).toEqual([])
  })

  it('still shuts down when the checkpoint write fails', async () => {
    const ledger = fakeLedger({
      createCheckpoint: async () => {
        throw new Error('disk full')
      }
    })
    const start = vi.fn((_spec, _prompt, options): RuntimeProcessRun => {
      const signal = options?.signal
      return {
        records: records([{ type: 'thread.started', thread_id: 'thread-live' }]),
        completion: new Promise((resolve) => {
          signal?.addEventListener('abort', () => {
            resolve(completion({ cancelled: true }))
          })
        })
      }
    }) satisfies RuntimeProcessRunner['start']
    const { service, scheduled } = scheduledService({ start }, ledger)
    await service.start('Wait safely.', 'codex', 'ask', () => undefined)
    scheduled[0]?.()
    service.interrupt()

    // A bookkeeping write must never be able to hang or crash shutdown.
    await expect(service.dispose()).resolves.toBeUndefined()
  })
})

describe('mission sandbox', () => {
  function specFor(mode: 'ask' | 'accept-edits') {
    const start = vi.fn((_spec, _prompt, _options): RuntimeProcessRun => ({
      records: records([{ type: 'thread.started', thread_id: 't' }]),
      completion: Promise.resolve(completion())
    })) satisfies RuntimeProcessRunner['start']
    return { start, service: scheduledService({ start }).service }
  }

  it('runs read-only when the mode is ask', async () => {
    const { start, service } = specFor('ask')
    await service.start('Look around.', 'codex', 'ask', () => undefined)
    expect(start.mock.calls[0]?.[0]?.args).toEqual(
      expect.arrayContaining(['--sandbox', 'read-only'])
    )
    expect(start.mock.calls[0]?.[0]?.args).not.toContain('workspace-write')
  })

  it('runs workspace-write only when edits were explicitly accepted', async () => {
    const { start, service } = specFor('accept-edits')
    const response = await service.start('Fix the typo.', 'codex', 'accept-edits', () => undefined)
    expect(start.mock.calls[0]?.[0]?.args).toEqual(
      expect.arrayContaining(['--sandbox', 'workspace-write'])
    )
    // What the run was allowed to do is reported back, so the UI states the
    // real posture rather than assuming one.
    expect(response).toMatchObject({ ok: true, data: { sandbox: 'workspace-write' } })
  })

  it('records the sandbox it actually used in the durable header', async () => {
    const createMission = vi.fn<MissionLedger['createMission']>(async () => undefined)
    const start = vi.fn((_spec, _prompt, _options): RuntimeProcessRun => ({
      records: records([]),
      completion: Promise.resolve(completion())
    })) satisfies RuntimeProcessRunner['start']
    const { service } = scheduledService({ start }, fakeLedger({ createMission }))

    await service.start('Fix the typo.', 'codex', 'accept-edits', () => undefined)

    expect(createMission).toHaveBeenCalledWith(
      expect.objectContaining({ sandbox: 'workspace-write' })
    )
  })

  it('never widens the sandbox for an unrecognized mode', async () => {
    const start = vi.fn((_spec, _prompt, _options): RuntimeProcessRun => ({
      records: records([]),
      completion: Promise.resolve(completion())
    })) satisfies RuntimeProcessRunner['start']
    const { service } = scheduledService({ start })

    // The IPC layer normalizes this, but the service must not depend on that:
    // a mode it does not recognise is read-only, never write.
    await service.start('Do something.', 'codex', 'whatever' as never, () => undefined)

    expect(start.mock.calls[0]?.[0]?.args).toEqual(expect.arrayContaining(['--sandbox', 'read-only']))
  })
})

describe('runtime selection', () => {
  function claudeRuntime(): RuntimeDiscovery {
    return {
      ...codexRuntime(),
      id: 'claude',
      displayName: 'Claude Code',
      executable: {
        commandName: 'claude',
        discoveredPath: process.platform === 'win32' ? 'C:\tools\claude.exe' : '/tools/claude',
        executablePath: process.platform === 'win32' ? 'C:\tools\claude.exe' : '/tools/claude',
        prefixArgs: [],
        kind: 'native'
      }
    }
  }

  function serviceWith(runtimes: RuntimeDiscovery[], ledger = fakeLedger()) {
    const start = vi.fn((_spec, _prompt, _options): RuntimeProcessRun => ({
      records: records([]),
      completion: Promise.resolve(completion())
    })) satisfies RuntimeProcessRunner['start']
    const service = createCodexMissionService({
      workspacePath: WORKSPACE,
      discover: async () => runtimes,
      runner: { start },
      ledger,
      createId: (() => { let n = 0; return () => String(++n) })(),
      now: () => new Date(NOW),
      schedule: () => undefined
    })
    return { start, service }
  }

  it('launches Claude with its own restricted argv when Claude is chosen', async () => {
    const { start, service } = serviceWith([codexRuntime(), claudeRuntime()])

    const response = await service.start('Summarize this repo.', 'claude', 'ask', () => undefined)

    expect(response).toMatchObject({ ok: true, data: { runtime: 'claude' } })
    const args = start.mock.calls[0]?.[0]?.args ?? []
    expect(start.mock.calls[0]?.[0]?.runtime).toBe('claude')
    expect(args).toEqual(expect.arrayContaining(['--print', '--output-format', 'stream-json']))
    // Claude's command takes no sandbox flag; the Codex one must not leak in.
    expect(args).not.toContain('--sandbox')
  })

  it('reports a Claude run as read-only even when edits were requested', async () => {
    // Only Codex takes a sandbox flag today, so accept-edits cannot widen a
    // Claude run -- and the receipt must say what actually happened.
    const createMission = vi.fn<MissionLedger['createMission']>(async () => undefined)
    const { service } = serviceWith([codexRuntime(), claudeRuntime()], fakeLedger({ createMission }))

    const response = await service.start('Edit something.', 'claude', 'accept-edits', () => undefined)

    expect(response).toMatchObject({ ok: true, data: { sandbox: 'read-only' } })
    expect(createMission).toHaveBeenCalledWith(expect.objectContaining({
      runtime: 'claude',
      sandbox: 'read-only'
    }))
  })

  it('names the runtime the user actually chose when it is unavailable', async () => {
    const { service } = serviceWith([codexRuntime()])

    await expect(service.start('Do work.', 'claude', 'ask', () => undefined)).resolves.toMatchObject({
      ok: false,
      error: { code: 'CODEX_UNAVAILABLE', message: expect.stringContaining('Claude Code') }
    })
  })
})
