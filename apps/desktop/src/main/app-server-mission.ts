import { workspaceIdFor } from './workspace.js'
import { randomUUID } from 'node:crypto'

import { createAppServerClient, createAppServerEventNormalizer } from '@teammate/runtime-adapters'
import type {
  AppServerClient,
  AppServerRequest,
  JsonValue,
  RuntimeDiscovery
} from '@teammate/runtime-adapters'
import type { MissionLedger, Workroom, WorkroomMessage } from '@teammate/mission-store'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import type {
  CodexMissionUpdate,
  MissionApprovalAnswer,
  MissionApprovalKind,
  MissionApprovalRequest,
  PublicPeerMessage
} from '../shared/ipc.js'
import { createPeerExchange, createTranscriptTracker, publicPeerMessage } from './peer-exchange.js'
import { approvalPatchFrom, fileChangesOf, itemOf } from './approval-patch.js'
import { relativeToFolder } from '../shared/approval-patch.js'
import type { FileChangeRecord } from './approval-patch.js'
import type { MemoryBriefing } from './peer-exchange.js'
import type { PeerExchange, TranscriptTracker } from './peer-exchange.js'
import type { MissionPeerContext } from './workroom-briefing.js'

/**
 * A mission driven over `codex app-server`.
 *
 * The exec transport cannot ask permission mid-run, so this exists for the one
 * mode that needs to: the runtime stops before a consequential action and the
 * user answers. Everything else is deliberately identical to the exec path --
 * the same normalized events, the same durable ledger, the same rule that
 * nothing reaches the renderer before it is written.
 *
 * app-server is experimental, so this runs alongside exec rather than replacing
 * it: a protocol change can only break the mode that opted into it.
 */

export interface AppServerProcess {
  /** Write one framed line to the server. */
  write(line: string): void
  /** Kill the server and its children. */
  kill(): void
  onData(listener: (chunk: string) => void): void
  onExit(listener: () => void): void
}

export interface AppServerMissionOptions {
  readonly workspacePath: string
  readonly ledger: MissionLedger
  readonly discover: () => Promise<readonly RuntimeDiscovery[]>
  readonly spawn: (executablePath: string, args: readonly string[]) => AppServerProcess
  readonly emitApproval: (request: MissionApprovalRequest) => void
  readonly emitEvent: (runId: string, missionId: string, event: unknown) => void
  /** Non-event updates: what the mission's work posted to teammates, or could not. */
  readonly emitUpdate?: (update: CodexMissionUpdate) => void
  /** The teammate channel. Without it, missions here belong to nobody's exchange. */
  readonly workroom?: Workroom
  /** What the team remembers, briefed to every teammate mission. */
  readonly memory?: MemoryBriefing
  readonly createId?: () => string
  readonly now?: () => Date
}

export interface AppServerMission {
  readonly runId: string
  readonly missionId: string
  readonly runtimeThreadId: string | undefined
  /** Workroom messages quoted into the prompt, oldest first. */
  readonly peerMessages: readonly PublicPeerMessage[]
  readonly peerDeliveryFailed: boolean
}

/** Thrown when the ledger refuses to record the messages a mission was shown. */
export class PeerRecordError extends Error {}

export interface AppServerMissionService {
  start(
    prompt: string,
    peer?: MissionPeerContext,
    route?: { readonly model?: string; readonly effort?: string }
  ): Promise<AppServerMission>
  decide(answer: MissionApprovalAnswer): boolean
  /** Stop one run. False when no such run is live here. */
  cancel(runId: string): boolean
  /** Whether this transport owns a live run by that id. */
  has(runId: string): boolean
  /** Whether this transport owns a live run of that mission. */
  hasMission(missionId: string): boolean
  /** The missions this transport is running right now. */
  liveMissionIds(): readonly string[]
  dispose(): Promise<void>
  readonly pendingApprovalCount: number
}

/**
 * Same bound as the exec transport, for the same reason: each live run is a
 * provider process tree holding a ledger writer, and four is already more
 * than one person can follow.
 */
export const MAX_LIVE_APP_SERVER_MISSIONS = 4
const NOBODY = ''

const MAX_APPROVAL_DETAIL = 4_000
const MAX_PENDING_APPROVALS = 16

/** What the protocol's approval methods mean in the product's own words. */
export function approvalKindFor(method: string): MissionApprovalKind | undefined {
  if (method === 'item/commandExecution/requestApproval') return 'command'
  if (method === 'item/fileChange/requestApproval') return 'file-change'
  if (method === 'item/tool/requestUserInput') return 'question'
  return undefined
}

