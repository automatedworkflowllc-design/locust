import type {
  RuntimeDiscovery,
  RuntimeJsonlRecord,
  RuntimeProcessRecordStream,
  RuntimeProcessCompletion,
  RuntimeProcessRun,
  RuntimeProcessRunner
} from '@teammate/runtime-adapters'
import type { MissionLedger, MissionPeerLink, Workroom, WorkroomMessage } from '@teammate/mission-store'
import { describe, expect, it, vi } from 'vitest'
import type { CodexMissionUpdate } from '../shared/ipc.js'
import { createCodexMissionService } from './codex-mission.js'
import type { MissionPeerContext } from './workroom-briefing.js'

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

function records(values: readonly Record<string, unknown>[]): RuntimeProcessRecordStream {
  return {
    async *[Symbol.asyncIterator]() {
      for (const [index, value] of values.entries()) {
        yield { sequence: index + 1, raw: JSON.stringify(value) }
      }
    },
    // Nothing is buffered ahead in this fake, so the consumer's batching path
    // degrades to one record per append -- which is what the ordering tests
    // below want to observe.
    drainAvailable: () => []
  }
}

/**
 * A stream that hands over the first record and reports the rest as already
 * buffered, the way a real burst arrives while the consumer is awaiting a
 * durable write.
 */
function burst(values: readonly Record<string, unknown>[]): RuntimeProcessRecordStream {
  const all = values.map((value, index) => ({ sequence: index + 1, raw: JSON.stringify(value) }))
  const buffered = all.slice(1)
  return {
    async *[Symbol.asyncIterator]() {
      yield all[0]!
    },
    drainAvailable: () => buffered.splice(0)
  }
}

