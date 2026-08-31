import {
  createCodexEventNormalizer,
  createCodexExecCommand
} from '@teammate/runtime-adapters'
import type {
  CodexEventNormalizer,
  RuntimeDiscovery,
  RuntimeProcessRun,
  RuntimeProcessRunner
} from '@teammate/runtime-adapters'
import type { MissionLedger } from '@teammate/mission-store'
import { createHash, randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import type {
  CodexMissionCancelResponse,
  CodexMissionStartResponse,
  CodexMissionUpdate
} from '../shared/ipc.js'

const MAX_PROMPT_LENGTH = 8_000

interface ActiveCodexMission {
  readonly runId: string
  readonly missionId: string
  readonly controller: AbortController
  readonly normalizer: CodexEventNormalizer
  readonly process: RuntimeProcessRun
  readonly emit: (update: CodexMissionUpdate) => void
}

export interface CodexMissionService {
  start(
    prompt: unknown,
    emit: (update: CodexMissionUpdate) => void
  ): Promise<CodexMissionStartResponse>
  cancel(runId: unknown): CodexMissionCancelResponse
  interrupt(): void
  dispose(): Promise<void>
}

interface CodexMissionServiceOptions {
  readonly workspacePath: string
  readonly discover: () => Promise<readonly RuntimeDiscovery[]>
  readonly runner: RuntimeProcessRunner
  readonly ledger: MissionLedger
  readonly createId?: () => string
  readonly now?: () => Date
  readonly schedule?: (task: () => void) => void
}

function error(
  code: 'INVALID_PROMPT' | 'RUN_ALREADY_ACTIVE' | 'CODEX_UNAVAILABLE' | 'RUNTIME_START_FAILED' | 'PERSISTENCE_FAILED' | 'RUN_NOT_ACTIVE',
  message: string
): CodexMissionStartResponse | CodexMissionCancelResponse {
  return { ok: false, error: { code, message } }
}

function persistenceFailure(active: ActiveCodexMission): void {
  safelyEmit(active, {
    kind: 'persistence-error',
    runId: active.runId,
    missionId: active.missionId,
    error: {
      code: 'MISSION_PERSISTENCE_FAILED',
      message: 'The mission could not be written to the durable local ledger.'
    }
  })
}

function transportFailure(active: ActiveCodexMission): void {
  safelyEmit(active, {
    kind: 'transport-error',
    runId: active.runId,
    missionId: active.missionId,
    error: {
      code: 'RUNTIME_TRANSPORT_FAILED',
      message: 'The Codex process transport ended unexpectedly.'
    }
  })
}

async function persistTransportFailure(
  mission: ActiveCodexMission,
  ledger: MissionLedger,
  occurredAt: string
): Promise<void> {
  try {
    await ledger.appendHostFailure(mission.missionId, {
      code: 'runtime-transport-failed',
      message: 'The Codex process transport ended unexpectedly.',
      occurredAt
    })
    transportFailure(mission)
  } catch {
    persistenceFailure(mission)
  }
}

function safelyEmit(active: ActiveCodexMission, update: CodexMissionUpdate): void {
  try {
    active.emit(update)
  } catch {
    // A closed renderer must not destabilize or orphan the host process.
  }
}

async function persistAndEmit(
  active: ActiveCodexMission,
  ledger: MissionLedger,
  events: ReturnType<CodexEventNormalizer['accept']>
): Promise<void> {
  await ledger.appendEvents(active.missionId, events)
  for (const event of events) {
    safelyEmit(active, {
      kind: 'event',
      runId: active.runId,
      missionId: active.missionId,
      event
    })
  }
}

function validPrompt(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= MAX_PROMPT_LENGTH
    && !value.includes('\0')
}

function validRunId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 128
    && !value.includes('\0')
}

