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
  start(prompt: string, peer?: MissionPeerContext): Promise<AppServerMission>
  decide(answer: MissionApprovalAnswer): boolean
  cancel(): void
  dispose(): Promise<void>
  readonly pendingApprovalCount: number
}

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

export function createAppServerMissionService(
  options: AppServerMissionOptions
): AppServerMissionService {
  const createId = options.createId ?? randomUUID
  const now = options.now ?? (() => new Date())

  interface Pending {
    readonly resolve: (value: JsonValue) => void
  }

  let process: AppServerProcess | undefined
  let client: AppServerClient | undefined
  let active:
    | {
        runId: string
        missionId: string
        peer: MissionPeerContext | undefined
        transcript: TranscriptTracker
      }
    | undefined
  let normalizer: ReturnType<typeof createAppServerEventNormalizer> | undefined
  const approvals = new Map<string, Pending>()
  let disposed = false
  const peerExchange: PeerExchange | undefined =
    options.workroom === undefined
      ? undefined
      : createPeerExchange({ workroom: options.workroom, ledger: options.ledger })

  const persistAndEmit = async (events: readonly unknown[]): Promise<void> => {
    if (active === undefined || events.length === 0) return
    const mission = active
    // Persist-before-emit, exactly as the exec path does. A receipt the user
    // has seen must already be on disk.
    await options.ledger.appendEvents(mission.missionId, events as never)
    // Tracked only once durable, so a share is read from what the ledger holds.
    const wasComplete = mission.transcript.completed
    mission.transcript.track(events as readonly NormalizedRuntimeEvent[])
    for (const event of events) options.emitEvent(mission.runId, mission.missionId, event)
    // Same rule as the exec path: only a run that finished on its own terms
    // speaks for its teammate, and exactly once.
    if (!wasComplete && mission.transcript.completed && mission.peer !== undefined && peerExchange !== undefined) {
      const text = mission.transcript.latestFinal
      if (text !== undefined) {
        await peerExchange.share(
          { runId: mission.runId, missionId: mission.missionId, peer: mission.peer, text },
          (update) => options.emitUpdate?.(update)
        )
      }
    }
  }

  return {
    get pendingApprovalCount() {
      return approvals.size
    },

    async start(prompt: string, peer?: MissionPeerContext): Promise<AppServerMission> {
      if (disposed) throw new Error('The mission service is shutting down.')
      if (active !== undefined) throw new Error('A mission is already running.')

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
        model: 'account-default',
        requestedRouteId: 'codex',
        resolvedRouteId: 'codex-app-server:default',
        cliVersion: codex.version?.version ?? null,
        workspaceId: `ws_${createId()}`.slice(0, 40),
        // Approvals only mean something when the agent could otherwise act, so
        // this mode runs write-capable and stops to ask.
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

      active = { runId, missionId, peer, transcript: createTranscriptTracker() }
      normalizer = createAppServerEventNormalizer({
        runId,
        missionId,
        runtime: 'codex',
        ...(codex.version?.version === undefined ? {} : { cliVersion: codex.version.version }),
        now
      })

      const child = options.spawn(codex.executable.executablePath, [
        ...codex.executable.prefixArgs,
        'app-server'
      ])
      process = child

      const rpc = createAppServerClient({
        transport: {
          send: (line) => child.write(line),
          close: () => child.kill()
        },
        onNotification: (notification) => {
          const produced = normalizer?.accept(notification) ?? []
          void persistAndEmit(produced).catch(() => undefined)
        },
        onRequest: async (request) => {
          const described = describeApproval(request)
          if (described === undefined) {
            // A request this build does not understand is refused rather than
            // guessed at. Approving something unnamed is the one answer that
            // can never be right.
            return { decision: 'reject' }
          }
          if (approvals.size >= MAX_PENDING_APPROVALS) return { decision: 'reject' }
          const approvalId = `ap_${createId()}`
          return await new Promise<JsonValue>((resolve) => {
            approvals.set(approvalId, { resolve })
            options.emitApproval({
              approvalId,
              runId,
              missionId,
              kind: described.kind,
              summary: described.summary,
              detail: described.detail,
              cwd: described.cwd,
              requestedAt: now().toISOString()
            })
          })
        },
        onDiagnostic: () => undefined
      })
      client = rpc

      child.onData((chunk) => rpc.accept(chunk))
      child.onExit(() => {
        const produced = normalizer?.finish('transport-lost') ?? []
        void persistAndEmit(produced).catch(() => undefined)
        // Never leave a person staring at a card nothing will answer.
        for (const [, pending] of approvals) pending.resolve({ decision: 'reject' })
        approvals.clear()
        active = undefined
      })

      await rpc.request('initialize', {
        clientInfo: { name: 'locust', version: '0.1.0' }
      })
      rpc.notify('initialized')
      const thread = await rpc.request('thread/start', {
        cwd: options.workspacePath,
        sandbox: 'workspace-write',
        approvalPolicy: 'untrusted'
      })
      const threadRecord = (typeof thread === 'object' && thread !== null ? thread : {}) as Record<string, unknown>
      const inner = (typeof threadRecord.thread === 'object' && threadRecord.thread !== null
        ? threadRecord.thread
        : {}) as Record<string, unknown>
      const threadId = typeof inner.id === 'string' ? inner.id : undefined
      if (threadId === undefined) throw new Error('The runtime did not start a thread.')

      await rpc.request('turn/start', {
        threadId,
        approvalPolicy: 'untrusted',
        input: [{ type: 'text', text: runtimePrompt }]
      })

      // Marked delivered only now that the turn is live.
      if (peerExchange !== undefined) await peerExchange.markDelivered(missionId, delivered)

      return {
        runId,
        missionId,
        runtimeThreadId: normalizer.runtimeThreadId,
        peerMessages: delivered.map((message) => publicPeerMessage(message, 'received')),
        peerDeliveryFailed
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

    cancel(): void {
      const produced = normalizer?.finish('cancelled') ?? []
      void persistAndEmit(produced).catch(() => undefined)
      for (const [, pending] of approvals) pending.resolve({ decision: 'reject' })
      approvals.clear()
      client?.dispose('The mission was stopped.')
      process?.kill()
      active = undefined
    },

    async dispose(): Promise<void> {
      disposed = true
      for (const [, pending] of approvals) pending.resolve({ decision: 'reject' })
      approvals.clear()
      client?.dispose('The app is closing.')
      process?.kill()
      await options.ledger.flush()
    }
  }
}
