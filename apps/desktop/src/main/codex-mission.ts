import {
  createClaudeEventNormalizer,
  createClaudePrintCommand,
  createCodexEventNormalizer,
  createCodexExecCommand,
  createCursorEventNormalizer,
  createCursorPrintCommand
} from '@teammate/runtime-adapters'
import type {
  ClaudeEventNormalizer,
  CodexEventNormalizer,
  MissionRuntimeId,
  RuntimeDiscovery,
  RuntimeProcessRun,
  RuntimeProcessRunner
} from '@teammate/runtime-adapters'
import type { MissionContinuation, MissionLedger, RecoveredMission, Workroom, WorkroomMessage } from '@teammate/mission-store'
import type { MissionSandbox } from '@teammate/runtime-adapters'
import { createHash, randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import type {
  CodexMissionCancelResponse,
  CodexMissionStartResponse,
  CodexMissionUpdate,
  MissionHandoffResponse,
  MissionMode
} from '../shared/ipc.js'
import { composeHandoffPrompt } from './handoff.js'
import { createPeerExchange, createTranscriptTracker, publicPeerMessage } from './peer-exchange.js'
import type { PeerExchange, TranscriptTracker } from './peer-exchange.js'
import type { MissionPeerContext } from './workroom-briefing.js'
import { hostReadsEventsOf, runtimeDisplayName } from '../shared/runtimes.js'

const MAX_PROMPT_LENGTH = 8_000
/**
 * Missions run side by side now, one per teammate. The cap is a resource
 * bound, not a product rule: each live mission is a provider process holding
 * a bounded record queue and a ledger writer, and four of them is already
 * more than one person can follow.
 */
export const MAX_LIVE_MISSIONS = 4
/** Owner key for a mission that belongs to nobody; those still run one at a time. */
const NOBODY = ''

interface ActiveCodexMission {
  readonly runId: string
  readonly missionId: string
  readonly controller: AbortController
  readonly normalizer: CodexEventNormalizer | ClaudeEventNormalizer
  readonly process: RuntimeProcessRun
  readonly emit: (update: CodexMissionUpdate) => void
  /**
   * Kept so a handoff can brief the next runtime. The ledger holds this too,
   * but re-reading the file to find out what the user asked for would make a
   * switch depend on a disk read that can fail after the run is already gone.
   */
  readonly prompt: string
  readonly runtime: MissionRuntimeId
  /** Who this mission belongs to and who it may share with; absent for a mission of nobody's. */
  readonly peer: MissionPeerContext | undefined
  /** Assistant text as the transcript rebuilt it, read for share blocks at the end. */
  readonly transcript: TranscriptTracker
}

export interface CodexMissionService {
  start(
    prompt: unknown,
    runtime: MissionRuntimeId,
    mode: MissionMode,
    route: { readonly model?: string; readonly effort?: string },
    emit: (update: CodexMissionUpdate) => void,
    /**
     * Only `handOff` supplies this. It is not reachable from the renderer: the
     * start channel builds its own argument list and has no field for it, so a
     * mission cannot claim to continue another just by asking.
     */
    continuation?: MissionContinuation,
    /**
     * The teammate the mission is messaged to. Only the host supplies it,
     * from the roster it read itself: the renderer names a teammate id and
     * the host decides whether that id is anyone.
     */
    peer?: MissionPeerContext,
    /** The mission whose conversation this one continues, if any. */
    followUpOf?: string
  ): Promise<CodexMissionStartResponse>
  cancel(runId: unknown): CodexMissionCancelResponse
  handOff(
    runId: unknown,
    runtime: MissionRuntimeId,
    mode: MissionMode,
    route: { readonly model?: string; readonly effort?: string },
    emit: (update: CodexMissionUpdate) => void
  ): Promise<MissionHandoffResponse>
  /** Whether this transport owns a live run of that mission. */
  hasMission(missionId: string): boolean
  /** The missions this transport is running right now. */
  liveMissionIds(): readonly string[]
  interrupt(): void
  dispose(): Promise<void>
}

interface CodexMissionServiceOptions {
  readonly workspacePath: string
  readonly discover: () => Promise<readonly RuntimeDiscovery[]>
  readonly runner: RuntimeProcessRunner
  readonly ledger: MissionLedger
  /** The teammate channel. Optional: a service without one runs missions that belong to nobody. */
  readonly workroom?: Workroom
  readonly createId?: () => string
  readonly now?: () => Date
  readonly schedule?: (task: () => void) => void
}

function error(
  code: 'INVALID_PROMPT' | 'RUN_ALREADY_ACTIVE' | 'CODEX_UNAVAILABLE' | 'RUNTIME_START_FAILED' | 'PERSISTENCE_FAILED' | 'RUN_NOT_ACTIVE' | 'HANDOFF_REFUSED',
  message: string
): CodexMissionStartResponse | CodexMissionCancelResponse | MissionHandoffResponse {
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
  // Tracked only once durable, so what a share is read from is what the
  // ledger holds.
  active.transcript.track(events)
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

/**
 * The runtime's own handle for a finished mission's conversation, from its own
 * records. `run.started` states it at the beginning and the terminal events
 * repeat it; the last one that carries it wins, since a resumed session can
 * report a new id.
 */
export function runtimeThreadIdOf(mission: RecoveredMission): string | undefined {
  let held: string | undefined
  for (const event of mission.events) {
    const payload = event.payload as { readonly runtimeThreadId?: unknown }
    if (typeof payload.runtimeThreadId === 'string' && payload.runtimeThreadId.length > 0) {
      held = payload.runtimeThreadId
    }
  }
  return held
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
  /** Live missions by runId. */
  const active = new Map<string, ActiveCodexMission>()
  /** Owners with a start in flight, between the guard and activation. */
  const starting = new Set<string>()
  /** Each live mission's consume loop, so a handoff can wait for ITS run alone. */
  const settling = new Map<string, Promise<void>>()
  let lifecycleVersion = 0
  let disposed = false
  const interruptedMissionIds = new Set<string>()
  const startOperations = new Set<Promise<void>>()
  const consumeOperations = new Set<Promise<void>>()
  const ownerKeyOf = (peer: MissionPeerContext | undefined): string => peer?.self.teammateId ?? NOBODY
  const peerExchange: PeerExchange | undefined =
    options.workroom === undefined
      ? undefined
      : createPeerExchange({ workroom: options.workroom, ledger: options.ledger })

  const clearActive = (candidate: ActiveCodexMission): void => {
    if (active.get(candidate.runId) === candidate) active.delete(candidate.runId)
  }

  const consume = async (mission: ActiveCodexMission): Promise<void> => {
    let persistenceFailed = false
    try {
      for await (const record of mission.process.records) {
        try {
          // Take everything already buffered along with this record and
          // persist it as ONE durable append. Each append costs an fsync, and
          // paying that per provider record lets the runner's bounded queue
          // fill while we wait -- a full queue ends the run as an output-limit
          // breach, so a verbose mission would be killed for being verbose.
          // Ordering and persist-before-emit are unchanged: the batch is
          // written before any of its events reach the renderer.
          // Defensive: a stream from a source that does not implement draining
          // must degrade to one record per append, not throw -- a TypeError
          // here would be caught below and reported as a persistence failure,
          // which is a misleading thing to tell a user about a working ledger.
          const buffered = typeof mission.process.records.drainAvailable === 'function'
            ? mission.process.records.drainAvailable()
            : []
          const batch = [record, ...buffered]
          const events = batch.flatMap((entry) => [...mission.normalizer.accept(entry)])
          await persistAndEmit(mission, options.ledger, events)
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
      clearActive(mission)
      return
    }

    // Share only from a run that finished on its own terms, and before the
    // slot is released: a handoff waits on this loop, so it never reconciles
    // a mission whose findings are still being posted.
    if (mission.transcript.completed && mission.peer !== undefined && peerExchange !== undefined) {
      const text = mission.transcript.latestFinal
      if (text !== undefined) {
        await peerExchange.share(
          { runId: mission.runId, missionId: mission.missionId, peer: mission.peer, text },
          (update) => safelyEmit(mission, update)
        )
      }
    }
    clearActive(mission)
  }

  const scheduleConsume = (mission: ActiveCodexMission): void => {
    let resolveOperation!: () => void
    const operation = new Promise<void>((resolve) => {
      resolveOperation = resolve
    })
    consumeOperations.add(operation)
    settling.set(mission.runId, operation)
    schedule(() => {
      void consume(mission).finally(() => {
        consumeOperations.delete(operation)
        settling.delete(mission.runId)
        resolveOperation()
      })
    })
  }

  const service: CodexMissionService = {
    async start(
      prompt: unknown,
      runtime: MissionRuntimeId,
      mode: MissionMode,
      route: { readonly model?: string; readonly effort?: string },
      emit: (update: CodexMissionUpdate) => void,
      continuation?: MissionContinuation,
      peer?: MissionPeerContext,
      followUpOf?: string
    ): Promise<CodexMissionStartResponse> {
      // `account-default` is the shell's word for "send no --model", not a
      // model id. Passing it through would make the CLI look for a model that
      // does not exist.
      const chosenModel =
        route.model === undefined || route.model === 'account-default' ? undefined : route.model
      // Read-only unless the renderer explicitly asked for edits. The host
      // decides the sandbox from this one value; the renderer never passes a
      // sandbox string of its own.
      const sandbox: MissionSandbox = mode === 'accept-edits' ? 'workspace-write' : 'read-only'
      let resolveStartOperation!: () => void
      const startOperation = new Promise<void>((resolve) => {
        resolveStartOperation = resolve
      })
      startOperations.add(startOperation)
      const owner = ownerKeyOf(peer)
      let claimed = false
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
        // One live mission per teammate: a teammate is one identity doing one
        // piece of work, and two runs sharing a name would share a workroom
        // voice. Missions of nobody keep the old rule and run one at a time.
        const ownerBusy =
          starting.has(owner) || [...active.values()].some((mission) => ownerKeyOf(mission.peer) === owner)
        if (ownerBusy) {
          return error(
            'RUN_ALREADY_ACTIVE',
            peer === undefined
              ? 'Wait for the active Codex mission to finish or cancel it first.'
              : `${peer.self.name} already has a mission running. Wait for it to finish or stop it first.`
          ) as CodexMissionStartResponse
        }
        if (starting.size + active.size >= MAX_LIVE_MISSIONS) {
          return error(
            'RUN_ALREADY_ACTIVE',
            `Up to ${MAX_LIVE_MISSIONS} missions can run at once. Wait for one to finish or stop it first.`
          ) as CodexMissionStartResponse
        }

        const startLifecycleVersion = lifecycleVersion
        starting.add(owner)
        claimed = true
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

        const chosen = runtimes.find((entry) => entry.id === runtime)
        if (
          chosen?.availability !== 'available'
          || chosen.readiness !== 'ready'
          || chosen.executable === undefined
        ) {
          return error(
            'CODEX_UNAVAILABLE',
            `${runtimeDisplayName(runtime)} is not ready. Install or sign in to it, then retry discovery.`
          ) as CodexMissionStartResponse
        }
        if (!hostReadsEventsOf(runtime)) {
          return error(
            'RUNTIME_START_FAILED',
            `${runtimeDisplayName(runtime)} is installed and signed in, but Locust cannot read its event stream yet. Choose Codex CLI or Claude Code for this mission.`
          ) as CodexMissionStartResponse
        }

        // A reply resumes the earlier mission's own session. The handle comes
        // from the durable record of THAT mission, never from the renderer:
        // the renderer names a mission, and the host decides what that means.
        let resumeThreadId: string | undefined
        let resumedMissionId: string | undefined
        if (followUpOf !== undefined) {
          const prior = await options.ledger.getMission(followUpOf).catch(() => undefined)
          const priorThread = prior === undefined ? undefined : runtimeThreadIdOf(prior)
          if (prior === undefined || priorThread === undefined) {
            return error(
              'RUNTIME_START_FAILED',
              'That conversation cannot be continued: the earlier mission did not record a session to resume.'
            ) as CodexMissionStartResponse
          }
          if (prior.metadata.runtime !== runtime) {
            // Resuming across runtimes is a handoff, and that has its own path
            // with a checkpoint and a briefing. Silently starting blank here
            // would look like a reply and behave like a stranger.
            return error(
              'RUNTIME_START_FAILED',
              `That conversation belongs to ${runtimeDisplayName(prior.metadata.runtime)}. Switch the route back, or hand the mission over instead.`
            ) as CodexMissionStartResponse
          }
          resumeThreadId = priorThread
          resumedMissionId = prior.metadata.missionId
        }

        const runId = `run_${createId()}`
        const missionId = `mission_${createId()}`
        const controller = new AbortController()
        const createdAt = now().toISOString()
        const routeId = runtime === 'claude' ? 'claude' : 'codex'
        // ONE definition of what this run may touch, computed before anything
        // records it. Codex and Cursor take a sandbox; Claude Code does not, so a Claude run is
        // restricted whatever the composer asked for -- and the durable header
        // and the receipt must agree about that, or the ledger claims a run
        // could write when it could not.
        const effectiveSandbox: MissionSandbox = runtime === 'claude' ? 'read-only' : sandbox
        const resolvedRouteId = `${routeId}-account:default`
        const normalizerContext = {
          runId,
          missionId,
          requestedRouteId: routeId,
          resolvedRouteId,
          ...(chosen.version?.version === undefined ? {} : { cliVersion: chosen.version.version }),
          now
        }
        const normalizer = runtime === 'claude'
          ? createClaudeEventNormalizer(normalizerContext)
          : runtime === 'cursor'
            ? createCursorEventNormalizer(normalizerContext)
            : createCodexEventNormalizer(normalizerContext)

        // What the runtime is SENT is the person's words plus their teammates'
        // waiting messages and the share form. The ledger keeps the person's
        // words as the prompt and the delivered messages by id; the rest is
        // deterministic over those.
        let runtimePrompt = prompt
        let delivered: readonly WorkroomMessage[] = []
        let peerDeliveryFailed = false
        if (peer !== undefined && peerExchange !== undefined) {
          const prepared = await peerExchange.prepare(prompt, peer)
          runtimePrompt = prepared.runtimePrompt
          delivered = prepared.delivered
          peerDeliveryFailed = prepared.failed
        }

        try {
          await options.ledger.createMission({
            missionId,
            runId,
            prompt,
            runtime,
            model: chosenModel ?? 'account-default',
            requestedRouteId: routeId,
            resolvedRouteId,
            cliVersion: chosen.version?.version ?? null,
            workspaceId,
            sandbox: effectiveSandbox,
            executionPolicyVersion: 1,
            createdAt,
            ...(continuation === undefined
              ? resumedMissionId === undefined || resumeThreadId === undefined
                ? {}
                : {
                    continuesFrom: {
                      missionId: resumedMissionId,
                      // Follow-ups do not reconcile: nothing stopped, so there
                      // is no checkpoint to point at. Epoch 1 is the mission's
                      // own first, which is the only one a reader could mean.
                      checkpointEpoch: 1,
                      reason: 'follow-up' as const,
                      runtimeThreadId: resumeThreadId
                    }
                  }
              : { continuesFrom: continuation })
          })
        } catch {
          return error(
            'PERSISTENCE_FAILED',
            'The mission could not be created in the durable local ledger.'
          ) as CodexMissionStartResponse
        }

        // Recorded BEFORE the process starts: a mission must not run on
        // messages its own record cannot name.
        if (peerExchange !== undefined && delivered.length > 0) {
          try {
            await peerExchange.recordReceived(missionId, delivered, createdAt)
          } catch {
            await options.ledger.appendHostFailure(missionId, {
              code: 'runtime-start-failed',
              message: 'The messages this mission was shown could not be recorded in the local ledger.',
              occurredAt: now().toISOString()
            }).catch(() => undefined)
            return error(
              'PERSISTENCE_FAILED',
              'The messages this mission was shown could not be recorded in the durable local ledger.'
            ) as CodexMissionStartResponse
          }
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
          // Claude's print command carries its own restricted argv; only Codex
          // takes a sandbox flag, so write mode is a Codex capability today and
          // a Claude mission stays read-only whatever the composer said.
          // Model and effort go to whichever runtime runs. Effort is only ever
          // one the catalog reported for that model; the builder refuses
          // anything but a plain word regardless.
          const chosenEffort = route.effort
          const choice = {
            ...(chosenModel === undefined ? {} : { model: chosenModel }),
            ...(chosenEffort === undefined ? {} : { effort: chosenEffort }),
            ...(resumeThreadId === undefined ? {} : { resumeThreadId })
          }
          const command = runtime === 'claude'
            ? createClaudePrintCommand(chosen.executable, { workspacePath: options.workspacePath, ...choice })
            : runtime === 'cursor'
              ? createCursorPrintCommand(chosen.executable, {
                  workspacePath: options.workspacePath,
                  sandbox: effectiveSandbox,
                  ...choice
                })
              : createCodexExecCommand(chosen.executable, {
                  workspacePath: options.workspacePath,
                  sandbox: effectiveSandbox,
                  ...choice
                })
          process = options.runner.start(command, runtimePrompt, { signal: controller.signal })
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
          emit,
          prompt,
          runtime,
          peer,
          transcript: createTranscriptTracker()
        }
        active.set(runId, mission)
        scheduleConsume(mission)

        // Marked delivered only now that the run is live, so a start that
        // failed above never consumed anything.
        if (peerExchange !== undefined) await peerExchange.markDelivered(missionId, delivered)

        return {
          ok: true,
          data: {
            runId,
            missionId,
            runtime,
            model: chosenModel ?? 'account-default',
            resolvedRouteId,
            cliVersion: chosen.version?.version ?? null,
            sandbox: effectiveSandbox,
            peerMessages: delivered.map((message) => publicPeerMessage(message, 'received')),
            peerDeliveryFailed,
            ...(resumedMissionId === undefined || resumeThreadId === undefined
              ? {}
              : { followsUp: { missionId: resumedMissionId, runtimeThreadId: resumeThreadId } })
          }
        }
      } finally {
        if (claimed) starting.delete(owner)
        startOperations.delete(startOperation)
        resolveStartOperation()
      }
    },

    cancel(runId: unknown): CodexMissionCancelResponse {
      const mission = validRunId(runId) ? active.get(runId) : undefined
      if (mission === undefined) {
        return error(
          'RUN_NOT_ACTIVE',
          'That Codex mission is no longer active.'
        ) as CodexMissionCancelResponse
      }
      mission.controller.abort()
      return {
        ok: true,
        data: {
          runId: mission.runId,
          state: 'cancellation-requested'
        }
      }
    },

    async handOff(
      runId: unknown,
      runtime: MissionRuntimeId,
      mode: MissionMode,
      route: { readonly model?: string; readonly effort?: string },
      emit: (update: CodexMissionUpdate) => void
    ): Promise<MissionHandoffResponse> {
      const previous = validRunId(runId) ? active.get(runId) : undefined
      if (previous === undefined) {
        return error(
          'RUN_NOT_ACTIVE',
          'That mission is no longer active, so there is nothing to hand off.'
        ) as MissionHandoffResponse
      }
      // Refuse a handoff to the runtime already running it. Stopping a run to
      // restart it on the same route would cost the user their progress and
      // buy nothing, and it is much more likely to be a misclick than a wish.
      if (previous.runtime === runtime) {
        return error(
          'HANDOFF_REFUSED',
          'That mission is already on this runtime. Nothing was changed.'
        ) as MissionHandoffResponse
      }

      const fromMissionId = previous.missionId
      const fromRuntime = runtimeDisplayName(previous.runtime)
      const originalPrompt = previous.prompt

      // Stop the run, then WAIT for its own records to settle before
      // reconciling. Checkpointing a still-draining mission would race the
      // consume loop and report actions as unsettled that were about to
      // report back -- the checkpoint would be pessimistic, and the briefing
      // would tell the next runtime to re-verify work that had finished.
      // THIS run's loop only. Other teammates' missions keep going, and a
      // handoff that waited for them would stall until strangers finished.
      previous.controller.abort()
      await settling.get(previous.runId)

      let checkpoint
      try {
        checkpoint = await options.ledger.createCheckpoint(fromMissionId, 'route-switch')
      } catch {
        return error(
          'HANDOFF_REFUSED',
          'The mission was stopped, but it could not be reconciled, so nothing was handed off.'
        ) as MissionHandoffResponse
      }

      // `unsafe` means the ledger itself is damaged: the checkpoint was not
      // even written. A briefing built from a record that cannot be trusted
      // would carry that damage into a fresh run under a confident heading.
      if (checkpoint.resumeSafety === 'unsafe') {
        return error(
          'HANDOFF_REFUSED',
          `The mission was stopped, but it could not be handed off safely: ${checkpoint.safetyReason}`
        ) as MissionHandoffResponse
      }

      const briefing = composeHandoffPrompt(originalPrompt, checkpoint, fromRuntime)
      if (briefing === undefined) {
        return error(
          'HANDOFF_REFUSED',
          'The mission was stopped, but its original request is too long to carry to another runtime.'
        ) as MissionHandoffResponse
      }

      // The continuation stays the same teammate's mission: it keeps the
      // roster, receives what is waiting, and shares under the same name.
      const started = await service.start(briefing.prompt, runtime, mode, route, emit, {
        missionId: fromMissionId,
        checkpointEpoch: checkpoint.epoch,
        reason: 'route-switch'
      }, previous.peer)
      if (!started.ok) {
        // Pass the start failure through unchanged but keep the stop visible:
        // the user asked for a switch and now has neither run.
        return {
          ok: false,
          error: {
            code: started.error.code,
            message: `The mission was stopped for the handoff, but the new run did not start. ${started.error.message}`
          }
        }
      }

      return {
        ok: true,
        data: {
          ...started.data,
          continuesFrom: { missionId: fromMissionId, checkpointEpoch: checkpoint.epoch },
          resumeSafety: checkpoint.resumeSafety,
          omittedBriefing: briefing.omitted,
          unsettledCount: checkpoint.unsettledActions.length
        }
      }
    },

    hasMission(missionId: string): boolean {
      return [...active.values()].some((mission) => mission.missionId === missionId)
    },

    liveMissionIds(): readonly string[] {
      return [...active.values()].map((mission) => mission.missionId)
    },

    interrupt(): void {
      lifecycleVersion += 1
      starting.clear()
      // Remember which missions the host cut short. `interrupt()` is
      // synchronous and the consume loops clear `active` once each aborted
      // process settles, so by the time `dispose()` can await a durable write
      // there is nothing left to name -- the ids are captured here or not at all.
      for (const mission of active.values()) {
        interruptedMissionIds.add(mission.missionId)
        mission.controller.abort()
      }
    },

    async dispose(): Promise<void> {
      disposed = true
      lifecycleVersion += 1
      starting.clear()
      for (const mission of active.values()) {
        interruptedMissionIds.add(mission.missionId)
        mission.controller.abort()
      }
      await Promise.allSettled([...startOperations, ...consumeOperations])
      for (const missionId of interruptedMissionIds) {
        try {
          // Reconcile AFTER each run's own records have settled, so the
          // checkpoint describes the finished ledger rather than racing it. On
          // the next launch this is what says which actions were left in doubt.
          await options.ledger.createCheckpoint(missionId, 'shutdown')
        } catch {
          // Best effort by design. A mission that cannot be checkpointed still
          // recovers from its events, and refusing to shut down over a
          // bookkeeping write would be a worse failure than the missing record.
        }
      }
    }
  }

  return service
}