export function createCodexMissionService(options: CodexMissionServiceOptions): CodexMissionService {
  if (!isAbsolute(options.workspacePath)) {
    throw new Error('Codex mission workspace must be an absolute path')
  }

  const createId = options.createId ?? randomUUID
  const workspaceId = `ws_${createHash('sha256').update(options.workspacePath, 'utf8').digest('hex').slice(0, 32)}`
  const now = options.now ?? (() => new Date())
  const schedule = options.schedule ?? ((task: () => void) => {
    setImmediate(task)
  })
  let active: ActiveCodexMission | undefined
  let startingToken: symbol | undefined
  let lifecycleVersion = 0
  let disposed = false
  const startOperations = new Set<Promise<void>>()
  const consumeOperations = new Set<Promise<void>>()

  const clearActive = (candidate: ActiveCodexMission): void => {
    if (active === candidate) active = undefined
  }

  const consume = async (mission: ActiveCodexMission): Promise<void> => {
    let persistenceFailed = false
    try {
      for await (const record of mission.process.records) {
        try {
          await persistAndEmit(mission, options.ledger, mission.normalizer.accept(record))
        } catch {
          persistenceFailed = true
          mission.controller.abort()
          break
        }
      }
    } catch {
      // The completion receipt below determines whether this was a bounded-output
      // stop or an unrecoverable transport failure.
    }

    if (persistenceFailed) {
      try {
        await mission.process.completion
      } catch {
        // The durable-write failure is the authoritative outcome.
      } finally {
        // Emit only after the aborted process has fully terminated so the
        // renderer's failed state and the service's availability agree: a
        // retry submitted after this update never hits RUN_ALREADY_ACTIVE.
        persistenceFailure(mission)
        clearActive(mission)
      }
      return
    }

    let completion
    try {
      completion = await mission.process.completion
    } catch {
      await persistTransportFailure(mission, options.ledger, now().toISOString())
      clearActive(mission)
      return
    }

    let terminalEvents: ReturnType<CodexEventNormalizer['finish']>
    try {
      terminalEvents = mission.normalizer.finish(completion)
    } catch {
      await persistTransportFailure(mission, options.ledger, now().toISOString())
      clearActive(mission)
      return
    }

    try {
      await persistAndEmit(mission, options.ledger, terminalEvents)
    } catch {
      persistenceFailure(mission)
    } finally {
      clearActive(mission)
    }
  }

  const scheduleConsume = (mission: ActiveCodexMission): void => {
    let resolveOperation!: () => void
    const operation = new Promise<void>((resolve) => {
      resolveOperation = resolve
    })
    consumeOperations.add(operation)
    schedule(() => {
      void consume(mission).finally(() => {
        consumeOperations.delete(operation)
        resolveOperation()
      })
    })
  }

  return {
    async start(
      prompt: unknown,
      emit: (update: CodexMissionUpdate) => void
    ): Promise<CodexMissionStartResponse> {
      let resolveStartOperation!: () => void
      const startOperation = new Promise<void>((resolve) => {
        resolveStartOperation = resolve
      })
      startOperations.add(startOperation)
      let token: symbol | undefined
      try {
        if (disposed) {
          return error(
            'RUNTIME_START_FAILED',
            'The mission service is shutting down.'
          ) as CodexMissionStartResponse
        }
        if (!validPrompt(prompt)) {
          return error(
            'INVALID_PROMPT',
            `Enter a mission between 1 and ${MAX_PROMPT_LENGTH.toLocaleString('en-US')} characters.`
          ) as CodexMissionStartResponse
        }
        if (startingToken !== undefined || active !== undefined) {
          return error(
            'RUN_ALREADY_ACTIVE',
            'Wait for the active Codex mission to finish or cancel it first.'
          ) as CodexMissionStartResponse
        }

        token = Symbol('codex-mission-start')
        const startLifecycleVersion = lifecycleVersion
        startingToken = token
        let runtimes: readonly RuntimeDiscovery[]
        try {
          runtimes = await options.discover()
        } catch {
          return error(
            'CODEX_UNAVAILABLE',
            'Codex readiness could not be verified. Check the local runtime and try again.'
          ) as CodexMissionStartResponse
        }

        if (startLifecycleVersion !== lifecycleVersion) {
          return error(
            'RUNTIME_START_FAILED',
            'The Codex mission was stopped before launch.'
          ) as CodexMissionStartResponse
        }

        const codex = runtimes.find((runtime) => runtime.id === 'codex')
        if (
          codex?.availability !== 'available'
          || codex.readiness !== 'ready'
          || codex.executable === undefined
        ) {
          return error(
            'CODEX_UNAVAILABLE',
            'Codex is not ready. Install or sign in to the Codex CLI, then retry discovery.'
          ) as CodexMissionStartResponse
        }

        const runId = `run_${createId()}`
        const missionId = `mission_${createId()}`
        const controller = new AbortController()
        const createdAt = now().toISOString()
        const normalizer = createCodexEventNormalizer({
          runId,
          missionId,
          requestedRouteId: 'codex',
          resolvedRouteId: 'codex-account:default',
          ...(codex.version?.version === undefined ? {} : { cliVersion: codex.version.version }),
          now
        })

        try {
          await options.ledger.createMission({
            missionId,
            runId,
            prompt,
            runtime: 'codex',
            model: 'account-default',
            requestedRouteId: 'codex',
            resolvedRouteId: 'codex-account:default',
            cliVersion: codex.version?.version ?? null,
            workspaceId,
            sandbox: 'read-only',
            executionPolicyVersion: 1,
            createdAt
          })
        } catch {
          return error(
            'PERSISTENCE_FAILED',
            'The mission could not be created in the durable local ledger.'
          ) as CodexMissionStartResponse
        }

        if (startLifecycleVersion !== lifecycleVersion) {
          try {
            await options.ledger.appendHostFailure(missionId, {
              code: 'runtime-start-failed',
              message: 'The Codex mission was stopped before launch.',
              occurredAt: now().toISOString()
            })
          } catch {
            return error(
              'PERSISTENCE_FAILED',
              'The stopped mission could not be finalized in the local ledger.'
            ) as CodexMissionStartResponse
          }
          return error(
            'RUNTIME_START_FAILED',
            'The Codex mission was stopped before launch.'
          ) as CodexMissionStartResponse
        }

        let process: RuntimeProcessRun
        try {
          const command = createCodexExecCommand(codex.executable, {
            workspacePath: options.workspacePath
          })
          process = options.runner.start(command, prompt, { signal: controller.signal })
        } catch {
          try {
            await options.ledger.appendHostFailure(missionId, {
              code: 'runtime-start-failed',
              message: 'The Codex process could not be started safely.',
              occurredAt: now().toISOString()
            })
          } catch {
            return error(
              'PERSISTENCE_FAILED',
              'The failed mission could not be finalized in the local ledger.'
            ) as CodexMissionStartResponse
          }
          return error(
            'RUNTIME_START_FAILED',
            'The Codex process could not be started safely.'
          ) as CodexMissionStartResponse
        }

        const mission: ActiveCodexMission = {
          runId,
          missionId,
          controller,
          normalizer,
          process,
          emit
        }
        active = mission
        scheduleConsume(mission)

        return {
          ok: true,
          data: {
            runId,
            missionId,
            runtime: 'codex',
            model: 'account-default',
            resolvedRouteId: 'codex-account:default',
            cliVersion: codex.version?.version ?? null
          }
        }
      } finally {
        if (token !== undefined && startingToken === token) startingToken = undefined
        startOperations.delete(startOperation)
        resolveStartOperation()
      }
    },

    cancel(runId: unknown): CodexMissionCancelResponse {
      if (!validRunId(runId) || active === undefined || active.runId !== runId) {
        return error(
          'RUN_NOT_ACTIVE',
          'That Codex mission is no longer active.'
        ) as CodexMissionCancelResponse
      }
      active.controller.abort()
      return {
        ok: true,
        data: {
          runId: active.runId,
          state: 'cancellation-requested'
        }
      }
    },

    interrupt(): void {
      lifecycleVersion += 1
      startingToken = undefined
      active?.controller.abort()
    },

    async dispose(): Promise<void> {
      disposed = true
      lifecycleVersion += 1
      startingToken = undefined
      active?.controller.abort()
      await Promise.allSettled([...startOperations, ...consumeOperations])
    }
  }
}