function fakeLedger(overrides: Partial<MissionLedger> = {}): MissionLedger {
  return {
    createMission: async () => undefined,
    appendEvents: async () => undefined,
    appendHostFailure: async () => undefined,
    createCheckpoint: async () => { throw new Error('not used in this test') },
    appendPeerLinks: async () => undefined,
    deleteMission: async () => true,
    storageReport: async () => ({ missionCount: 0, byteTotal: 0, unreadableCount: 0 }),
    pruneMissions: async () => ({ deleted: [], failed: [], unreadable: [], keptForContinuity: [], keptAsRunning: [] }),
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

    const response = await service.start('Inspect the workspace without changing it.', 'codex', 'ask', {}, (update) => {
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

    await expect(service.start('   ', 'codex', 'ask', {}, () => undefined)).resolves.toMatchObject({
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

    await expect(service.start('Do safe work.', 'codex', 'ask', {}, () => undefined)).resolves.toEqual({
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

    await expect(service.start('Do safe work.', 'codex', 'ask', {}, () => undefined)).resolves.toEqual({
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

    const response = service.start('Do safe work.', 'codex', 'ask', {}, () => undefined)
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
          ,
          drainAvailable: () => []
        },
        completion: processCompletion
      }
    }) satisfies RuntimeProcessRunner['start']
    const { service, scheduled } = scheduledService({ start })
    const updates: CodexMissionUpdate[] = []
    const first = await service.start('Wait safely.', 'codex', 'ask', {}, (update) => updates.push(update))
    expect(first.ok).toBe(true)
    await expect(service.start('A second run.', 'codex', 'ask', {}, () => undefined)).resolves.toMatchObject({
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
    await service.start('Safe prompt.', 'codex', 'ask', {}, (update) => updates.push(update))
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
    const response = await service.start('Persist safely.', 'codex', 'ask', {}, (update) => {
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
    await expect(service.start('Try again.', 'codex', 'ask', {}, () => undefined)).resolves.toMatchObject({ ok: true })
  })

  it('records host launch failures durably and reports a persistence failure when even that write fails', async () => {
    const failingStart = vi.fn(() => {
      throw new Error('spawn blocked')
    }) satisfies RuntimeProcessRunner['start']
    const appendHostFailure = vi.fn<MissionLedger['appendHostFailure']>(async () => undefined)
    const { service } = scheduledService({ start: failingStart }, fakeLedger({ appendHostFailure }))
    await expect(service.start('Do safe work.', 'codex', 'ask', {}, () => undefined)).resolves.toMatchObject({
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
    await expect(doomed.start('Do safe work.', 'codex', 'ask', {}, () => undefined)).resolves.toMatchObject({
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
    await service.start('Safe prompt.', 'codex', 'ask', {}, (update) => updates.push(update))
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
    await doomed.start('Safe prompt.', 'codex', 'ask', {}, (update) => doomedUpdates.push(update))
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

    const first = service.start('First mission.', 'codex', 'ask', {}, () => undefined)
    await expect(service.start('Second mission.', 'codex', 'ask', {}, () => undefined)).resolves.toMatchObject({
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
          ,
          drainAvailable: () => []
        },
        completion: processCompletion
      }
    }) satisfies RuntimeProcessRunner['start']
    const { service, scheduled } = scheduledService({ start })
    const updates: CodexMissionUpdate[] = []
    await service.start('Wait safely.', 'codex', 'ask', {}, (update) => updates.push(update))
    scheduled[0]?.()

    await service.dispose()
    // dispose resolved only after consume settled, so the terminal receipt is already emitted.
    expect(updates.some((update) => update.kind === 'event' && update.event.type === 'run.cancelled')).toBe(true)
    await expect(service.start('After shutdown.', 'codex', 'ask', {}, () => undefined)).resolves.toMatchObject({
      ok: false,
      error: { code: 'RUNTIME_START_FAILED' }
    })

    const { service: reusable } = scheduledService({
      start: () => ({ records: records([]), completion: Promise.resolve(completion()) })
    })
    reusable.interrupt()
    await expect(reusable.start('After interrupt.', 'codex', 'ask', {}, () => undefined)).resolves.toMatchObject({ ok: true })
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
    await service.start('Wait safely.', 'codex', 'ask', {}, (update) => updates.push(update))
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
    await service.start('Wait safely.', 'codex', 'ask', {}, () => undefined)
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
    await service.start('Look around.', 'codex', 'ask', {}, () => undefined)
    expect(start.mock.calls[0]?.[0]?.args).toEqual(
      expect.arrayContaining(['--sandbox', 'read-only'])
    )
    expect(start.mock.calls[0]?.[0]?.args).not.toContain('workspace-write')
  })

  it('runs workspace-write only when edits were explicitly accepted', async () => {
    const { start, service } = specFor('accept-edits')
    const response = await service.start('Fix the typo.', 'codex', 'accept-edits', {}, () => undefined)
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

    await service.start('Fix the typo.', 'codex', 'accept-edits', {}, () => undefined)

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
    await service.start('Do something.', 'codex', 'whatever' as never, {}, () => undefined)

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

    const response = await service.start('Summarize this repo.', 'claude', 'ask', {}, () => undefined)

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

    const response = await service.start('Edit something.', 'claude', 'accept-edits', {}, () => undefined)

    expect(response).toMatchObject({ ok: true, data: { sandbox: 'read-only' } })
    expect(createMission).toHaveBeenCalledWith(expect.objectContaining({
      runtime: 'claude',
      sandbox: 'read-only'
    }))
  })

  it('refuses a runtime whose event stream it cannot read yet, by name, recording nothing', async () => {
    const createMission = vi.fn(async () => undefined)
    const { service, start } = serviceWith(
      [{ ...codexRuntime(), id: 'gemini', displayName: 'Gemini CLI', optional: true }],
      fakeLedger({ createMission })
    )

    await expect(service.start('Do work.', 'gemini', 'ask', {}, () => undefined)).resolves.toMatchObject({
      ok: false,
      error: { code: 'RUNTIME_START_FAILED', message: expect.stringContaining('Gemini CLI') }
    })
    expect(start).not.toHaveBeenCalled()
    expect(createMission).not.toHaveBeenCalled()
  })

  it('runs a Cursor mission under its own command and its own normalizer', async () => {
    // Two records as Cursor prints them, so the normalizer's signature on the
    // events is the fact under test -- a Codex normalizer would sign them as
    // Codex, or read nothing it recognises.
    const start = vi.fn((_spec, _prompt, _options): RuntimeProcessRun => ({
      records: records([
        { type: 'system', subtype: 'init', session_id: 'cursor-session-1', model: 'Composer 2.5', permissionMode: 'default' },
        { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'pebble' }] } },
        { type: 'result', subtype: 'success', is_error: false, result: 'pebble' }
      ]),
      completion: Promise.resolve(completion())
    })) satisfies RuntimeProcessRunner['start']
    const createMission = vi.fn<MissionLedger['createMission']>(async () => undefined)
    const appendEvents = vi.fn<MissionLedger['appendEvents']>(async () => undefined)
    const cursor = { ...codexRuntime(), id: 'cursor' as const, displayName: 'Cursor Agent', optional: true }
    const service = createCodexMissionService({
      workspacePath: WORKSPACE,
      // Where Cursor's sandbox exists, so a read-only mission is allowed to
      // start; the refusal on other platforms has its own test.
      platform: 'darwin',
      discover: async () => [cursor],
      runner: { start },
      ledger: fakeLedger({ createMission, appendEvents }),
      createId: (() => { let n = 0; return () => String(++n) })(),
      now: () => new Date(NOW),
      schedule: (task) => scheduledTasks.push(task)
    })
    const scheduledTasks: Array<() => void> = []
    const updates: CodexMissionUpdate[] = []

    const response = await service.start('Do work.', 'cursor', 'ask', {}, (update) => {
      updates.push(update)
    })
    expect(response).toMatchObject({ ok: true, data: { runtime: 'cursor', sandbox: 'read-only' } })
    const spec = start.mock.calls[0]?.[0]
    expect(spec?.runtime).toBe('cursor')
    expect(spec?.args).toEqual(expect.arrayContaining(['--print', '--trust', '--mode', 'plan', '--sandbox', 'enabled']))
    expect(spec?.args).not.toContain('--force')
    expect(createMission).toHaveBeenCalledWith(expect.objectContaining({ runtime: 'cursor' }))

    scheduledTasks[0]?.()
    await vi.waitFor(() => {
      expect(updates.some((update) => update.kind === 'event' && update.event.type === 'run.completed')).toBe(true)
    })
    const recorded = appendEvents.mock.calls.flatMap(([, events]) => events)
    expect(recorded.map(({ type }) => type)).toEqual(['run.started', 'message.delta', 'run.completed'])
    expect(recorded.every((event) => event.sourceAdapter === 'cursor')).toBe(true)
    expect(recorded[0]?.runtimeThreadId).toBe('cursor-session-1')
  })

  it('lets a Cursor mission edit when asked, and never forces its commands', async () => {
    const { service, start } = serviceWith([{ ...codexRuntime(), id: 'cursor', displayName: 'Cursor Agent', optional: true }])
    await service.start('Do work.', 'cursor', 'accept-edits', {}, () => undefined)
    const spec = start.mock.calls[0]?.[0]
    expect(spec?.args).not.toContain('--mode')
    expect(spec?.args).not.toContain('--force')
  })

  it('records nothing when the chosen options cannot be turned into a command', async () => {
    // Cursor takes no effort level, so the builder refuses this argv. The
    // mission file used to be written first, leaving a permanent record of a
    // run that never existed -- and nothing created today can be pruned
    // today, so it could not be cleared either.
    const createMission = vi.fn<MissionLedger['createMission']>(async () => undefined)
    const appendHostFailure = vi.fn<MissionLedger['appendHostFailure']>(async () => undefined)
    const start = vi.fn() satisfies RuntimeProcessRunner['start']
    const service = createCodexMissionService({
      workspacePath: WORKSPACE,
      platform: 'darwin',
      discover: async () => [{ ...codexRuntime(), id: 'cursor', displayName: 'Cursor Agent', optional: true }],
      runner: { start },
      ledger: fakeLedger({ createMission, appendHostFailure })
    })

    await expect(
      service.start('Do work.', 'cursor', 'ask', { effort: 'high' }, () => undefined)
    ).resolves.toMatchObject({ ok: false, error: { code: 'RUNTIME_START_FAILED' } })
    expect(start).not.toHaveBeenCalled()
    expect(createMission).not.toHaveBeenCalled()
    expect(appendHostFailure).not.toHaveBeenCalled()
  })

  it('refuses a read-only Cursor mission where its sandbox cannot run, rather than mislabelling it', async () => {
    // Measured 2026-09-02 on Windows: `--mode plan` did not stop a Cursor run
    // from creating files, and `--sandbox enabled` is refused outright there.
    // Recording such a run as read-only would be a claim nothing upholds.
    const createMission = vi.fn<MissionLedger['createMission']>(async () => undefined)
    const start = vi.fn() satisfies RuntimeProcessRunner['start']
    const service = createCodexMissionService({
      workspacePath: WORKSPACE,
      platform: 'win32',
      discover: async () => [{ ...codexRuntime(), id: 'cursor', displayName: 'Cursor Agent', optional: true }],
      runner: { start },
      ledger: fakeLedger({ createMission })
    })

    await expect(service.start('Do work.', 'cursor', 'ask', {}, () => undefined)).resolves.toMatchObject({
      ok: false,
      error: { code: 'RUNTIME_START_FAILED', message: expect.stringContaining('read-only') }
    })
    expect(start).not.toHaveBeenCalled()
    expect(createMission).not.toHaveBeenCalled()
  })

  it('runs a read-only Cursor mission where the sandbox is real, and asks for it', async () => {
    const start = vi.fn((_spec, _prompt, _options): RuntimeProcessRun => ({
      records: records([]),
      completion: Promise.resolve(completion())
    })) satisfies RuntimeProcessRunner['start']
    const service = createCodexMissionService({
      workspacePath: WORKSPACE,
      platform: 'darwin',
      discover: async () => [{ ...codexRuntime(), id: 'cursor', displayName: 'Cursor Agent', optional: true }],
      runner: { start },
      ledger: fakeLedger(),
      createId: (() => { let n = 0; return () => String(++n) })(),
      now: () => new Date(NOW),
      schedule: () => undefined
    })

    await expect(service.start('Do work.', 'cursor', 'ask', {}, () => undefined)).resolves.toMatchObject({ ok: true })
    expect(start.mock.calls[0]?.[0]?.args).toEqual(expect.arrayContaining(['--mode', 'plan', '--sandbox', 'enabled']))
  })

  it('names the runtime the user actually chose when it is unavailable', async () => {
    const { service } = serviceWith([codexRuntime()])

    await expect(service.start('Do work.', 'claude', 'ask', {}, () => undefined)).resolves.toMatchObject({
      ok: false,
      error: { code: 'CODEX_UNAVAILABLE', message: expect.stringContaining('Claude Code') }
    })
  })
})

describe('durable write batching', () => {
  it('collapses a burst of records into one durable append', async () => {
    // Each append costs an fsync. Paying it per provider record lets the
    // runner's bounded queue fill while the consumer waits, and a full queue
    // ends the run as an output-limit breach -- a verbose mission killed for
    // being verbose.
    const appendEvents = vi.fn<MissionLedger['appendEvents']>(async () => undefined)
    const start = vi.fn((_spec, _prompt, _options): RuntimeProcessRun => ({
      records: burst([
        { type: 'thread.started', thread_id: 'thread-live' },
        { type: 'turn.started' },
        { type: 'item.completed', item: { id: 'a', type: 'agent_message', text: 'one' } },
        { type: 'turn.completed' }
      ]),
      completion: Promise.resolve(completion())
    })) satisfies RuntimeProcessRunner['start']
    const { service, scheduled } = scheduledService({ start }, fakeLedger({ appendEvents }))

    await service.start('Do work.', 'codex', 'ask', {}, () => undefined)
    scheduled[0]?.()
    await vi.waitFor(() => {
      expect(appendEvents.mock.calls.length).toBeGreaterThan(0)
    })

    // Four provider records, ONE durable append for the burst -- then a second
    // for the terminal event that finish() produces.
    expect(appendEvents.mock.calls[0]?.[1].map((event) => event.type)).toEqual([
      'run.started',
      'step.started',
      'message.delta',
      'step.completed'
    ])
    await vi.waitFor(() => {
      expect(appendEvents.mock.calls).toHaveLength(2)
    })
    expect(appendEvents.mock.calls[1]?.[1].map((event) => event.type)).toEqual(['run.completed'])
  })

  it('still persists every event before any of them is emitted', async () => {
    const order: string[] = []
    const appendEvents = vi.fn<MissionLedger['appendEvents']>(async (_id, events) => {
      order.push(`persist:${events.length}`)
    })
    const start = vi.fn((_spec, _prompt, _options): RuntimeProcessRun => ({
      records: burst([
        { type: 'thread.started', thread_id: 't' },
        { type: 'item.completed', item: { id: 'a', type: 'agent_message', text: 'one' } }
      ]),
      completion: Promise.resolve(completion())
    })) satisfies RuntimeProcessRunner['start']
    const { service, scheduled } = scheduledService({ start }, fakeLedger({ appendEvents }))

    await service.start('Do work.', 'codex', 'ask', {}, (update) => {
      if (update.kind === 'event') order.push('emit')
    })
    scheduled[0]?.()
    await vi.waitFor(() => {
      expect(order).toContain('emit')
    })

    // Batching must not reorder the guarantee: the write lands first.
    expect(order[0]).toMatch(/^persist:/)
  })
})

describe('model selection', () => {
  function harness() {
    const start = vi.fn((_spec, _prompt, _options): RuntimeProcessRun => ({
      records: records([]),
      completion: Promise.resolve(completion())
    })) satisfies RuntimeProcessRunner['start']
    const createMission = vi.fn<MissionLedger['createMission']>(async () => undefined)
    const { service } = scheduledService({ start }, fakeLedger({ createMission }))
    return { start, createMission, service }
  }

  it('sends a chosen model to the runtime and records it', async () => {
    const { start, createMission, service } = harness()
    const response = await service.start('Do work.', 'codex', 'ask', { model: 'gpt-5.6-luna' }, () => undefined)

    expect(start.mock.calls[0]?.[0]?.args).toEqual(expect.arrayContaining(['--model', 'gpt-5.6-luna']))
    expect(createMission).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-5.6-luna' }))
    expect(response).toMatchObject({ ok: true, data: { model: 'gpt-5.6-luna' } })
  })

  it('treats account-default as "send no model", not as a model id', async () => {
    // It is the shell's word for the absence of a choice. Passing it through
    // would make the CLI look for a model that does not exist.
    const { start, createMission, service } = harness()
    await service.start('Do work.', 'codex', 'ask', { model: 'account-default' }, () => undefined)

    expect(start.mock.calls[0]?.[0]?.args).not.toContain('--model')
    expect(createMission).toHaveBeenCalledWith(expect.objectContaining({ model: 'account-default' }))
  })

  it('sends no model when none was chosen', async () => {
    const { start, service } = harness()
    await service.start('Do work.', 'codex', 'ask', {}, () => undefined)
    expect(start.mock.calls[0]?.[0]?.args).not.toContain('--model')
  })
})

describe('mid-mission handoff', () => {
  function checkpoint(overrides: Record<string, unknown> = {}) {
    return {
      schemaVersion: 1,
      missionId: 'mission_2',
      runId: 'run_1',
      epoch: 3,
      reason: 'route-switch',
      reconciledThroughSequence: 9,
      settledActions: [],
      unsettledActions: [],
      resumeSafety: 'safe',
      safetyReason: 'Nothing was in flight.',
      transcriptDigest: 'digest',
      assistantSummary: 'Renamed the parser module.',
      createdAt: NOW,
      ...overrides
    } as Awaited<ReturnType<MissionLedger['createCheckpoint']>>
  }

  function handoffClaudeRuntime(): RuntimeDiscovery {
    return {
      ...codexRuntime(),
      id: 'claude',
      displayName: 'Claude Code',
      executable: {
        commandName: 'claude',
        discoveredPath: process.platform === 'win32' ? 'C:\\tools\\claude.exe' : '/tools/claude',
        executablePath: process.platform === 'win32' ? 'C:\\tools\\claude.exe' : '/tools/claude',
        prefixArgs: [],
        kind: 'native'
      }
    }
  }

  function liveService(
    ledger: MissionLedger,
    runtimes: RuntimeDiscovery[] = [codexRuntime(), handoffClaudeRuntime()]
  ) {
    const start = vi.fn((_spec, _prompt, _options): RuntimeProcessRun => ({
      records: records([{ type: 'turn.completed', usage: { output_tokens: 1 } }]),
      completion: Promise.resolve(completion())
    })) satisfies RuntimeProcessRunner['start']
    const service = createCodexMissionService({
      workspacePath: WORKSPACE,
      discover: async () => runtimes,
      runner: { start },
      ledger,
      createId: (() => { let n = 0; return () => String(++n) })(),
      now: () => new Date(NOW),
      schedule: (task) => { setImmediate(task) }
    })
    return { start, service }
  }

  it('starts a NEW mission that records what it continues from', async () => {
    const createMission = vi.fn<MissionLedger['createMission']>(async () => undefined)
    const createCheckpoint = vi.fn<MissionLedger['createCheckpoint']>(async () => checkpoint())
    const { service, start } = liveService(fakeLedger({ createMission, createCheckpoint }))

    await service.start('Refactor the parser.', 'codex', 'ask', {}, () => undefined)
    const response = await service.handOff('run_1', 'claude', 'ask', {}, () => undefined)

    expect(response).toMatchObject({
      ok: true,
      data: {
        runtime: 'claude',
        continuesFrom: { missionId: 'mission_2', checkpointEpoch: 3 },
        resumeSafety: 'safe'
      }
    })
    // A mission records ONE runtime, so the continuation is a separate mission
    // pointing back at the checkpoint -- not the first mission mutated.
    expect(createMission).toHaveBeenCalledTimes(2)
    expect(createMission.mock.calls[1]?.[0]).toMatchObject({
      runtime: 'claude',
      continuesFrom: { missionId: 'mission_2', checkpointEpoch: 3, reason: 'route-switch' }
    })
    expect(createMission.mock.calls[0]?.[0].continuesFrom).toBeUndefined()
    // The new runtime is launched with the briefing, not the bare original.
    expect(start.mock.calls[1]?.[1]).toContain('Refactor the parser.')
    expect(start.mock.calls[1]?.[1]).toContain('Renamed the parser module.')
  })

  it('reconciles only after the stopped run has settled', async () => {
    const order: string[] = []
    const createCheckpoint = vi.fn<MissionLedger['createCheckpoint']>(async () => {
      order.push('checkpoint')
      return checkpoint()
    })
    const appendEvents = vi.fn<MissionLedger['appendEvents']>(async () => {
      order.push('append')
    })
    const { service } = liveService(fakeLedger({ createCheckpoint, appendEvents }))

    await service.start('Refactor the parser.', 'codex', 'ask', {}, () => undefined)
    await service.handOff('run_1', 'claude', 'ask', {}, () => undefined)

    // Checkpointing a still-draining mission would report actions as unsettled
    // that were about to report back, and the briefing would then tell the next
    // runtime to re-verify work that had already finished.
    expect(order.indexOf('append')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('checkpoint')).toBeGreaterThan(order.indexOf('append'))
  })

  it('refuses a handoff to the runtime already running it, without stopping anything', async () => {
    const createCheckpoint = vi.fn<MissionLedger['createCheckpoint']>(async () => checkpoint())
    const { service } = liveService(fakeLedger({ createCheckpoint }))

    await service.start('Refactor the parser.', 'codex', 'ask', {}, () => undefined)
    const response = await service.handOff('run_1', 'codex', 'ask', {}, () => undefined)

    expect(response).toMatchObject({ ok: false, error: { code: 'HANDOFF_REFUSED' } })
    expect(response.ok === false && response.error.message).toContain('Nothing was changed')
    // Stopping a run to restart it on the same route costs progress and buys
    // nothing, so the run must still be running.
    expect(createCheckpoint).not.toHaveBeenCalled()
  })

  it('refuses when the ledger cannot be reconciled, and says the run is stopped', async () => {
    const createCheckpoint = vi.fn<MissionLedger['createCheckpoint']>(async () =>
      checkpoint({ resumeSafety: 'unsafe', safetyReason: 'The ledger stops at sequence 4.' })
    )
    const { service } = liveService(fakeLedger({ createCheckpoint }))

    await service.start('Refactor the parser.', 'codex', 'ask', {}, () => undefined)
    const response = await service.handOff('run_1', 'claude', 'ask', {}, () => undefined)

    expect(response).toMatchObject({ ok: false, error: { code: 'HANDOFF_REFUSED' } })
    // The stop is real and cannot be undone, so the message must not imply the
    // mission is still running.
    expect(response.ok === false && response.error.message).toContain('was stopped')
    expect(response.ok === false && response.error.message).toContain('The ledger stops at sequence 4.')
  })

  it('says both things when the stop worked and the new run did not start', async () => {
    const createCheckpoint = vi.fn<MissionLedger['createCheckpoint']>(async () => checkpoint())
    // Claude is discovered but signed out, so the continuation cannot launch.
    const notReady: RuntimeDiscovery = { ...handoffClaudeRuntime(), readiness: 'authentication-required' }
    const { service } = liveService(fakeLedger({ createCheckpoint }), [codexRuntime(), notReady])

    await service.start('Refactor the parser.', 'codex', 'ask', {}, () => undefined)
    const response = await service.handOff('run_1', 'claude', 'ask', {}, () => undefined)

    expect(response.ok).toBe(false)
    expect(response.ok === false && response.error.message).toContain('was stopped for the handoff')
    expect(response.ok === false && response.error.message).toContain('not ready')
  })

  it('refuses when there is no active run to hand off', async () => {
    const { service } = liveService(fakeLedger())

    const response = await service.handOff('run_nope', 'claude', 'ask', {}, () => undefined)

    expect(response).toMatchObject({ ok: false, error: { code: 'RUN_NOT_ACTIVE' } })
  })
})

describe('the workroom around a mission', () => {
  const WREN = { teammateId: 'tm_wren', name: 'Wren', role: 'Code & Migrations' }
  const ATLAS = { teammateId: 'tm_atlas', name: 'Atlas', role: 'Research & Briefs' }
  const PEER: MissionPeerContext = { self: WREN, others: [ATLAS] }

  function waiting(text: string, messageId = 'wm_1'): WorkroomMessage {
    return {
      messageId,
      sequence: 1,
      from: { teammateId: 'tm_atlas', name: 'Atlas', missionId: 'mission_a' },
      to: { teammateId: 'tm_wren', name: 'Wren' },
      text,
      postedAt: NOW
    }
  }

  function fakeWorkroom(overrides: Partial<Workroom> = {}) {
    const posted: { from: unknown; to: unknown; text: string }[] = []
    const delivered: { messageIds: readonly string[]; missionId: string }[] = []
    let nextId = 0
    const workroom: Workroom = {
      post: async (input) => {
        posted.push(input)
        return {
          messageId: `wm_out_${++nextId}`,
          sequence: nextId,
          from: input.from,
          to: input.to,
          text: input.text,
          postedAt: NOW
        }
      },
      unread: async () => ({ messages: [], remaining: 0 }),
      markDelivered: async (messageIds, missionId) => {
        delivered.push({ messageIds, missionId })
      },
      read: async () => ({ messages: [], deliveries: [], issues: [] }),
      flush: async () => undefined,
      ...overrides
    }
    return { workroom, posted, delivered }
  }

  function transcript(finalText: string): RuntimeProcessRun {
    return {
      records: records([
        { type: 'thread.started', thread_id: 'thread-live' },
        { type: 'turn.started' },
        { type: 'item.completed', item: { id: 'answer', type: 'agent_message', text: finalText } },
        { type: 'turn.completed', usage: { output_tokens: 2 } }
      ]),
      completion: Promise.resolve(completion())
    }
  }

  function peerService(input: {
    readonly run: RuntimeProcessRun
    readonly workroom: Workroom
    readonly ledger?: Partial<MissionLedger>
  }) {
    const start = vi.fn((_spec, _prompt, _options): RuntimeProcessRun => input.run)
    const links: { missionId: string; links: readonly MissionPeerLink[] }[] = []
    const ledger = fakeLedger({
      appendPeerLinks: async (missionId, appended) => {
        links.push({ missionId, links: appended })
      },
      ...input.ledger
    })
    const scheduled: Array<() => void> = []
    let nextId = 0
    const service = createCodexMissionService({
      workspacePath: WORKSPACE,
      discover: async () => [codexRuntime()],
      runner: { start },
      ledger,
      workroom: input.workroom,
      createId: () => String(++nextId),
      now: () => new Date(NOW),
      schedule: (task) => scheduled.push(task)
    })
    return { service, start, links, scheduled }
  }

  async function drain(scheduled: Array<() => void>): Promise<void> {
    while (scheduled.length > 0) scheduled.shift()!()
    // The consume loop awaits several durable writes; let them all settle.
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve))
  }

  it('quotes a waiting message into the prompt as a claim, records it, and marks it delivered only once the run is live', async () => {
    const { workroom, delivered } = fakeWorkroom({
      unread: async (teammateId) =>
        teammateId === 'tm_wren' ? { messages: [waiting('pnpm check runs everything.')], remaining: 0 } : { messages: [], remaining: 0 }
    })
    const { service, start, links } = peerService({ run: transcript('Done.'), workroom })

    const response = await service.start('Which command runs the checks?', 'codex', 'ask', {}, () => undefined, undefined, PEER)

    expect(response.ok).toBe(true)
    if (!response.ok) return
    const sentPrompt = start.mock.calls[0]?.[1] as string
    expect(sentPrompt.startsWith('Which command runs the checks?')).toBe(true)
    expect(sentPrompt).toContain('CLAIMS from other agents')
    expect(sentPrompt).toContain('pnpm check runs everything.')
    expect(sentPrompt).toContain('<locust-share to="Atlas">')
    expect(links).toEqual([
      {
        missionId: 'mission_2',
        links: [{ direction: 'received', messageId: 'wm_1', peerTeammateId: 'tm_atlas', occurredAt: NOW }]
      }
    ])
    expect(delivered).toEqual([{ messageIds: ['wm_1'], missionId: 'mission_2' }])
    expect(response.data.peerMessages).toEqual([
      {
        messageId: 'wm_1',
        direction: 'received',
        from: { teammateId: 'tm_atlas', name: 'Atlas' },
        to: { teammateId: 'tm_wren', name: 'Wren' },
        text: 'pnpm check runs everything.',
        at: NOW
      }
    ])
    expect(response.data.peerDeliveryFailed).toBe(false)
  })

  it('keeps the person\'s own words as the recorded prompt, not the briefing', async () => {
    const { workroom } = fakeWorkroom()
    const createMission = vi.fn<MissionLedger['createMission']>(async () => undefined)
    const { service } = peerService({ run: transcript('Done.'), workroom, ledger: { createMission } })

    await service.start('Look around.', 'codex', 'ask', {}, () => undefined, undefined, PEER)

    expect(createMission.mock.calls[0]?.[0]?.prompt).toBe('Look around.')
  })

  it('refuses to run on messages the ledger cannot record, and says so', async () => {
    const { workroom, delivered } = fakeWorkroom({
      unread: async () => ({ messages: [waiting('claim')], remaining: 0 })
    })
    const { service, start } = peerService({
      run: transcript('Done.'),
      workroom,
      ledger: { appendPeerLinks: async () => { throw new Error('disk full') } }
    })

    const response = await service.start('Task.', 'codex', 'ask', {}, () => undefined, undefined, PEER)

    expect(response).toEqual({
      ok: false,
      error: {
        code: 'PERSISTENCE_FAILED',
        message: 'The messages this mission was shown could not be recorded in the durable local ledger.'
      }
    })
    expect(start).not.toHaveBeenCalled()
    // Nothing was consumed: the message waits for a mission that can record it.
    expect(delivered).toEqual([])
  })

  it('runs without the channel when it cannot be read, and reports that on the receipt', async () => {
    const { workroom } = fakeWorkroom({ unread: async () => { throw new Error('channel damaged') } })
    const { service, start } = peerService({ run: transcript('Done.'), workroom })

    const response = await service.start('Task.', 'codex', 'ask', {}, () => undefined, undefined, PEER)

    expect(response.ok).toBe(true)
    if (!response.ok) return
    expect(response.data.peerDeliveryFailed).toBe(true)
    expect(response.data.peerMessages).toEqual([])
    // The share form still goes: the run can post even when it was shown nothing.
    expect(start.mock.calls[0]?.[1]).toContain('<locust-share to="Atlas">')
  })

  it('posts a share block to the named teammate, attributed to this mission, and links it', async () => {
    const { workroom, posted } = fakeWorkroom()
    const updates: CodexMissionUpdate[] = []
    const { service, links, scheduled } = peerService({
      run: transcript('The gate is pnpm check.\n\n<locust-share to="Atlas">\npnpm check runs build, typecheck and tests.\n</locust-share>'),
      workroom
    })

    const response = await service.start('Find the check command.', 'codex', 'ask', {}, (update) => updates.push(update), undefined, PEER)
    expect(response.ok).toBe(true)
    await drain(scheduled)

    expect(posted).toEqual([
      {
        from: { teammateId: 'tm_wren', name: 'Wren', missionId: 'mission_2' },
        to: { teammateId: 'tm_atlas', name: 'Atlas' },
        text: 'pnpm check runs build, typecheck and tests.'
      }
    ])
    expect(links).toEqual([
      {
        missionId: 'mission_2',
        links: [{ direction: 'posted', messageId: 'wm_out_1', peerTeammateId: 'tm_atlas', occurredAt: NOW }]
      }
    ])
    const peerUpdates = updates.filter((update) => update.kind === 'peer-message')
    expect(peerUpdates).toEqual([
      {
        kind: 'peer-message',
        runId: 'run_1',
        missionId: 'mission_2',
        message: {
          messageId: 'wm_out_1',
          direction: 'posted',
          from: { teammateId: 'tm_wren', name: 'Wren' },
          to: { teammateId: 'tm_atlas', name: 'Atlas' },
          text: 'pnpm check runs build, typecheck and tests.',
          at: NOW
        }
      }
    ])
  })

  it('refuses a share addressed to someone who is not on the roster, out loud', async () => {
    const { workroom, posted } = fakeWorkroom()
    const updates: CodexMissionUpdate[] = []
    const { service, scheduled } = peerService({
      run: transcript('<locust-share to="Mallory">\nsecret\n</locust-share>'),
      workroom
    })

    await service.start('Task.', 'codex', 'ask', {}, (update) => updates.push(update), undefined, PEER)
    await drain(scheduled)

    expect(posted).toEqual([])
    expect(updates.filter((update) => update.kind === 'peer-share-failed')).toEqual([
      {
        kind: 'peer-share-failed',
        runId: 'run_1',
        missionId: 'mission_2',
        message: 'Wren addressed a message to "Mallory", who is not on the roster. Nothing was sent.'
      }
    ])
  })

  it('shares nothing from a run that did not complete', async () => {
    const { workroom, posted } = fakeWorkroom()
    const run: RuntimeProcessRun = {
      records: records([
        { type: 'thread.started', thread_id: 'thread-live' },
        { type: 'turn.started' },
        { type: 'item.completed', item: { id: 'answer', type: 'agent_message', text: '<locust-share to="Atlas">\nhalf a claim\n</locust-share>' } }
      ]),
      completion: Promise.resolve(completion({ exitCode: 1 }))
    }
    const { service, scheduled } = peerService({ run, workroom })

    await service.start('Task.', 'codex', 'ask', {}, () => undefined, undefined, PEER)
    await drain(scheduled)

    expect(posted).toEqual([])
  })

  it('shares nothing from a mission that belongs to nobody', async () => {
    const { workroom, posted } = fakeWorkroom()
    const { service, start, scheduled } = peerService({
      run: transcript('<locust-share to="Atlas">\nfinding\n</locust-share>'),
      workroom
    })

    await service.start('Task.', 'codex', 'ask', {}, () => undefined)
    await drain(scheduled)

    expect(posted).toEqual([])
    expect(start.mock.calls[0]?.[1]).toBe('Task.')
  })
})

describe('missions side by side', () => {
  const ATLAS = { self: { teammateId: 'tm_atlas', name: 'Atlas', role: 'Research & Briefs' }, others: [] }
  const WREN = { self: { teammateId: 'tm_wren', name: 'Wren', role: 'Code & Migrations' }, others: [] }
  const NOVA = { self: { teammateId: 'tm_nova', name: 'Nova', role: 'Docs & QA' }, others: [] }
  const KAI = { self: { teammateId: 'tm_kai', name: 'Kai', role: 'Custom' }, others: [] }
  const ORION = { self: { teammateId: 'tm_orion', name: 'Orion', role: 'Custom' }, others: [] }

  /** A run that lasts until its signal aborts, so several can be live at once. */
  function openEnded() {
    const signals: AbortSignal[] = []
    const start = vi.fn((_spec, _prompt, options): RuntimeProcessRun => {
      const signal = options?.signal
      if (signal) signals.push(signal)
      let release!: () => void
      const released = new Promise<void>((resolve) => {
        release = resolve
      })
      let finish!: (value: RuntimeProcessCompletion) => void
      const done = new Promise<RuntimeProcessCompletion>((resolve) => {
        finish = resolve
      })
      signal?.addEventListener('abort', () => {
        release()
        finish(completion({ exitCode: null, signal: 'SIGINT', recordCount: 1, cancelled: true }))
      }, { once: true })
      return {
        records: {
          async *[Symbol.asyncIterator]() {
            yield { sequence: 1, raw: JSON.stringify({ type: 'thread.started', thread_id: 'thread-open' }) }
            await released
          },
          drainAvailable: () => []
        },
        completion: done
      }
    }) satisfies RuntimeProcessRunner['start']
    return { start, signals }
  }

  it('runs two teammates\u2019 missions at once, and stops each by its own run id', async () => {
    const { start, signals } = openEnded()
    const { service, scheduled } = scheduledService({ start })

    const atlas = await service.start('Atlas works.', 'codex', 'ask', {}, () => undefined, undefined, ATLAS)
    const wren = await service.start('Wren works.', 'codex', 'ask', {}, () => undefined, undefined, WREN)
    expect(atlas.ok && wren.ok).toBe(true)
    if (!atlas.ok || !wren.ok) return
    expect(atlas.data.runId).not.toBe(wren.data.runId)
    while (scheduled.length > 0) scheduled.shift()!()

    expect(service.cancel(atlas.data.runId)).toMatchObject({ ok: true })
    expect(signals[0]?.aborted).toBe(true)
    // Stopping one is not stopping the other.
    expect(signals[1]?.aborted).toBe(false)
    expect(service.cancel(wren.data.runId)).toMatchObject({ ok: true })
    expect(signals[1]?.aborted).toBe(true)
  })

  it('refuses a second live mission for the same teammate, by name', async () => {
    const { start } = openEnded()
    const { service } = scheduledService({ start })
    await service.start('Atlas works.', 'codex', 'ask', {}, () => undefined, undefined, ATLAS)
    await expect(
      service.start('Atlas again.', 'codex', 'ask', {}, () => undefined, undefined, ATLAS)
    ).resolves.toEqual({
      ok: false,
      error: { code: 'RUN_ALREADY_ACTIVE', message: 'Atlas already has a mission running. Wait for it to finish or stop it first.' }
    })
  })

  it('caps how many missions can be live at once, and says the number', async () => {
    const { start } = openEnded()
    const { service } = scheduledService({ start })
    for (const peer of [ATLAS, WREN, NOVA, KAI]) {
      await expect(service.start('Work.', 'codex', 'ask', {}, () => undefined, undefined, peer)).resolves.toMatchObject({ ok: true })
    }
    await expect(service.start('One too many.', 'codex', 'ask', {}, () => undefined, undefined, ORION)).resolves.toMatchObject({
      ok: false,
      error: { code: 'RUN_ALREADY_ACTIVE', message: expect.stringContaining('Up to 4 missions') }
    })
  })

  it('hands off one teammate\u2019s run without waiting for another teammate\u2019s to finish', async () => {
    const { start } = openEnded()
    const createCheckpoint = vi.fn<MissionLedger['createCheckpoint']>(async (missionId) => ({
      schemaVersion: 1,
      missionId,
      runId: 'run_x',
      epoch: 1,
      reason: 'route-switch',
      reconciledThroughSequence: 1,
      settledActions: [],
      unsettledActions: [],
      resumeSafety: 'safe',
      safetyReason: 'nothing in flight',
      transcriptDigest: 'digest',
      assistantSummary: '',
      createdAt: NOW
    }))
    const scheduledTasks: Array<() => void> = []
    let nextId = 0
    const service = createCodexMissionService({
      workspacePath: WORKSPACE,
      discover: async () => [
        codexRuntime(),
        {
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
      ],
      runner: { start },
      ledger: fakeLedger({ createCheckpoint }),
      createId: () => String(++nextId),
      now: () => new Date(NOW),
      schedule: (task) => scheduledTasks.push(task)
    })

    const atlas = await service.start('Atlas works.', 'codex', 'ask', {}, () => undefined, undefined, ATLAS)
    const wren = await service.start('Wren works.', 'codex', 'ask', {}, () => undefined, undefined, WREN)
    expect(atlas.ok && wren.ok).toBe(true)
    if (!atlas.ok) return
    while (scheduledTasks.length > 0) scheduledTasks.shift()!()

    // Wren's run is still open-ended. A handoff that waited on every live
    // loop would never return here.
    const handed = await service.handOff(atlas.data.runId, 'claude', 'ask', {}, () => undefined)
    expect(handed).toMatchObject({ ok: true })
    expect(createCheckpoint).toHaveBeenCalledWith(atlas.data.missionId, 'route-switch')
  })
})

describe('continuing a conversation', () => {
  function finished(overrides: Record<string, unknown> = {}) {
    return {
      metadata: {
        missionId: 'mission_prior',
        runId: 'run_prior',
        prompt: 'check the google stock price',
        runtime: 'codex',
        model: 'account-default',
        requestedRouteId: 'codex',
        resolvedRouteId: 'codex-account:default',
        cliVersion: null,
        workspaceId: 'ws_test',
        sandbox: 'read-only',
        executionPolicyVersion: 1,
        createdAt: NOW,
        ...overrides
      },
      events: [
        {
          id: 'e1',
          runId: 'run_prior',
          missionId: 'mission_prior',
          sequence: 1,
          type: 'run.started',
          occurredAt: NOW,
          sourceAdapter: 'codex',
          payload: { runtimeThreadId: 'thread-prior', evidence: { redacted: true } }
        }
      ],
      hostFailures: [],
      checkpoints: [],
      peerLinks: [],
      phase: 'completed',
      lastUpdatedAt: NOW,
      ledgerSequence: 2,
      issues: []
    } as never
  }

  it('resumes the earlier mission\u2019s own session, and records what it continued', async () => {
    const start = vi.fn((_spec, _prompt, _options): RuntimeProcessRun => ({
      records: records([{ type: 'thread.started', thread_id: 'thread-prior' }, { type: 'turn.completed' }]),
      completion: Promise.resolve(completion())
    })) satisfies RuntimeProcessRunner['start']
    const createMission = vi.fn<MissionLedger['createMission']>(async () => undefined)
    const { service } = scheduledService({ start }, fakeLedger({
      createMission,
      getMission: async () => finished()
    }))

    const response = await service.start(
      'cant you look it up for me?', 'codex', 'ask', {}, () => undefined, undefined, undefined, 'mission_prior'
    )

    expect(response.ok).toBe(true)
    if (!response.ok) return
    // The runtime is told to resume that session rather than start blank.
    const spec = start.mock.calls[0]?.[0] as { args: readonly string[] }
    expect(spec.args.slice(0, 3)).toEqual(['exec', 'resume', 'thread-prior'])
    // And the record says so, so a reopened thread can rebuild the exchange.
    expect(createMission.mock.calls[0]?.[0]?.continuesFrom).toEqual({
      missionId: 'mission_prior',
      checkpointEpoch: 1,
      reason: 'follow-up',
      runtimeThreadId: 'thread-prior'
    })
    expect(response.data.followsUp).toEqual({ missionId: 'mission_prior', runtimeThreadId: 'thread-prior' })
  })

  it('refuses to continue a conversation that recorded no session, rather than starting blank', async () => {
    const start = vi.fn((_spec, _prompt, _options): RuntimeProcessRun => ({
      records: records([]),
      completion: Promise.resolve(completion())
    })) satisfies RuntimeProcessRunner['start']
    const { service } = scheduledService({ start }, fakeLedger({
      getMission: async () => ({ ...(finished() as never as Record<string, unknown>), events: [] }) as never
    }))

    const response = await service.start(
      'go on', 'codex', 'ask', {}, () => undefined, undefined, undefined, 'mission_prior'
    )

    expect(response).toMatchObject({
      ok: false,
      error: { code: 'RUNTIME_START_FAILED', message: expect.stringContaining('did not record a session') }
    })
    // Nothing was launched: a blank run pretending to be a reply is the failure.
    expect(start).not.toHaveBeenCalled()
  })

  it('refuses to continue another runtime\u2019s conversation, and says which', async () => {
    const start = vi.fn((_spec, _prompt, _options): RuntimeProcessRun => ({
      records: records([]),
      completion: Promise.resolve(completion())
    })) satisfies RuntimeProcessRunner['start']
    const { service } = scheduledService({ start }, fakeLedger({
      getMission: async () => finished({ runtime: 'claude' })
    }))

    const response = await service.start(
      'go on', 'codex', 'ask', {}, () => undefined, undefined, undefined, 'mission_prior'
    )

    expect(response).toMatchObject({
      ok: false,
      error: { code: 'RUNTIME_START_FAILED', message: expect.stringContaining('Claude Code') }
    })
    expect(start).not.toHaveBeenCalled()
  })

  it('starts a fresh conversation when nothing is being continued', async () => {
    const start = vi.fn((_spec, _prompt, _options): RuntimeProcessRun => ({
      records: records([{ type: 'turn.completed' }]),
      completion: Promise.resolve(completion())
    })) satisfies RuntimeProcessRunner['start']
    const createMission = vi.fn<MissionLedger['createMission']>(async () => undefined)
    const { service } = scheduledService({ start }, fakeLedger({ createMission }))

    await service.start('a first question', 'codex', 'ask', {}, () => undefined)

    const spec = start.mock.calls[0]?.[0] as { args: readonly string[] }
    expect(spec.args.includes('resume')).toBe(false)
    expect(createMission.mock.calls[0]?.[0]?.continuesFrom).toBeUndefined()
  })
})
