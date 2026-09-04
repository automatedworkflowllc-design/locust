import { workspaceIdFor } from './workspace.js'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'

import type { MissionLedger, Workroom, WorkroomMessage } from '@teammate/mission-store'
import { createAntigravityEventNormalizer } from '@teammate/runtime-adapters'
import type { NormalizedRuntimeEvent, RuntimeProcessCompletion } from '@teammate/runtime-adapters'

import type { CodexMissionUpdate, PublicPeerMessage } from '../shared/ipc.js'
import { createAgentApi, projectIdFor, transcriptPathFor } from './antigravity-host.js'
import type { AgentApi, AntigravityHost } from './antigravity-host.js'
import { runtimeThreadIdOf } from './codex-mission.js'
import { createPeerExchange, createTranscriptTracker, publicPeerMessage } from './peer-exchange.js'
import type { PeerExchange, TranscriptTracker } from './peer-exchange.js'
import type { EndedMission, RelayOrigin, SharingMission } from './relay.js'
import type { MissionPeerContext } from './workroom-briefing.js'

/**
 * Missions under Antigravity, EXPERIMENTAL.
 *
 * The other transports own a process and read its stdout. Antigravity's agent
 * runs inside Antigravity itself; the host can only start a conversation,
 * send into it, and watch the transcript file the app appends as steps
 * finish. So this service is a poller: every second it re-reads the
 * transcript, hands the new lines to the normalizer, and persists whatever
 * comes out -- the same receipts, the same ledger, the same thread. The
 * run is over when the agent's last step is an answer with no tool calls
 * (a heuristic measured on real conversations, see the normalizer), or when
 * nothing new has appeared for long enough that waiting is lying.
 *
 * Two limits are structural and said in the UI: it works only while
 * Antigravity is open with the mission's folder, and it cannot be held
 * read-only -- the agent runs its own tools under its own policy.
 */

export const ANTIGRAVITY_TIERS = ['flash', 'pro', 'flash_lite'] as const
export type AntigravityTier = (typeof ANTIGRAVITY_TIERS)[number]
export const MAX_LIVE_ANTIGRAVITY_MISSIONS = 4
/** No new transcript line for this long means the agent is not coming back. */
export const ANTIGRAVITY_IDLE_TIMEOUT_MS = 10 * 60_000
const NOBODY = ''

export interface AntigravityMissionOptions {
  readonly workspacePath: string
  readonly ledger: MissionLedger
  readonly workroom?: Workroom
  readonly probe: () => Promise<AntigravityHost | undefined>
  readonly emitEvent: (runId: string, missionId: string, event: unknown) => void
  readonly emitUpdate?: (update: CodexMissionUpdate) => void
  readonly onShared?: (mission: SharingMission, posted: readonly WorkroomMessage[]) => Promise<void>
  readonly onRunEnded?: (mission: EndedMission) => Promise<void>
  /** Test seams. */
  readonly agentApi?: (host: AntigravityHost) => AgentApi
  readonly readTranscript?: (path: string) => Promise<string | undefined>
  readonly home?: string
  readonly createId?: () => string
  readonly now?: () => Date
  readonly pollMs?: number
  readonly idleTimeoutMs?: number
}

export interface AntigravityMission {
  readonly runId: string
  readonly missionId: string
  readonly conversationId: string
  readonly model: AntigravityTier
  readonly cliVersion: string | null
  readonly peerMessages: readonly PublicPeerMessage[]
  readonly peerDeliveryFailed: boolean
  readonly followsUp?: { readonly missionId: string; readonly runtimeThreadId: string }
}

export interface AntigravityMissionService {
  start(
    prompt: string,
    peer: MissionPeerContext | undefined,
    route: { readonly model?: string; readonly followUpOf?: string; readonly relay?: RelayOrigin }
  ): Promise<AntigravityMission>
  cancel(runId: string): boolean
  has(runId: string): boolean
  hasMission(missionId: string): boolean
  liveMissionIds(): readonly string[]
  dispose(): Promise<void>
}

export class AntigravityStartError extends Error {}