function bounded(value: unknown): string {
  if (typeof value !== 'string') return ''
  const single = value.replace(/\s+/g, ' ').trim()
  return single.length > MAX_APPROVAL_DETAIL ? `${single.slice(0, MAX_APPROVAL_DETAIL - 1)}…` : single
}

/**
 * Turn a protocol approval request into something a person can decide about.
 * A card that cannot say WHAT would happen is not an approval, it is a dare.
 */
export function describeApproval(
  request: AppServerRequest
): { readonly kind: MissionApprovalKind; readonly summary: string; readonly detail: string; readonly cwd: string | null } | undefined {
  const kind = approvalKindFor(request.method)
  if (kind === undefined) return undefined
  const params = (typeof request.params === 'object' && request.params !== null ? request.params : {}) as Record<
    string,
    unknown
  >
  const cwd = typeof params.cwd === 'string' ? params.cwd : null

  if (kind === 'command') {
    const command = bounded(params.command)
    return {
      kind,
      summary: command.length > 0 ? 'Run a command' : 'Run a command it did not describe',
      detail: command,
      cwd
    }
  }
  if (kind === 'file-change') {
    const changes = Array.isArray(params.changes) ? params.changes.length : undefined
    return {
      kind,
      summary: changes === undefined ? 'Change files' : `Change ${changes} file${changes === 1 ? '' : 's'}`,
      // The diff itself is not shown here: it can be enormous, and the card's
      // job is to say what is about to happen, not to be a diff viewer.
      detail: bounded(params.summary ?? params.explanation ?? ''),
      cwd
    }
  }
  return {
    kind,
    summary: 'Answer a question',
    detail: bounded(params.question ?? params.prompt ?? params.message ?? ''),
    cwd
  }
}

/** The protocol decision for each of the product's three answers. */
export function protocolDecisionFor(decision: MissionApprovalAnswer['decision']): string {
  if (decision === 'approve-once') return 'accept'
  // Session-scoped, never durable: a forever-grant is a Settings decision, not
  // one to take mid-run under time pressure.
  if (decision === 'approve-always') return 'acceptForSession'
  return 'reject'
}

/**
 * A fileChange item's tool rows carry the change itself.
 *
 * The app-server normaliser writes "N file change(s)" as the row's command
 * and no patch, so after an APPROVED edit the activity fold read "Codex CLI
 * did not report the change" beside a row for a file whose diff the
 * approval card had just shown (seen driving the app, 2026-09-05). The
 * item's `changes` are remembered by id for the approval; the same record
 * gives the row its paths and its patch.
 */
export function withFileChanges(
  events: readonly NormalizedRuntimeEvent[],
  changesByItem: ReadonlyMap<string, readonly FileChangeRecord[]>,
  workspacePath: string
): readonly NormalizedRuntimeEvent[] {
  return events.map((event) => {
    if (event.type !== 'tool.started' && event.type !== 'tool.completed' && event.type !== 'tool.failed') return event
    const payload = event.payload as { readonly itemId?: string; readonly toolKind?: string; readonly command?: string; readonly patch?: unknown }
    if (payload.toolKind !== 'fileChange' || payload.itemId === undefined) return event
    const changes = changesByItem.get(payload.itemId)
    if (changes === undefined || changes.length === 0) return event
    const patch = approvalPatchFrom(changes, workspacePath)
    const paths = changes.map((change) => relativeToFolder(change.path, workspacePath)).join('\n')
    return {
      ...event,
      payload: {
        ...payload,
        command: paths,
        ...(patch === undefined ? {} : { patch })
      }
    } as NormalizedRuntimeEvent
  })
}

