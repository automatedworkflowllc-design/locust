import type {
  RuntimeDiscovery,
  RuntimeJsonlRecord,
  RuntimeProcessRecordStream,
  RuntimeProcessCompletion,
  RuntimeProcessRun,
  RuntimeProcessRunner,
  NormalizedRuntimeEvent
} from '@teammate/runtime-adapters'
import type { MissionLedger, MissionPeerLink, Workroom, WorkroomMessage } from '@teammate/mission-store'
import { describe, expect, it, vi } from 'vitest'
import type { CodexMissionUpdate } from '../shared/ipc.js'
import { MAX_LIVE_MISSIONS } from '../shared/live-missions.js'
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
    oversizedRecordsDropped: 0,
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
    listMissions: async () => ({ missions: [], issues: [], unreadableCount: 0 }),
    flush: async () => undefined,
    ...overrides
  }
}

function scheduledService(
  runner: RuntimeProcessRunner,
  ledger = fakeLedger(),
  extra: Partial<Parameters<typeof createCodexMissionService>[0]> = {}
) {
  const scheduled: Array<() => void> = []
  let nextId = 0
  const service = createCodexMissionService({
    workspacePath: WORKSPACE,
    discover: async () => [codexRuntime()],
    runner,
    ledger,
    createId: () => String(++nextId),
    now: () => new Date(NOW),
    schedule: (task) => scheduled.push(task),
    ...extra
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

  it('records that a plan was a plan, while still holding it read-only', async () => {
    // Two facts that have to hold together. `plan` and `ask` are both
    // read-only, which is why the mode used to collapse into `ask` on its way
    // in -- harmless for permission, and it meant the record never knew a
    // plan had been asked for, so a plan reopened after a restart lost its
    // "Build this plan" offer (QA, 2026-09-06).
    let created: { readonly sandbox?: string; readonly mode?: string } | undefined
    const start = (() => {
      throw new Error('stop here')
    }) as unknown as RuntimeProcessRunner['start']
    const ledger = fakeLedger({
      createMission: async (metadata: { readonly sandbox?: string; readonly mode?: string }) => {
        created = metadata
        return undefined as never
      }
    })
    const service = createCodexMissionService({
      workspacePath: WORKSPACE,
      discover: async () => [codexRuntime()],
      runner: { start },
      ledger
    })

    await service.start('Plan how you would add a LICENSE file.', 'codex', 'plan', {}, () => undefined)
    expect(created?.mode).toBe('plan')
    expect(created?.sandbox).toBe('read-only')
  })

  it('refuses an Auto mission when the workspace has Auto switched off, and records nothing', async () => {
    // The renderer does not offer Auto with the switch off, but a window left
    // open across a change of mind, or a routine recorded while it was on,
    // both send the mode anyway. The switch is what decides, and it is asked
    // on the path every run takes.
    const start = vi.fn() satisfies RuntimeProcessRunner['start']
    const ledger = fakeLedger()
    const service = createCodexMissionService({
      workspacePath: WORKSPACE,
      discover: async () => [codexRuntime()],
      runner: { start },
      ledger,
      autoModeAllowed: async () => false
    })

    await expect(service.start('Tidy my whole machine.', 'codex', 'auto', {}, () => undefined)).resolves.toEqual({
      ok: false,
      error: {
        code: 'RUNTIME_START_FAILED',
        message:
          'Auto mode is switched off for this workspace. Turn it on in Settings to let a run work outside the workspace folder. Nothing was recorded.'
      }
    })
    expect(start).not.toHaveBeenCalled()
  })

  it('refuses an Auto mission when nobody wired the switch at all', async () => {
    // Absent means off. A caller that forgets to pass the seam cannot get the
    // widest sandbox by omission.
    const start = vi.fn() satisfies RuntimeProcessRunner['start']
    const service = createCodexMissionService({
      workspacePath: WORKSPACE,
      discover: async () => [codexRuntime()],
      runner: { start },
      ledger: fakeLedger()
    })

    await expect(service.start('Tidy my whole machine.', 'codex', 'auto', {}, () => undefined)).resolves.toMatchObject({
      ok: false,
      error: { code: 'RUNTIME_START_FAILED' }
    })
    expect(start).not.toHaveBeenCalled()
  })

  it('refuses the NEXT Auto run once the switch is taken back, on the same service', async () => {
    // The 0.35.0 targeted QA asked for exactly this and could not test it:
    // "same-session mode changes and revocation before scheduled/relayed
    // starts". A relay hop and a routine step both start through this
    // service without a window in the loop, so the switch has to be read as
    // each run starts rather than once when the service is built.
    let allowed = true
    const started: string[] = []
    const start = ((spec: { readonly args: readonly string[] }) => {
      started.push(spec.args.join(' '))
      throw new Error('stop here')
    }) as unknown as RuntimeProcessRunner['start']
    const service = createCodexMissionService({
      workspacePath: WORKSPACE,
      discover: async () => [codexRuntime()],
      runner: { start },
      ledger: fakeLedger(),
      autoModeAllowed: async () => allowed
    })

    await service.start('First, while it is on.', 'codex', 'auto', {}, () => undefined)
    expect(started).toHaveLength(1)
    expect(started[0]).toContain('--sandbox danger-full-access')

    // The person switches it off in Settings. Nothing else changes.
    allowed = false

    await expect(service.start('Second, after taking it back.', 'codex', 'auto', {}, () => undefined)).resolves.toMatchObject({
      ok: false,
      error: { code: 'RUNTIME_START_FAILED' }
    })
    // Not merely refused: nothing was launched, so nothing can have run wide.
    expect(started).toHaveLength(1)
  })

  it('runs an Auto mission on the widest sandbox once the workspace allows it', async () => {
    // The argv is what this case is about, so the spec is captured and the
    // spawn is stopped right after it.
    let launched: { readonly args: readonly string[]; readonly sandbox?: string } | undefined
    const start = ((spec: { readonly args: readonly string[]; readonly sandbox?: string }) => {
      launched = spec
      throw new Error('stop here')
    }) as unknown as RuntimeProcessRunner['start']
    const service = createCodexMissionService({
      workspacePath: WORKSPACE,
      discover: async () => [codexRuntime()],
      runner: { start },
      ledger: fakeLedger(),
      autoModeAllowed: async () => true
    })

    await service.start('Tidy my whole machine.', 'codex', 'auto', {}, () => undefined)
    expect(launched?.args.join(' ')).toContain('--sandbox danger-full-access')
    // And the spec says so itself, which is what the runner re-reads at spawn.
    expect(launched?.sandbox).toBe('full-access')
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

  it('records a Claude run that may edit as one that may edit', async () => {
    // This asserted the opposite until 2026-09-03, on the reading that only
    // Codex takes a sandbox. Claude Code takes a different one -- the
    // permission mode and tool list, set from this very value -- and forcing
    // read-only here meant a mission started in Accept edits ran in plan mode
    // and had its Write refused with "Write is disabled for this session".
    // The receipt has to say what the run was actually allowed to do.
    const createMission = vi.fn<MissionLedger['createMission']>(async () => undefined)
    const { service } = serviceWith([codexRuntime(), claudeRuntime()], fakeLedger({ createMission }))

    const response = await service.start('Edit something.', 'claude', 'accept-edits', {}, () => undefined)

    expect(response).toMatchObject({ ok: true, data: { sandbox: 'workspace-write' } })
    expect(createMission).toHaveBeenCalledWith(expect.objectContaining({
      runtime: 'claude',
      sandbox: 'workspace-write'
    }))
  })

  it('sends Claude the mode it was started in, not a default', async () => {
    // The receipt said workspace-write while the argv still said plan, because
    // the Claude branch built its command without a sandbox at all. The run
    // answered "I don't have a Write tool available in this session" while the
    // ledger claimed it could edit -- the ledger and the process disagreeing
    // is the one thing a receipt must never do.
    const { service, start } = serviceWith([codexRuntime(), claudeRuntime()], fakeLedger())

    await service.start('Edit something.', 'claude', 'accept-edits', {}, () => undefined)

    const spec = start.mock.calls[0]?.[0] as { args: string[] }
    expect(spec.args.join(' ')).toContain('--permission-mode acceptEdits')
    expect(spec.args.join(' ')).toContain('Edit,Write,NotebookEdit,Bash')
  })

  it('still records a Claude run asked to read as read-only', async () => {
    const createMission = vi.fn<MissionLedger['createMission']>(async () => undefined)
    const { service } = serviceWith([codexRuntime(), claudeRuntime()], fakeLedger({ createMission }))

    const response = await service.start('Read something.', 'claude', 'ask', {}, () => undefined)

    expect(response).toMatchObject({ ok: true, data: { sandbox: 'read-only' } })
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

  it('plans in the plan MODE, and only where the sandbox already refuses writes', async () => {
    const { workroom } = fakeWorkroom()
    const planning = peerService({ run: transcript('Here is the plan.'), workroom })
    const planned = await planning.service.start(
      'Add retries to the fetch helper.',
      'codex',
      'plan',
      {},
      () => undefined,
      undefined,
      PEER
    )
    expect(planned.ok).toBe(true)
    // The invariant Plan-as-a-mode rests on: choosing it CANNOT leave the run
    // able to write. The sandbox is what the runtime is actually launched
    // with, so it is asserted here rather than trusted from the mode name.
    expect(planned.ok && planned.data.sandbox).toBe('read-only')
    const withPlan = planning.start.mock.calls[0]?.[1] as string
    expect(withPlan.startsWith('Add retries to the fetch helper.')).toBe(true)
    expect(withPlan).toContain('PLAN FIRST')
    expect(withPlan).toContain('numbered steps')

    // Accept edits CAN change the workspace. Plan is a mode now, so the two
    // cannot be chosen together at all -- and the host still checks the
    // sandbox rather than trusting the mode name it was handed.
    const editing = peerService({ run: transcript('Done.'), workroom })
    const edited = await editing.service.start(
      'Add retries to the fetch helper.',
      'codex',
      'accept-edits',
      {},
      () => undefined,
      undefined,
      PEER
    )
    expect(edited.ok).toBe(true)
    expect(editing.start.mock.calls[0]?.[1] as string).not.toContain('PLAN FIRST')

    // And an ordinary read-only run is unchanged.
    const plain = peerService({ run: transcript('Done.'), workroom })
    await plain.service.start('Add retries to the fetch helper.', 'codex', 'ask', {}, () => undefined, undefined, PEER)
    expect(plain.start.mock.calls[0]?.[1] as string).not.toContain('PLAN FIRST')
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
    /*
     * Derived from the constant, not written out.
     *
     * This said "Up to 4 missions" and filled the pool with four named
     * peers. Both broke the day the cap was measured and raised to 8 -- a
     * failing test that only meant the number moved, which is noise, and
     * which cannot tell a deliberate change from a mistaken one.
     *
     * A teammate may hold one mission, so the pool is filled with a distinct
     * teammate per slot, however many slots there are.
     */
    const slot = (i: number) => ({ self: { teammateId: `tm_slot_${String(i)}`, name: `Slot${String(i)}`, role: 'Custom' }, others: [] })
    for (let i = 0; i < MAX_LIVE_MISSIONS; i += 1) {
      await expect(service.start('Work.', 'codex', 'ask', {}, () => undefined, undefined, slot(i))).resolves.toMatchObject({ ok: true })
    }
    await expect(service.start('One too many.', 'codex', 'ask', {}, () => undefined, undefined, ORION)).resolves.toMatchObject({
      ok: false,
      error: { code: 'RUN_ALREADY_ACTIVE', message: expect.stringContaining(`Up to ${String(MAX_LIVE_MISSIONS)} missions`) }
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

  it('starts cold when the mode changed, so the chip is not lying about the run', async () => {
    // An outside tester, 0.38.7 finding 5: "Composer mode does not apply to
    // follow-ups in the open thread. Chip set to Accept edits; the follow-up
    // still ran with no write tools because the thread started in Ask. The
    // chip lies about the session that will actually run."
    //
    // A resumed session keeps the tools it was BUILT with, so the mode a
    // person changed since cannot reach it. Losing the earlier messages is
    // the smaller cost -- and the thread says that happened -- next to the
    // mode on screen not being the mode that runs.
    const start = vi.fn((_spec, _prompt, _options): RuntimeProcessRun => ({
      records: records([{ type: 'turn.completed' }]),
      completion: Promise.resolve(completion())
    })) satisfies RuntimeProcessRunner['start']
    const created: Record<string, unknown>[] = []
    const { service } = scheduledService({ start }, fakeLedger({
      getMission: async () => finished({ mode: 'ask' }) as never,
      createMission: async (metadata) => {
        created.push(metadata as unknown as Record<string, unknown>)
      }
    }))

    const response = await service.start(
      'now actually write it', 'codex', 'accept-edits', {}, () => undefined, undefined, undefined, 'mission_prior'
    )

    expect(response.ok).toBe(true)
    const spec = start.mock.calls[0]?.[0] as { args: readonly string[] }
    // Not `exec resume thread-prior`: that session cannot be given write tools.
    expect(spec.args.slice(0, 3)).not.toEqual(['exec', 'resume', 'thread-prior'])
    expect(spec.args).not.toContain('thread-prior')
    // And the run it did start is the one the chip promised.
    expect(created[0]?.sandbox).toBe('workspace-write')
  })

  it('still resumes when the mode is the same one the conversation started in', async () => {
    // The guard above must not cost every follow-up its context: an unchanged
    // mode resumes exactly as before.
    const start = vi.fn((_spec, _prompt, _options): RuntimeProcessRun => ({
      records: records([{ type: 'thread.started', thread_id: 'thread-prior' }, { type: 'turn.completed' }]),
      completion: Promise.resolve(completion())
    })) satisfies RuntimeProcessRunner['start']
    const { service } = scheduledService({ start }, fakeLedger({
      getMission: async () => finished({ mode: 'ask' }) as never
    }))

    const response = await service.start(
      'and what did that say?', 'codex', 'ask', {}, () => undefined, undefined, undefined, 'mission_prior'
    )

    expect(response.ok).toBe(true)
    const spec = start.mock.calls[0]?.[0] as { args: readonly string[] }
    expect(spec.args.slice(0, 3)).toEqual(['exec', 'resume', 'thread-prior'])
  })

  it('continues a conversation whose earlier turn recorded no session, cold rather than not at all', async () => {
    // A turn that failed before its runtime started leaves nothing to resume.
    // Refusing the reply is what made a follow-up after a failure open a
    // second sidebar row and drop the turn above it (Colin, 2026-09-03). The
    // conversation is still that conversation; only the model starts blank.
    const start = vi.fn((_spec, _prompt, _options): RuntimeProcessRun => ({
      records: records([]),
      completion: Promise.resolve(completion())
    })) satisfies RuntimeProcessRunner['start']
    const created: Record<string, unknown>[] = []
    const { service } = scheduledService({ start }, fakeLedger({
      getMission: async () => ({ ...(finished() as never as Record<string, unknown>), events: [] }) as never,
      createMission: async (metadata) => {
        created.push(metadata as unknown as Record<string, unknown>)
      }
    }))

    const response = await service.start(
      'go on', 'codex', 'ask', {}, () => undefined, undefined, undefined, 'mission_prior'
    )

    expect(response).toMatchObject({ ok: true })
    // The record links the turns and claims no resume that did not happen.
    expect(created.at(-1)?.continuesFrom).toEqual({
      missionId: 'mission_prior',
      checkpointEpoch: 1,
      reason: 'follow-up'
    })
    expect((response as { data: { followsUp?: unknown } }).data.followsUp).toEqual({ missionId: 'mission_prior' })
    // And the process starts fresh: `exec resume` would need a session id.
    expect(start).toHaveBeenCalled()
    const spec = start.mock.calls[0]?.[0] as { args: string[] }
    expect(spec.args).not.toContain('resume')
  })

  it('continues another runtime\u2019s conversation from a checkpoint, with the reply as the latest word', async () => {
    // This used to be refused ("switch the route back"), and the person's
    // workaround was a fresh mission with the task retyped -- the 0.21.2 QA
    // pass did exactly that after a quota failure. Now it is a handoff
    // without the stop.
    const checkpoints: Array<[string, string]> = []
    const createMission = vi.fn<MissionLedger['createMission']>(async () => undefined)
    const start = vi.fn((_spec, _prompt, _options): RuntimeProcessRun => ({
      records: records([{ type: 'thread.started', thread_id: 'thread-new' }, { type: 'turn.completed' }]),
      completion: Promise.resolve(completion())
    })) satisfies RuntimeProcessRunner['start']
    const { service } = scheduledService({ start }, fakeLedger({
      getMission: async () => finished({ runtime: 'claude' }),
      createMission,
      createCheckpoint: async (missionId, reason) => {
        checkpoints.push([missionId, reason])
        return {
          missionId,
          epoch: 2,
          reason,
          resumeSafety: 'safe',
          safetyReason: 'settled',
          createdAt: NOW,
          unsettledActions: [],
          settledActions: ['read README.md'],
          assistantSummary: 'The price was 181.'
        } as never
      }
    }))

    const response = await service.start(
      'now in euros', 'codex', 'ask', {}, () => undefined, undefined, undefined, 'mission_prior'
    )

    expect(response).toMatchObject({ ok: true })
    expect(checkpoints).toEqual([['mission_prior', 'route-switch']])
    expect(start).toHaveBeenCalledTimes(1)
    const briefed = start.mock.calls[0]?.[1] as string
    expect(briefed).toContain('another agent (Claude Code)')
    expect(briefed).toContain('check the google stock price')
    expect(briefed).toContain('The price was 181.')
    expect(briefed.endsWith('The person now asks:\n\nnow in euros')).toBe(true)
    // Recorded the way the live handoff records, so the thread draws the
    // same divider and a reopened conversation stitches the same way.
    expect(createMission.mock.calls[0]?.[0]?.continuesFrom).toEqual({
      missionId: 'mission_prior',
      checkpointEpoch: 2,
      reason: 'route-switch'
    })
    // No `exec resume`: the other runtime's session is not this one's.
    const spec = start.mock.calls[0]?.[0] as { args: readonly string[] }
    expect(spec.args.includes('resume')).toBe(false)
  })

  it('refuses the cross-runtime continuation when the record cannot be trusted', async () => {
    const start = vi.fn((_spec, _prompt, _options): RuntimeProcessRun => ({
      records: records([]),
      completion: Promise.resolve(completion())
    })) satisfies RuntimeProcessRunner['start']
    const { service } = scheduledService({ start }, fakeLedger({
      getMission: async () => finished({ runtime: 'claude' }),
      createCheckpoint: async (missionId, reason) =>
        ({ missionId, epoch: 2, reason, resumeSafety: 'unsafe', safetyReason: 'the ledger tail is damaged' }) as never
    }))
    const response = await service.start(
      'go on', 'codex', 'ask', {}, () => undefined, undefined, undefined, 'mission_prior'
    )
    expect(response).toMatchObject({
      ok: false,
      error: { code: 'RUNTIME_START_FAILED', message: expect.stringContaining('the ledger tail is damaged') }
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

describe('what a completed share hands to the relay', () => {
  const WREN = { teammateId: 'tm_wren', name: 'Wren', role: 'Code & Migrations' }
  const ATLAS = { teammateId: 'tm_atlas', name: 'Atlas', role: 'Research & Briefs' }
  const PEER: MissionPeerContext = { self: WREN, others: [ATLAS] }

  it('calls onShared once with the run and exactly the messages it posted, after they are recorded', async () => {
    let nextId = 0
    const workroom: Workroom = {
      post: async (input) => ({
        messageId: `wm_out_${String(++nextId)}`,
        sequence: nextId,
        from: input.from,
        to: input.to,
        text: input.text,
        postedAt: NOW
      }),
      unread: async () => ({ messages: [], remaining: 0 }),
      markDelivered: async () => undefined,
      read: async () => ({ messages: [], deliveries: [], issues: [] }),
      flush: async () => undefined
    }
    const scheduled: Array<() => void> = []
    const shared: { mission: unknown; posted: readonly WorkroomMessage[] }[] = []
    let ids = 0
    const service = createCodexMissionService({
      workspacePath: WORKSPACE,
      discover: async () => [codexRuntime()],
      runner: {
        start: () => ({
          records: records([
            { type: 'thread.started', thread_id: 'thread-live' },
            { type: 'turn.started' },
            {
              type: 'item.completed',
              item: {
                id: 'answer',
                type: 'agent_message',
                text: 'Found it.\n<locust-share to="Atlas">The build runs with pnpm check.</locust-share>'
              }
            },
            { type: 'turn.completed', usage: { output_tokens: 2 } }
          ]),
          completion: Promise.resolve(completion())
        })
      },
      ledger: fakeLedger(),
      workroom,
      createId: () => String(++ids),
      now: () => new Date(NOW),
      schedule: (task) => scheduled.push(task),
      onShared: async (mission, posted) => {
        shared.push({ mission, posted })
      }
    })

    const response = await service.start('Where do the checks run?', 'codex', 'ask', { model: 'gpt-5-codex' }, () => undefined, undefined, PEER)
    expect(response.ok).toBe(true)
    while (scheduled.length > 0) scheduled.shift()!()
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve))

    expect(shared).toHaveLength(1)
    expect(shared[0]?.mission).toMatchObject({
      runtime: 'codex',
      sandbox: 'read-only',
      model: 'gpt-5-codex',
      peer: PEER,
      relay: undefined
    })
    expect(shared[0]?.posted.map((message) => [message.to.name, message.text])).toEqual([
      ['Atlas', 'The build runs with pnpm check.']
    ])
  })

  it('a relayed run carries its hop through to what it shares', async () => {
    const scheduled: Array<() => void> = []
    const shared: { mission: { relay?: unknown } }[] = []
    let ids = 0
    const service = createCodexMissionService({
      workspacePath: WORKSPACE,
      discover: async () => [codexRuntime()],
      runner: {
        start: () => ({
          records: records([
            { type: 'thread.started', thread_id: 'thread-live' },
            { type: 'turn.started' },
            {
              type: 'item.completed',
              item: { id: 'answer', type: 'agent_message', text: '<locust-share to="Wren">Yes.</locust-share>' }
            },
            { type: 'turn.completed', usage: { output_tokens: 1 } }
          ]),
          completion: Promise.resolve(completion())
        })
      },
      ledger: fakeLedger(),
      workroom: {
        post: async (input) => ({ messageId: 'wm_1', sequence: 1, from: input.from, to: input.to, text: input.text, postedAt: NOW }),
        unread: async () => ({ messages: [], remaining: 0 }),
        markDelivered: async () => undefined,
        read: async () => ({ messages: [], deliveries: [], issues: [] }),
        flush: async () => undefined
      },
      createId: () => String(++ids),
      now: () => new Date(NOW),
      schedule: (task) => scheduled.push(task),
      onShared: async (mission) => {
        shared.push({ mission })
      }
    })
    const origin = { hop: 1, lastMissionOf: { tm_wren: 'mission_origin' } }
    const response = await service.start('Reply to Wren.', 'codex', 'ask', {}, () => undefined, undefined, { self: ATLAS, others: [WREN] }, undefined, origin)
    expect(response.ok).toBe(true)
    while (scheduled.length > 0) scheduled.shift()!()
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve))
    expect(shared[0]?.mission.relay).toEqual(origin)
  })
})

describe('what a run changed on disk that it never said', () => {
  // OpenCode, 2026-09-05: a free Muse Spark run in write mode changed
  // notes.ts through its `task` sub-agent; the stream said `task` and `read`,
  // the activity card said "2 tool calls", and the file on disk disagreed
  // with the receipt. The host now looks for itself.
  const NUL = String.fromCharCode(0)
  const snapshots = (before: string, after: string) => {
    let looks = 0
    const observeDisk = vi.fn(async () => {
      looks += 1
      const output = looks === 1 ? before : after
      const map = new Map<string, string>()
      for (const entry of output.split(NUL)) if (entry.length >= 4) map.set(entry.slice(3), entry.slice(0, 2))
      return map
    })
    return observeDisk
  }

  it('adds an observed edit row, after the terminal event, for a file no tool named', async () => {
    const appended: NormalizedRuntimeEvent[] = []
    const ledger = fakeLedger({ appendEvents: async (_id, events) => { appended.push(...events) } })
    const observeDisk = snapshots('', ` M src/notes.ts${NUL}`)
    const start = vi.fn((_spec, _prompt, _options): RuntimeProcessRun => ({
      records: records([
        { type: 'thread.started', thread_id: 'thread-live' },
        { type: 'turn.started' },
        { type: 'item.started', item: { id: 'i1', type: 'command_execution', command: 'cat README.md' } },
        { type: 'item.completed', item: { id: 'i1', type: 'command_execution', command: 'cat README.md', exit_code: 0 } },
        { type: 'turn.completed', usage: { output_tokens: 2 } }
      ]),
      completion: Promise.resolve(completion())
    })) satisfies RuntimeProcessRunner['start']
    const { service, scheduled } = scheduledService({ start }, ledger, { observeDisk })
    await service.start('polish the notes', 'codex', 'accept-edits', {}, () => undefined)
    scheduled[0]?.()
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(observeDisk).toHaveBeenCalledTimes(2)
    const completedAt = appended.findIndex((event) => event.type === 'run.completed')
    expect(completedAt).toBeGreaterThan(-1)
    const observed = appended.slice(completedAt + 1)
    expect(observed.map((event) => event.type)).toEqual(['tool.started', 'tool.completed'])
    expect(observed[0]?.payload).toMatchObject({ name: 'edit', command: 'src/notes.ts', status: 'observed on disk' })
    // Contiguous with the record it follows: the ledger refuses a gap.
    expect(observed[0]?.sequence).toBe(appended[completedAt]!.sequence + 1)
    expect(observed[1]?.sequence).toBe(appended[completedAt]!.sequence + 2)
  })

  it('claims nothing from the tree when another writing run shared the folder', async () => {
    // Three teammates started at once in one folder, each writing one file.
    // Every run's card then read "3 files, +124" -- the sum of all three --
    // because the observation compares the whole working tree and cannot see
    // who wrote what (drive, 2026-09-06).
    const appended: NormalizedRuntimeEvent[] = []
    const ledger = fakeLedger({ appendEvents: async (_id, events) => { appended.push(...events) } })
    // Both runs start on a clean tree; both end looking at the same changed
    // file. Which of them wrote it is exactly what cannot be known.
    let looks = 0
    const observeDisk = vi.fn(async () => {
      looks += 1
      const map = new Map<string, string>()
      if (looks > 2) map.set('src/notes.ts', ' M')
      return map
    })
    const runtimeRecords = () => records([
      { type: 'thread.started', thread_id: 'thread-live' },
      { type: 'turn.started' },
      { type: 'item.started', item: { id: 'i1', type: 'command_execution', command: 'cat README.md' } },
      { type: 'item.completed', item: { id: 'i1', type: 'command_execution', command: 'cat README.md', exit_code: 0 } },
      { type: 'turn.completed', usage: { output_tokens: 2 } }
    ])
    const start = vi.fn((_spec, _prompt, _options): RuntimeProcessRun => ({
      records: runtimeRecords(),
      completion: Promise.resolve(completion())
    })) satisfies RuntimeProcessRunner['start']
    const { service, scheduled } = scheduledService({ start }, ledger, { observeDisk })

    // Two teammates, because the service allows one live run per teammate
    // and counts "nobody" as one of them. The first draft of this test gave
    // neither a teammate, so the second start was refused, only one run ever
    // happened, and it passed with the fix REMOVED -- a green that could not
    // have gone red. Both start before either finishes: that is the point.
    const wren = { self: { teammateId: 'tm_wren', name: 'Wren', role: 'Code & Migrations' }, others: [] }
    const gem = { self: { teammateId: 'tm_gem', name: 'Gem', role: 'Research & Briefs' }, others: [] }
    const first = await service.start('write one poem', 'codex', 'accept-edits', {}, () => undefined, undefined, wren)
    const second = await service.start('write another poem', 'codex', 'accept-edits', {}, () => undefined, undefined, gem)
    // Both really started, or there is no concurrency here to test.
    expect([first.ok, second.ok]).toEqual([true, true])
    scheduled[0]?.()
    scheduled[1]?.()
    await new Promise((resolve) => setTimeout(resolve, 30))

    const observed = appended.filter((event) => (event.payload as { status?: string } | undefined)?.status === 'observed on disk')
    expect(observed).toHaveLength(0)

    // Silence would be its own lie: a run really did change something, and a
    // card reading only "5 tool calls" invites the reader to think nothing
    // was written. The folder change is reported as the folder is.
    const notices = appended.filter((event) => event.type === 'adapter.diagnostic' && (event.payload as { code?: string }).code === 'host.shared_workspace')
    expect(notices).toHaveLength(2)
    expect((notices[0]?.payload as { message?: string }).message).toMatch(/Another teammate was working in this folder/)
    expect((notices[0]?.payload as { message?: string }).message).toMatch(/1 file in the folder is different/)
    // One file, so it must read "it is not counted", never "none of them are".
    expect((notices[0]?.payload as { message?: string }).message).toMatch(/it is not counted as this run's work/)

    // The negative control, and it matters: "no observed rows" is also what a
    // broken harness produces. One run alone, same records, same snapshots --
    // this one MUST still get its row, or the assertion above proves nothing.
    const soloAppended: NormalizedRuntimeEvent[] = []
    const soloLedger = fakeLedger({ appendEvents: async (_id, events) => { soloAppended.push(...events) } })
    const solo = scheduledService({ start }, soloLedger, { observeDisk: snapshots('', ` M src/notes.ts${NUL}`) })
    await solo.service.start('write one poem', 'codex', 'accept-edits', {}, () => undefined)
    solo.scheduled[0]?.()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(
      soloAppended.filter((event) => (event.payload as { status?: string } | undefined)?.status === 'observed on disk').length
    ).toBeGreaterThan(0)
  })

  it('does not repeat a file the runtime already named, and never looks on a read-only run', async () => {
    const appended: NormalizedRuntimeEvent[] = []
    const ledger = fakeLedger({ appendEvents: async (_id, events) => { appended.push(...events) } })
    const observeDisk = snapshots('', ` M src/notes.ts${NUL}`)
    const start = vi.fn((_spec, _prompt, _options): RuntimeProcessRun => ({
      records: records([
        { type: 'thread.started', thread_id: 'thread-live' },
        { type: 'turn.started' },
        { type: 'item.started', item: { id: 'i1', type: 'command_execution', command: 'apply_patch src/notes.ts' } },
        { type: 'item.completed', item: { id: 'i1', type: 'command_execution', command: 'apply_patch src/notes.ts', exit_code: 0 } },
        { type: 'turn.completed', usage: { output_tokens: 2 } }
      ]),
      completion: Promise.resolve(completion())
    })) satisfies RuntimeProcessRunner['start']
    const { service, scheduled } = scheduledService({ start }, ledger, { observeDisk })
    await service.start('polish the notes', 'codex', 'accept-edits', {}, () => undefined)
    scheduled[0]?.()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(appended.filter((event) => event.payload && (event.payload as { status?: string }).status === 'observed on disk')).toHaveLength(0)

    const readOnly = snapshots('', ` M src/notes.ts${NUL}`)
    const again = scheduledService({ start }, fakeLedger(), { observeDisk: readOnly })
    await again.service.start('just read', 'codex', 'ask', {}, () => undefined)
    again.scheduled[0]?.()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(readOnly).not.toHaveBeenCalled()
  })
})