/** The tier a chosen model maps to. `account-default` and anything unknown is flash. */
export function antigravityTier(model: string | undefined): AntigravityTier {
  return (ANTIGRAVITY_TIERS as readonly string[]).includes(model ?? '') ? (model as AntigravityTier) : 'flash'
}

async function readTranscriptFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return undefined
  }
}

export function createAntigravityMissionService(options: AntigravityMissionOptions): AntigravityMissionService {
  const createId = options.createId ?? randomUUID
  const now = options.now ?? (() => new Date())
  const home = options.home ?? homedir()
  const readTranscript = options.readTranscript ?? readTranscriptFile
  const pollMs = options.pollMs ?? 1_000
  const idleTimeoutMs = options.idleTimeoutMs ?? ANTIGRAVITY_IDLE_TIMEOUT_MS
  const peerExchange: PeerExchange | undefined =
    options.workroom === undefined ? undefined : createPeerExchange({ workroom: options.workroom, ledger: options.ledger })
  const ownerKeyOf = (peer: MissionPeerContext | undefined): string => peer?.self.teammateId ?? NOBODY

  interface LiveRun {
    readonly runId: string
    readonly missionId: string
    readonly conversationId: string
    readonly model: AntigravityTier
    readonly peer: MissionPeerContext | undefined
    readonly relay: RelayOrigin | undefined
    readonly transcript: TranscriptTracker
    readonly normalizer: ReturnType<typeof createAntigravityEventNormalizer>
    readonly transcriptPath: string
    readonly startedAt: string
    /** Lines already handed to the normalizer; a follow-up starts past the prior turns. */
    fed: number
    lastProgressAt: number
    timer: NodeJS.Timeout | undefined
    polling: boolean
    ended: boolean
  }

  const runs = new Map<string, LiveRun>()
  const starting = new Set<string>()
  let disposed = false

  const persistAndEmit = async (run: LiveRun, events: readonly NormalizedRuntimeEvent[]): Promise<void> => {
    if (events.length === 0) return
    // Persist-before-emit, as every transport here does: a receipt the person
    // has seen is already on disk.
    await options.ledger.appendEvents(run.missionId, events as never)
    run.transcript.track(events)
    for (const event of events) options.emitEvent(run.runId, run.missionId, event)
  }

  const completion = (run: LiveRun, input: { cancelled?: boolean; stderr?: string }): RuntimeProcessCompletion => ({
    // No process, so no exit code: the normalizer decides completed versus
    // failed from whether the agent's last step was an answer.
    exitCode: null,
    signal: null,
    stderr: input.stderr ?? '',
    stderrTruncated: false,
    recordCount: run.fed,
    cancelled: input.cancelled === true,
    forcedTerminationAttempted: false,
    terminationUnconfirmed: false,
    inputDeliveryFailed: false,
    outputLimitExceeded: false,
    startedAt: run.startedAt,
    finishedAt: now().toISOString()
  })

  const end = async (run: LiveRun, input: { cancelled?: boolean; stderr?: string }): Promise<void> => {
    if (run.ended) return
    run.ended = true
    if (run.timer !== undefined) clearInterval(run.timer)
    runs.delete(run.runId)
    try {
      await persistAndEmit(run, run.normalizer.finish(completion(run, input)))
    } catch {
      // The ledger refused the receipt; the run is still over. The renderer
      // learns from the absence of further events, and recovery on next
      // launch reports the mission as interrupted, which is the truth.
    }
    // Share only from a run that finished on its own terms, exactly as the
    // exec path does, and tell the relay what was posted.
    if (input.cancelled !== true && run.transcript.completed && run.peer !== undefined && peerExchange !== undefined) {
      const text = run.transcript.latestFinal
      if (text !== undefined) {
        try {
          const posted = await peerExchange.share(
            { runId: run.runId, missionId: run.missionId, peer: run.peer, text },
            (update) => options.emitUpdate?.(update)
          )
          if (posted.length > 0 && options.onShared !== undefined) {
            await options.onShared(
              {
                runId: run.runId,
                missionId: run.missionId,
                runtime: 'antigravity',
                sandbox: 'workspace-write',
                model: run.model,
                peer: run.peer,
                relay: run.relay
              },
              posted
            )
          }
        } catch {
          // Said by the share's own report; never fails the run.
        }
      }
    }
    if (options.onRunEnded !== undefined) {
      void options.onRunEnded({ missionId: run.missionId, peer: run.peer, relay: run.relay }).catch(() => undefined)
    }
  }

  const poll = async (run: LiveRun): Promise<void> => {
    if (run.polling || run.ended) return
    run.polling = true
    try {
      const text = await readTranscript(run.transcriptPath)
      const lines = text === undefined ? [] : text.split('\n').filter((line) => line.trim().length > 0)
      const fresh: NormalizedRuntimeEvent[] = []
      for (let index = run.fed; index < lines.length; index += 1) {
        fresh.push(...run.normalizer.accept({ sequence: index + 1, raw: lines[index]! }))
      }
      if (lines.length > run.fed) {
        run.fed = lines.length
        run.lastProgressAt = Date.now()
      }
      if (fresh.length > 0) await persistAndEmit(run, fresh)
      if (run.normalizer.latestFinal) {
        await end(run, {})
        return
      }
      if (Date.now() - run.lastProgressAt > idleTimeoutMs) {
        await end(run, { stderr: `Antigravity's agent wrote nothing to its transcript for ${String(Math.round(idleTimeoutMs / 60_000))} minutes.` })
      }
    } catch {
      // A transient read failure is retried on the next tick.
    } finally {
      run.polling = false
    }
  }

  return {
    has: (runId) => runs.has(runId),
    hasMission: (missionId) => [...runs.values()].some((run) => run.missionId === missionId),
    liveMissionIds: () => [...runs.values()].map((run) => run.missionId),

    async start(prompt, peer, route) {
      if (disposed) throw new AntigravityStartError('The mission service is shutting down.')
      const owner = ownerKeyOf(peer)
      if (starting.has(owner) || [...runs.values()].some((run) => ownerKeyOf(run.peer) === owner)) {
        throw new AntigravityStartError(
          peer === undefined ? 'A mission is already running.' : `${peer.self.name} already has a mission running. Wait for it to finish or stop it first.`
        )
      }
      if (starting.size + runs.size >= MAX_LIVE_ANTIGRAVITY_MISSIONS) {
        throw new AntigravityStartError(`Up to ${String(MAX_LIVE_ANTIGRAVITY_MISSIONS)} Antigravity missions can run at once.`)
      }
      starting.add(owner)
      try {
        const host = await options.probe()
        if (host === undefined) {
          throw new AntigravityStartError('Antigravity is not open. Open it with this folder, then try again.')
        }
        const projectId = projectIdFor(host, options.workspacePath)
        if (projectId === undefined) {
          throw new AntigravityStartError(
            `Antigravity has not opened ${options.workspacePath}. Open that folder in Antigravity first; this route only works inside a folder it knows.`
          )
        }
        const model = antigravityTier(route.model)
        const api = (options.agentApi ?? createAgentApi)(host)

        // A reply continues the conversation the earlier mission opened.
        let priorConversation: { readonly missionId: string; readonly runtimeThreadId: string } | undefined
        if (route.followUpOf !== undefined) {
          const prior = await options.ledger.getMission(route.followUpOf).catch(() => undefined)
          const threadId = prior === undefined ? undefined : runtimeThreadIdOf(prior)
          if (prior === undefined || threadId === undefined) {
            throw new AntigravityStartError('That conversation cannot be continued: the earlier mission did not record a conversation to resume.')
          }
          if (prior.metadata.runtime !== 'antigravity') {
            throw new AntigravityStartError('That conversation belongs to another runtime. Switch the route back, or start a new mission.')
          }
          priorConversation = { missionId: prior.metadata.missionId, runtimeThreadId: threadId }
        }

        const runId = `run_${createId()}`
        const missionId = `mission_${createId()}`
        const createdAt = now().toISOString()
        let runtimePrompt = prompt
        let delivered: readonly WorkroomMessage[] = []
        let peerDeliveryFailed = false
        if (peer !== undefined && peerExchange !== undefined) {
          const prepared = await peerExchange.prepare(prompt, peer)
          runtimePrompt = prepared.runtimePrompt
          delivered = prepared.delivered
          peerDeliveryFailed = prepared.failed
        }

        // The conversation is opened BEFORE the record so a refusal from
        // Antigravity leaves nothing behind; a follow-up must know how far the
        // transcript already reaches before it sends, or it would replay the
        // earlier turns as this one's.
        let conversationId: string
        let fed = 0
        if (priorConversation === undefined) {
          conversationId = await api.newConversation({
            projectId,
            model,
            title: prompt.replace(/\s+/g, ' ').trim().slice(0, 60) || 'Locust mission',
            prompt: runtimePrompt
          })
        } else {
          conversationId = priorConversation.runtimeThreadId
          const existing = await readTranscript(transcriptPathFor(home, conversationId))
          fed = existing === undefined ? 0 : existing.split('\n').filter((line) => line.trim().length > 0).length
          await api.sendMessage({ projectId, conversationId, content: runtimePrompt })
        }

        await options.ledger.createMission({
          missionId,
          runId,
          prompt,
          runtime: 'antigravity',
          model,
          requestedRouteId: 'antigravity',
          resolvedRouteId: 'antigravity:hub',
          cliVersion: host.version ?? null,
          // The FOLDER, not a fresh id: a random one can never be matched
          // back to where the mission ran.
          workspaceId: workspaceIdFor(options.workspacePath),
          sandbox: 'workspace-write',
          executionPolicyVersion: 1,
          createdAt,
          ...(priorConversation === undefined
            ? {}
            : {
                continuesFrom: {
                  missionId: priorConversation.missionId,
                  checkpointEpoch: 1,
                  reason: 'follow-up' as const,
                  runtimeThreadId: conversationId
                }
              })
        })
        if (peerExchange !== undefined && delivered.length > 0) {
          try {
            await peerExchange.recordReceived(missionId, delivered, createdAt)
          } catch {
            await options.ledger
              .appendHostFailure(missionId, {
                code: 'runtime-start-failed',
                message: 'The messages this mission was shown could not be recorded in the local ledger.',
                occurredAt: now().toISOString()
              })
              .catch(() => undefined)
            throw new AntigravityStartError('The messages this mission was shown could not be recorded in the durable local ledger.')
          }
        }

        const run: LiveRun = {
          runId,
          missionId,
          conversationId,
          model,
          peer,
          relay: route.relay,
          transcript: createTranscriptTracker(),
          normalizer: createAntigravityEventNormalizer({
            runId,
            missionId,
            requestedRouteId: 'antigravity',
            resolvedRouteId: 'antigravity:hub',
            ...(host.version === undefined ? {} : { cliVersion: host.version }),
            conversationId,
            now
          }),
          transcriptPath: transcriptPathFor(home, conversationId),
          startedAt: createdAt,
          fed,
          lastProgressAt: Date.now(),
          timer: undefined,
          polling: false,
          ended: false
        }
        runs.set(runId, run)
        run.timer = setInterval(() => {
          void poll(run)
        }, pollMs)
        void poll(run)
        if (peerExchange !== undefined) await peerExchange.markDelivered(missionId, delivered)

        return {
          runId,
          missionId,
          conversationId,
          model,
          cliVersion: host.version ?? null,
          peerMessages: delivered.map((message) => publicPeerMessage(message, 'received')),
          peerDeliveryFailed,
          ...(priorConversation === undefined ? {} : { followsUp: { missionId: priorConversation.missionId, runtimeThreadId: conversationId } })
        }
      } finally {
        starting.delete(owner)
      }
    },

    cancel(runId) {
      const run = runs.get(runId)
      if (run === undefined) return false
      // Antigravity's agent is not stopped by this -- the host has no handle
      // on it -- so the receipt says the WATCH was cancelled, and the thread
      // says the agent may still be working inside Antigravity.
      void end(run, { cancelled: true, stderr: "Stopped watching. Antigravity's agent may still be working inside Antigravity." })
      return true
    },

    async dispose() {
      disposed = true
      for (const run of [...runs.values()]) {
        await end(run, { cancelled: true, stderr: 'The app is closing.' })
      }
    }
  }
}