export function createAppServerMissionService(
  options: AppServerMissionOptions
): AppServerMissionService {
  const createId = options.createId ?? randomUUID
  const now = options.now ?? (() => new Date())

  interface Pending {
    readonly runId: string
    readonly resolve: (value: JsonValue) => void
  }

  /** One live run: its process tree, its client, and what it has said. */
  interface LiveRun {
    readonly runId: string
    readonly missionId: string
    readonly peer: MissionPeerContext | undefined
    readonly transcript: TranscriptTracker
    readonly normalizer: ReturnType<typeof createAppServerEventNormalizer>
    process: AppServerProcess | undefined
    client: AppServerClient | undefined
  }

  // Runs side by side, one per teammate, exactly as the exec transport does.
  const runs = new Map<string, LiveRun>()
  const starting = new Set<string>()
  const approvals = new Map<string, Pending>()
  let disposed = false
  const peerExchange: PeerExchange | undefined =
    options.workroom === undefined
      ? undefined
      : createPeerExchange({ workroom: options.workroom, ledger: options.ledger, ...(options.memory === undefined ? {} : { memory: options.memory }) })
  const ownerKeyOf = (peer: MissionPeerContext | undefined): string => peer?.self.teammateId ?? NOBODY

  const persistAndEmit = async (run: LiveRun, events: readonly unknown[]): Promise<void> => {
    if (events.length === 0) return
    // Persist-before-emit, exactly as the exec path does. A receipt the user
    // has seen must already be on disk.
    await options.ledger.appendEvents(run.missionId, events as never)
    // Tracked only once durable, so a share is read from what the ledger holds.
    const wasComplete = run.transcript.completed
    run.transcript.track(events as readonly NormalizedRuntimeEvent[])
    for (const event of events) options.emitEvent(run.runId, run.missionId, event)
    // Same rule as the exec path: only a run that finished on its own terms
    // speaks for its teammate, and exactly once.
    if (!wasComplete && run.transcript.completed && run.peer !== undefined && peerExchange !== undefined) {
      const text = run.transcript.latestFinal
      if (text !== undefined) {
        await peerExchange.share(
          { runId: run.runId, missionId: run.missionId, peer: run.peer, text },
          (update) => options.emitUpdate?.(update)
        )
      }
    }
  }

  /** Answer every approval a run still holds open with a refusal, and forget them. */
  const releaseApprovals = (runId: string): void => {
    for (const [approvalId, pending] of approvals) {
      if (pending.runId !== runId) continue
      approvals.delete(approvalId)
      pending.resolve({ decision: 'reject' })
    }
  }

  const stop = (run: LiveRun, reason: 'cancelled' | 'transport-lost', why: string): void => {
    if (runs.get(run.runId) !== run) return
    runs.delete(run.runId)
    const produced = run.normalizer.finish(reason)
    /*
     * The TERMINAL receipt. Losing it quietly is a smaller version of the
     * defect fixed above, and it lies about history rather than about the
     * present: a mission whose closing record never lands is recovered on the
     * next launch as INTERRUPTED, when what actually happened is that the
     * person stopped it on purpose.
     *
     * The run is already ending, so there is nothing to hold back -- the only
     * thing missing was saying so. `codex-mission.ts` has always said it on
     * this path; this one did not.
     */
    void persistAndEmit(run, produced).catch(() => {
      options.emitUpdate?.({
        kind: 'persistence-error',
        runId: run.runId,
        missionId: run.missionId,
        error: {
          code: 'MISSION_PERSISTENCE_FAILED',
          message: 'The mission stopped, but its closing record could not be written to the durable local ledger.'
        }
      })
    })
    // Never leave a person staring at a card nothing will answer.
    releaseApprovals(run.runId)
    run.client?.dispose(why)
    run.process?.kill()
  }

  /*
   * The ledger refused a write, so the run stops and says so.
   *
   * `persistAndEmit` persists BEFORE it emits, on purpose -- "a receipt the
   * user has seen must already be on disk". Its caller then discarded the
   * rejection with `.catch(() => undefined)`, which turned that guarantee
   * inside out: the receipt was not written, the events were never emitted, so
   * nothing appeared on screen -- and the run carried on working. Unrecorded
   * work, invisibly, with no error anywhere.
   *
   * The exec path has always failed closed here: `codex-mission.ts` aborts the
   * process and emits `MISSION_PERSISTENCE_FAILED`. This path is the one that
   * serves `approve-each`, the mode whose entire purpose is careful, auditable,
   * per-action control -- so it had the least safe failure handling of the two,
   * in the mode that can least afford it.
   *
   * Found by Astra reading the source (2026-09-08) and filed as a "source-level
   * concern, not dynamically verified". It verified.
   */
  const receiptsFailed = (run: LiveRun): void => {
    if (runs.get(run.runId) !== run) return
    runs.delete(run.runId)
    releaseApprovals(run.runId)
    run.client?.dispose('the mission ledger could not be written')
    run.process?.kill()
    // Emitted, not persisted: the ledger is the thing that just failed, so
    // trying to write this through it would be the same failure again.
    options.emitUpdate?.({
      kind: 'persistence-error',
      runId: run.runId,
      missionId: run.missionId,
      error: {
        code: 'MISSION_PERSISTENCE_FAILED',
        message: 'The mission could not be written to the durable local ledger.'
      }
    })
  }

  return {
    get pendingApprovalCount() {
      return approvals.size
    },

    has(runId: string): boolean {
      return runs.has(runId)
    },

    hasMission(missionId: string): boolean {
      return [...runs.values()].some((run) => run.missionId === missionId)
    },

    liveMissionIds(): readonly string[] {
      return [...runs.values()].map((run) => run.missionId)
    },

    async start(
      prompt: string,
      peer?: MissionPeerContext,
      route?: { readonly model?: string; readonly effort?: string }
    ): Promise<AppServerMission> {
      if (disposed) throw new Error('The mission service is shutting down.')
      const owner = ownerKeyOf(peer)
      // One live mission per teammate, and missions of nobody's one at a time.
      if (starting.has(owner) || [...runs.values()].some((run) => ownerKeyOf(run.peer) === owner)) {
        throw new Error(
          peer === undefined
            ? 'A mission is already running.'
            : `${peer.self.name} already has a mission running. Wait for it to finish or stop it first.`
        )
      }
      if (starting.size + runs.size >= MAX_LIVE_APP_SERVER_MISSIONS) {
        throw new Error(`Up to ${MAX_LIVE_APP_SERVER_MISSIONS} missions can run at once. Wait for one to finish or stop it first.`)
      }
      starting.add(owner)
      try {
        const runtimes = await options.discover()
        const codex = runtimes.find((entry) => entry.id === 'codex')
        if (codex?.readiness !== 'ready' || codex.executable === undefined) {
          throw new Error('Codex CLI is not ready.')
        }

        const runId = `run_${createId()}`
        const missionId = `mission_${createId()}`
        const createdAt = now().toISOString()

        // Same shape as the exec path: the person's words are the recorded
        // prompt; what the runtime is sent adds the waiting messages and the
        // share form, and the ledger names the delivered messages by id.
        let runtimePrompt = prompt
        let delivered: readonly WorkroomMessage[] = []
        let peerDeliveryFailed = false
        if (peer !== undefined && peerExchange !== undefined) {
          const prepared = await peerExchange.prepare(prompt, peer)
          runtimePrompt = prepared.runtimePrompt
          delivered = prepared.delivered
          peerDeliveryFailed = prepared.failed
        }

        await options.ledger.createMission({
          missionId,
          runId,
          prompt,
          runtime: 'codex',
          model: route?.model !== undefined && route.model !== 'account-default' ? route.model : 'account-default',
          requestedRouteId: 'codex',
          resolvedRouteId: 'codex-app-server:default',
          cliVersion: codex.version?.version ?? null,
          // The FOLDER, not a fresh id: a random one can never be matched
          // back to where the mission ran.
          workspaceId: workspaceIdFor(options.workspacePath),
          // Approvals only mean something when the agent could otherwise act,
          // so this mode runs write-capable and stops to ask.
          sandbox: 'workspace-write',
          executionPolicyVersion: 1,
          createdAt
        })

        if (peerExchange !== undefined && delivered.length > 0) {
          try {
            await peerExchange.recordReceived(missionId, delivered, createdAt)
          } catch {
            await options.ledger.appendHostFailure(missionId, {
              code: 'runtime-start-failed',
              message: 'The messages this mission was shown could not be recorded in the local ledger.',
              occurredAt: now().toISOString()
            }).catch(() => undefined)
            throw new PeerRecordError('The messages this mission was shown could not be recorded in the durable local ledger.')
          }
        }

        const normalizer = createAppServerEventNormalizer({
          runId,
          missionId,
          runtime: 'codex',
          ...(codex.version?.version === undefined ? {} : { cliVersion: codex.version.version }),
          now
        })
        const run: LiveRun = {
          runId,
          missionId,
          peer,
          transcript: createTranscriptTracker(),
          normalizer,
          process: undefined,
          client: undefined
        }
        runs.set(runId, run)

        const child = options.spawn(codex.executable.executablePath, [
          ...codex.executable.prefixArgs,
          'app-server'
        ])
        run.process = child

        // Each fileChange item's changes, by item id, so the approval that
        // names the item can show the change itself (approval-patch.ts).
        const changesByItem = new Map<string, readonly FileChangeRecord[]>()
        const rpc = createAppServerClient({
          transport: {
            send: (line) => child.write(line),
            close: () => child.kill()
          },
          onNotification: (notification) => {
            const found = itemOf(notification.params)
            if (found !== undefined) {
              const changes = fileChangesOf(found.item)
              if (changes !== undefined) changesByItem.set(found.id, changes)
            }
            const produced = normalizer.accept(notification)
            void persistAndEmit(run, withFileChanges(produced, changesByItem, peer?.cwd ?? options.workspacePath))
              .catch(() => receiptsFailed(run))
          },
          onRequest: async (request) => {
            const described = describeApproval(request)
            if (described === undefined) {
              // A request this build does not understand is refused rather
              // than guessed at. Approving something unnamed is the one answer
              // that can never be right.
              return { decision: 'reject' }
            }
            if (approvals.size >= MAX_PENDING_APPROVALS) return { decision: 'reject' }
            const approvalId = `ap_${createId()}`
            const requestParams = (typeof request.params === 'object' && request.params !== null ? request.params : {}) as Record<string, unknown>
            const itemId = typeof requestParams.itemId === 'string' ? requestParams.itemId : undefined
            const changes = described.kind === 'file-change' && itemId !== undefined ? changesByItem.get(itemId) : undefined
            const patch = approvalPatchFrom(changes, peer?.cwd ?? options.workspacePath)
            return await new Promise<JsonValue>((resolve) => {
              approvals.set(approvalId, { runId, resolve })
              options.emitApproval({
                approvalId,
                runId,
                missionId,
                kind: described.kind,
                // The item names its files; the request alone does not.
                summary: changes !== undefined && changes.length > 0 ? `Change ${String(changes.length)} file${changes.length === 1 ? '' : 's'}` : described.summary,
                detail: described.detail,
                cwd: described.cwd,
                requestedAt: now().toISOString(),
                ...(patch === undefined ? {} : { patch: { text: patch.text, added: patch.added, removed: patch.removed, truncated: patch.truncated } })
              })
            })
          },
          onDiagnostic: () => undefined
        })
        run.client = rpc

        child.onData((chunk) => rpc.accept(chunk))
        child.onExit(() => {
          stop(run, 'transport-lost', 'The runtime exited.')
        })

        try {
          await rpc.request('initialize', {
            clientInfo: { name: 'locust', version: '0.1.0' }
          })
          rpc.notify('initialized')
          const thread = await rpc.request('thread/start', {
            // The teammate's own worktree when it has one, else the folder.
            cwd: peer?.cwd ?? options.workspacePath,
            sandbox: 'workspace-write',
            approvalPolicy: 'untrusted'
          })
          const threadRecord = (typeof thread === 'object' && thread !== null ? thread : {}) as Record<string, unknown>
          const inner = (typeof threadRecord.thread === 'object' && threadRecord.thread !== null
            ? threadRecord.thread
            : {}) as Record<string, unknown>
          const threadId = typeof inner.id === 'string' ? inner.id : undefined
          if (threadId === undefined) throw new Error('The runtime did not start a thread.')

          // Route and effort are per-turn parameters on this transport. Only
          // a plain word is passed as effort, whatever the request said.
          const model = route?.model !== undefined && route.model !== 'account-default' ? route.model : undefined
          const effort = route?.effort !== undefined && /^[a-z]{1,16}$/.test(route.effort) ? route.effort : undefined
          await rpc.request('turn/start', {
            threadId,
            approvalPolicy: 'untrusted',
            input: [{ type: 'text', text: runtimePrompt }],
            ...(model === undefined ? {} : { model }),
            ...(effort === undefined ? {} : { effort })
          })
        } catch (error) {
          // A run that never got its turn is not left half-registered: the
          // process goes, the slot frees, and the caller hears why.
          stop(run, 'transport-lost', 'The runtime did not start.')
          throw error
        }

        // Marked delivered only now that the turn is live.
        if (peerExchange !== undefined) await peerExchange.markDelivered(missionId, delivered)

        return {
          runId,
          missionId,
          runtimeThreadId: normalizer.runtimeThreadId,
          peerMessages: delivered.map((message) => publicPeerMessage(message, 'received')),
          peerDeliveryFailed
        }
      } finally {
        starting.delete(owner)
      }
    },

    decide(answer: MissionApprovalAnswer): boolean {
      const pending = approvals.get(answer.approvalId)
      // An unknown or already-answered id is ignored rather than throwing: a
      // double-click on the card must not take the run down.
      if (pending === undefined) return false
      approvals.delete(answer.approvalId)
      pending.resolve({ decision: protocolDecisionFor(answer.decision) })
      return true
    },

    cancel(runId: string): boolean {
      const run = runs.get(runId)
      if (run === undefined) return false
      stop(run, 'cancelled', 'The mission was stopped.')
      return true
    },

    async dispose(): Promise<void> {
      disposed = true
      for (const run of [...runs.values()]) {
        runs.delete(run.runId)
        releaseApprovals(run.runId)
        run.client?.dispose('The app is closing.')
        run.process?.kill()
      }
      await options.ledger.flush()
    }
  }
}
