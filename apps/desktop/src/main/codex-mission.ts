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
import { randomUUID } from 'node:crypto'
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
  dispose(): void
}

interface CodexMissionServiceOptions {
  readonly workspacePath: string
  readonly discover: () => Promise<readonly RuntimeDiscovery[]>
  readonly runner: RuntimeProcessRunner
  readonly createId?: () => string
  readonly now?: () => Date
  readonly schedule?: (task: () => void) => void
}

function error(
  code: 'INVALID_PROMPT' | 'RUN_ALREADY_ACTIVE' | 'CODEX_UNAVAILABLE' | 'RUNTIME_START_FAILED' | 'RUN_NOT_ACTIVE',
  message: string
): CodexMissionStartResponse | CodexMissionCancelResponse {
  return { ok: false, error: { code, message } }
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

function safelyEmit(active: ActiveCodexMission, update: CodexMissionUpdate): void {
  try {
    active.emit(update)
  } catch {
    // A closed renderer must not destabilize or orphan the host process.
  }
}

function emitNormalized(active: ActiveCodexMission, events: ReturnType<CodexEventNormalizer['accept']>): void {
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
  const now = options.now ?? (() => new Date())
  const schedule = options.schedule ?? ((task: () => void) => {
    setImmediate(task)
  })
  let active: ActiveCodexMission | undefined
  let startingToken: symbol | undefined
  let lifecycleVersion = 0

  const clearActive = (candidate: ActiveCodexMission): void => {
    if (active === candidate) active = undefined
  }

  const consume = async (mission: ActiveCodexMission): Promise<void> => {
    try {
      for await (const record of mission.process.records) {
        emitNormalized(mission, mission.normalizer.accept(record))
      }
    } catch {
      // The completion receipt below determines whether this was a bounded-output
      // stop or an unrecoverable transport failure.
    }

    try {
      const completion = await mission.process.completion
      emitNormalized(mission, mission.normalizer.finish(completion))
    } catch {
      transportFailure(mission)
    } finally {
      clearActive(mission)
    }
  }

  return {
    async start(
      prompt: unknown,
      emit: (update: CodexMissionUpdate) => void
    ): Promise<CodexMissionStartResponse> {
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

      const token = Symbol('codex-mission-start')
      const startLifecycleVersion = lifecycleVersion
      startingToken = token
      try {
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
        const normalizer = createCodexEventNormalizer({
          runId,
          missionId,
          requestedRouteId: 'codex',
          resolvedRouteId: 'codex-account:default',
          ...(codex.version?.version === undefined ? {} : { cliVersion: codex.version.version }),
          now
        })

        let process: RuntimeProcessRun
        try {
          const command = createCodexExecCommand(codex.executable, {
            workspacePath: options.workspacePath
          })
          process = options.runner.start(command, prompt, { signal: controller.signal })
        } catch {
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
        schedule(() => {
          void consume(mission)
        })

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
        if (startingToken === token) startingToken = undefined
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

    dispose(): void {
      lifecycleVersion += 1
      startingToken = undefined
      active?.controller.abort()
    }
  }
}
