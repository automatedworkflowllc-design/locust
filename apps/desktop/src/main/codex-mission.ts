import {
  asProcessNormalizer,
  codexAppServerPolicy,
  createAppServerEventNormalizer,
  createClaudeEventNormalizer,
  createClaudePrintCommand,
  createCodexAppServerCommand,
  createCodexEventNormalizer,
  createCodexExecCommand,
  createCopilotEventNormalizer,
  createCopilotPromptCommand,
  createCursorEventNormalizer,
  createCursorPrintCommand,
  createMuseEventNormalizer,
  createMuseExecCommand,
  createOpenCodeEventNormalizer,
  createOpenCodeRunCommand,
  cursorCanEnforceReadOnly,
  notificationOfRecord,
  startCodexAppServerRun
} from '@teammate/runtime-adapters'
import type {
  AppServerRunProcess,
  ClaudeEventNormalizer,
  CodexEventNormalizer,
  MissionRuntimeId,
  RuntimeDiscovery,
  RuntimeProcessRun,
  RuntimeProcessRunner, NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { workspaceIdFor } from './workspace.js'
import type { MissionContinuation, MissionLedger, RecoveredMission, Workroom, WorkroomMessage } from '@teammate/mission-store'
import type { MissionSandbox, RuntimeCommandSpec } from '@teammate/runtime-adapters'
import { createHash, randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import type {
  CodexMissionCancelResponse,
  CodexMissionStartResponse,
  CodexMissionUpdate,
  MissionApprovalAnswer,
  MissionHandoffResponse,
  MissionMode
} from '../shared/ipc.js'
import { withFileChanges } from './approval-channel.js'
import type { ApprovalChannel } from './approval-channel.js'
import { fileChangesOf, itemOf } from './approval-patch.js'
import type { FileChangeRecord } from './approval-patch.js'
import { composeHandoffPrompt } from './handoff.js'
import { changedPaths, observedEditEvents, observedPatches, sharedTreeNotice, snapshotWorkspace, unreportedPaths } from './disk-observation.js'
import { cursorCannotSee, cursorIgnoreNotice } from './cursor-visibility.js'
import type { WorkspaceSnapshot } from './disk-observation.js'
import type { ToolPatch } from '@teammate/runtime-adapters'
import { createPeerExchange, createTranscriptTracker, publicPeerMessage } from './peer-exchange.js'
import type { MemoryBriefing } from './peer-exchange.js'
import type { PeerExchange, TranscriptTracker } from './peer-exchange.js'
import type { MissionPeerContext } from './workroom-briefing.js'
import { planSection } from './workroom-briefing.js'
import type { EndedMission, RelayOrigin, SharingMission } from './relay.js'
import type { MissionStarter } from '@teammate/mission-store'
import { recordableCommand } from './command-record.js'
import { commandTooLong } from './command-length.js'
import { MAX_LIVE_MISSIONS } from '../shared/live-missions.js'
import { hostReadsEventsOf, runtimeDisplayName } from '../shared/runtimes.js'
import { FREE_ONLY_REFUSAL, isFreeRoute } from './free-routes.js'

const MAX_PROMPT_LENGTH = 8_000
/**
 * Missions run side by side now, one per teammate.
 *
 * The number moved to shared/ so the room screen can say it before a person
 * builds a room bigger than it -- re-exported here because it has been part
 * of this module's surface since the cap existed.
 */
export { MAX_LIVE_MISSIONS } from '../shared/live-missions.js'
/** Owner key for a mission that belongs to nobody; those still run one at a time. */
const NOBODY = ''

interface ActiveCodexMission {
  /** Whether this mission has already explained a refused read. Once is enough. */
  saidWhyAReadFailed: boolean
  /** Whether this run has already said a connector needs signing in to. */
  saidConnectorsNeedLogin?: boolean
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
  /** What this run may touch and which model it runs, so a relayed reply inherits both. */
  readonly sandbox: MissionSandbox
  readonly model: string | undefined
  /** Set when the host started this run for a teammate replying on their own. */
  readonly relay: RelayOrigin | undefined
  /**
   * `git status` before the process started, for a run allowed to write.
   * Compared with the tree after it ends, so an edit the runtime made through
   * a sub-agent and never reported still gets a row (OpenCode's `task` tool,
   * 2026-09-05). Undefined outside a repository, or for a read-only run.
   */
  readonly diskBefore: WorkspaceSnapshot | undefined
  /** Where the run happened: the teammate's worktree, or the folder. */
  readonly cwd: string
  /**
   * Set when another writing run shared this folder while this one was live.
   *
   * The disk observation below is a before/after comparison of the WHOLE
   * working tree, so it cannot tell one run's writes from another's. Three
   * teammates started at once in one folder each wrote a file, and each run's
   * activity card then claimed all three and the sum of their lines -- "3
   * files, +124" for a single forty-line poem (drive, 2026-09-06). The tree
   * is shared on purpose; the attribution is what has to give way.
   *
   * Marked on BOTH runs the moment they overlap, because by the time either
   * finishes the other may be gone and the overlap invisible.
   */
  sharedTree: boolean
  /**
   * Whether this run's PROCESS has exited.
   *
   * Distinct from being out of `active`, and the distinction is the whole of
   * a defect the 0.36.2 shared-folder mark shipped with. A finished run stays
   * in `active` for a long time after its process is gone: through its own
   * disk observation, through its share to the workroom, and through the
   * relay's `onShared` -- which STARTS the recipient's run and is awaited
   * before `clearActive`. So every relayed reply found the sender still
   * "active", both were marked as sharing the folder, and the reply's own
   * edit was then counted against nobody, about a process that had already
   * exited (QA, 2026-09-06). The same happened to any run a person started
   * while a finished run's `git status` was still being taken.
   *
   * Two runs share a folder when both are RUNNING in it. This is how that
   * question gets asked.
   */
  settled: boolean
  /** The last event sequence persisted, so a synthetic event can follow it. */
  lastSequence: number
  /** Every event persisted, so the observation can tell reported edits from unreported ones. */
  readonly persisted: NormalizedRuntimeEvent[]
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
    followUpOf?: string,
    /** Set by the host when a teammate is replying on their own. */
    relay?: RelayOrigin,
    /**
     * Who started this run, when it was not a person and not the relay. Only
     * `resume` supplies it; the relay derives its own from `relay` above.
     */
    startedBy?: MissionStarter
  ): Promise<CodexMissionStartResponse>
  cancel(runId: unknown): CodexMissionCancelResponse
  /**
   * The person's answer to something a run asked. False when no run of this
   * service was waiting under that id -- another host may hold it.
   */
  decide(answer: MissionApprovalAnswer): boolean
  /**
   * Pick a stopped mission back up from its last checkpoint.
   *
   * Unlike `handOff` this works on a mission that is NOT active -- that is the
   * whole case, since the usual way to end up here is the app closing
   * mid-run. So it reconciles from the ledger rather than from a live run,
   * and refuses on the same terms a handoff does when the record cannot be
   * trusted to say what happened.
   */
  resume(
    missionId: unknown,
    runtime: MissionRuntimeId,
    mode: MissionMode,
    route: { readonly model?: string; readonly effort?: string },
    emit: (update: CodexMissionUpdate) => void
  ): Promise<MissionHandoffResponse>
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
  /**
   * The run this teammate has going here, if any.
   *
   * The busy check already asks this question internally; a teammate who may
   * be interrupted needs it asked from outside, and answering it with a
   * mission id would make the caller look the run back up.
   */
  runIdOwnedBy(teammateId: string): string | undefined
  interrupt(): void
  dispose(): Promise<void>
}

interface CodexMissionServiceOptions {
  readonly workspacePath: string
  /** Test seam. Which platform's containment rules apply. */
  readonly platform?: NodeJS.Platform
  /**
   * The runtimes, for deciding whether this mission may start.
   *
   * Takes the runtime it is about to use so the host can answer from a recent
   * `ready` record instead of re-probing every other runtime — see
   * `discoverForStart`. Passing nothing is the old full sweep.
   */
  readonly discover: (runtimeId?: string) => Promise<readonly RuntimeDiscovery[]>
  readonly runner: RuntimeProcessRunner
  /**
   * How to start `codex app-server`, which is the transport every Codex mode
   * runs on. Without it Codex falls back to `codex exec --json`, which works
   * but never streams -- see `startCodexAppServerRun` for the measurement.
   * Absent in tests that only exercise the exec path.
   */
  readonly appServerSpawn?: (
    executablePath: string,
    args: readonly string[]
  ) => AppServerRunProcess
  readonly ledger: MissionLedger
  /**
   * Where the host writes a line nobody sees on screen. A ledger write
   * that fails mid-run used to be reported as a card that named no cause
   * and logged nowhere, so the one fact that would explain it -- EBUSY,
   * ENOSPC, a directory in the file's place -- was gone with the run.
   * Colin, 2026-09-17: "wembley never replied and his run showed an
   * error when i checked on it". Nothing on the machine could say why.
   */
  readonly note?: (label: string, detail: string) => void
  /** The teammate channel. Optional: a service without one runs missions that belong to nobody. */
  readonly workroom?: Workroom
  /** What the team remembers, briefed to every teammate mission. */
  readonly memory?: MemoryBriefing
  /**
   * Called after a completed run posted messages to teammates, with what it
   * posted. Whatever this does -- a relay starting the recipient's run --
   * happens after the share is recorded and must not fail the run.
   */
  readonly onShared?: (mission: SharingMission, posted: readonly WorkroomMessage[]) => Promise<void>
  /** Called once a run is over, however it ended, after any share it made. */
  readonly onRunEnded?: (mission: EndedMission) => Promise<void>
  /** Test seam: how the working tree is looked at before and after a write-capable run. Defaults to `git status`. */
  readonly observeDisk?: (workspacePath: string) => Promise<WorkspaceSnapshot | undefined>
  /** Test seam: what `.cursorignore` says, if anything. See cursor-visibility.ts. */
  /** Test seam: what the Cursor CLI says about its connectors. */
  readonly readCursorIgnore?: (path: string) => Promise<string | undefined>
  /** Test seam: the change behind each changed path, read off the disk. */
  readonly observePatches?: (workspacePath: string, after: WorkspaceSnapshot, paths: readonly string[], options?: unknown, before?: WorkspaceSnapshot) => Promise<ReadonlyMap<string, ToolPatch>>
  readonly createId?: () => string
  readonly now?: () => Date
  readonly schedule?: (task: () => void) => void
  /**
   * Whether the workspace has Auto switched on. Asked here rather than at the
   * window's edge because every way a run can start -- a person, a relay hop,
   * a saved routine -- passes through this service, and a mode that lets a
   * runtime write anywhere on the machine should be checked on the path it
   * actually takes. Absent means off: a caller that does not wire it cannot
   * get Auto by omission.
   */
  readonly autoModeAllowed?: () => Promise<boolean>
  /** Refuse every run that is not on a free route. See `free-routes.ts`. */
  readonly freeRoutesOnly?: boolean
  /**
   * Ask before every connector call: send no allow rules, so each one goes
   * to the permission host. Read at run start, never cached. The env seam
   * LOCUST_ASK_CONNECTORS=1 does the same for the drives.
   */
  readonly askConnectors?: () => Promise<boolean>
  /** The person's opt-in for a runtime-kept todo list. Absent reads as off. */
  readonly keepATodoList?: () => Promise<boolean>
  /** Connectors a Cursor teammate can call, by name, for its briefing. */
  readonly readyConnectors?: () => Promise<string | undefined>
  /**
   * Let a Cursor run outside Auto call its connectors: merge an allow rule
   * per configured server into the workspace's `.cursor/cli.json`. Returns
   * the rules added this time. See `cursor-connector-allow.ts`.
   */
  readonly allowConnectors?: (workspace: string) => Promise<readonly string[]>
  /**
   * How many missions are live on the OTHER transports right now.
   *
   * The cap is one pool, not one per transport. Each of the three services
   * counted only its own, so four exec runs, four approve-each runs and four
   * Antigravity runs could all be live at once -- twelve -- while every read
   * in the app (`teammateBusy`, the sidebar count, the busy list) already
   * summed all three into one number and the refusal still said "up to 4".
   * The reporting was right and the enforcement was not.
   *
   * Defaults to zero so a service constructed alone behaves as before.
   */
  readonly liveElsewhere?: () => number
  /**
   * The connectors this machine has, by name, asked at the moment a run
   * starts rather than captured.
   *
   * Colin, 2026-09-10: "honestly just let them have access to the mcp tools
   * if the client have access to it -- it only makes sense and is way less
   * muddy." So there is nothing per-teammate here: every name becomes an
   * allow rule on every Claude Code run.
   *
   * Read live because the list is taken in the background and may not have
   * landed when the first run starts. A run that begins before it does gets
   * no rules, and its connector calls are refused with the sentence the
   * adapter writes -- which is what every build before today did, said out
   * loud, rather than a mission that waits on a health check.
   */
  readonly connectors?: () => readonly string[]
  /**
   * Locust as Claude Code's permission host. See permission-host.ts.
   *
   * Registered per run before the command is built, so the config path is
   * on the command line; released when the run ends, so a question nobody
   * answered is refused rather than left hanging and the run's token dies
   * with it. Claude Code only, and never in Auto.
   */
  readonly permissionHost?: {
    register(run: { readonly runId: string; readonly missionId: string; readonly cwd: string | null }): Promise<{
      readonly configPath: string
      readonly toolName: string
    }>
    release(runId: string): Promise<void>
  }
  /**
   * What answers a Codex run that stops to ask -- Approve-each's whole point.
   * Without it that mode has nobody to ask, and every request is refused.
   */
  readonly approvals?: ApprovalChannel
}

function error(
  code: 'INVALID_PROMPT' | 'RUN_ALREADY_ACTIVE' | 'CODEX_UNAVAILABLE' | 'RUNTIME_START_FAILED' | 'PERSISTENCE_FAILED' | 'RUN_NOT_ACTIVE' | 'HANDOFF_REFUSED',
  message: string
): CodexMissionStartResponse | CodexMissionCancelResponse | MissionHandoffResponse {
  return { ok: false, error: { code, message } }
}

/** What went wrong, in the error's own words, bounded so a card stays a card. */
function reasonOf(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : undefined
  const clean = message?.replace(/\s+/g, ' ').trim()
  return clean === undefined || clean.length === 0 ? undefined : clean.slice(0, 240)
}

function persistenceFailure(active: ActiveCodexMission, reason?: string): void {
  safelyEmit(active, {
    kind: 'persistence-error',
    runId: active.runId,
    missionId: active.missionId,
    error: {
      code: 'MISSION_PERSISTENCE_FAILED',
      // The reason rides in the sentence: the card's own wording appends
      // "Locust stopped the run rather than continue without a durable
      // record" to whatever is said here.
      message:
        reason === undefined
          ? 'The mission could not be written to the durable local ledger.'
          : `The mission could not be written to the durable local ledger: ${reason}.`
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
    if (event.sequence > active.lastSequence) active.lastSequence = event.sequence
    active.persisted.push(event)
  }
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
  // Resolved here, not inside `start`: that scope declares its own `process`
  // for the child, which shadows Node's global and is in its temporal dead
  // zone at the point this is needed.
  const hostPlatform: NodeJS.Platform = options.platform ?? process.platform

  if (!isAbsolute(options.workspacePath)) {
    throw new Error('Codex mission workspace must be an absolute path')
  }

  const createId = options.createId ?? randomUUID
  const workspaceId = workspaceIdFor(options.workspacePath)
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
      : createPeerExchange({
          workroom: options.workroom,
          ledger: options.ledger,
          ...(options.memory === undefined ? {} : { memory: options.memory }),
          ...(options.keepATodoList === undefined ? {} : { keepATodoList: options.keepATodoList }),
          ...(options.readyConnectors === undefined ? {} : { readyConnectors: options.readyConnectors })
        })

  const clearActive = (candidate: ActiveCodexMission): void => {
    if (active.get(candidate.runId) === candidate) active.delete(candidate.runId)
    // The run is over, so nobody can answer a permission it was still asking:
    // refuse what is waiting, forget its token, remove its config.
    void options.permissionHost?.release(candidate.runId).catch(() => undefined)
    options.approvals?.release(candidate.runId)
    // Whatever ended this run, anyone waiting on it is told. Fire and forget:
    // a meeting's bookkeeping must never hold a slot open.
    if (options.onRunEnded !== undefined) {
      void options
        .onRunEnded({ missionId: candidate.missionId, peer: candidate.peer, relay: candidate.relay })
        .catch(() => undefined)
    }
  }

  /**
   * Say why a read was refused, AT THE MOMENT IT IS REFUSED.
   *
   * Cursor obeys `.cursorignore` and its tools answer "permission denied"
   * with no reason, so the model invents one and the person chases the
   * invention. That cost an evening on 2026-09-12.
   *
   * 0.87.0 fixed it by warning at the START of every Cursor run in a hidden
   * folder. Which is TRUE and was still wrong: Colin's teammates in that
   * folder do web research and never open a file, so the warning was correct,
   * inapplicable and unavoidable -- an amber line above every exchange,
   * forever. 0.91.2 reduced it to once per folder per session; he restarted
   * the app all night and asked again, which is the right question: "is it
   * necessary to have the error".
   *
   * Not preemptively. A rule that hides a folder only matters when something
   * is actually refused, and Cursor says so precisely -- the raw record of a
   * failed tool carries `errorMessage: "Permission denied"`, unredacted. So
   * the explanation waits for that, arrives beside the failure it explains,
   * and a run that never opens a file never hears about it.
   *
   * Once per mission. The second denial has the same cause as the first.
   */
  const explainADeniedRead = async (
    mission: ActiveCodexMission,
    events: readonly NormalizedRuntimeEvent[]
  ): Promise<void> => {
    if (mission.runtime !== 'cursor' || mission.saidWhyAReadFailed) return
    const denied = events.some(
      (event) =>
        event.type === 'tool.failed'
        && /permission denied/i.test(JSON.stringify(event.payload.evidence?.raw ?? ''))
    )
    if (!denied) return
    mission.saidWhyAReadFailed = true
    try {
      const sentence = await cursorCannotSee(mission.cwd, options.readCursorIgnore)
      if (sentence === undefined) return
      // Shown, never recorded: see the note where this used to be raised.
      safelyEmit(mission, {
        kind: 'event',
        runId: mission.runId,
        missionId: mission.missionId,
        event: cursorIgnoreNotice({
          runId: mission.runId,
          missionId: mission.missionId,
          sourceAdapter: mission.runtime,
          nextSequence: -1,
          at: now().toISOString(),
          sentence
        })
      })
    } catch {
      // A rule file that cannot be read explains nothing.
    }
  }


  const consume = async (mission: ActiveCodexMission): Promise<void> => {
    let persistenceFailed = false
    let persistenceReason: string | undefined
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
          /*
           * THREE different failures used to share one catch, and the card
           * blamed the ledger for all of them. The adapter throwing on a
           * record it cannot read, the ledger refusing the append, and the
           * denied-read explainer failing are told apart here; only the
           * middle one is a persistence failure, and it now says why.
           */
          let events: ReturnType<CodexEventNormalizer['accept']>
          try {
            events = batch.flatMap((entry) => [...mission.normalizer.accept(entry)])
          } catch (error) {
            const reason = reasonOf(error) ?? 'the adapter threw'
            options.note?.('adapter-failed', `${mission.missionId} ${mission.runtime}: ${reason}`)
            persistenceFailed = true
            persistenceReason = `the ${mission.runtime} adapter could not read a record from the runtime (${reason})`
            mission.controller.abort()
            break
          }
          try {
            await persistAndEmit(mission, options.ledger, events)
          } catch (error) {
            persistenceReason = reasonOf(error)
            options.note?.('ledger-write-failed', `${mission.missionId}: ${persistenceReason ?? 'no message'}`)
            persistenceFailed = true
            mission.controller.abort()
            break
          }
          // Best effort, after the durable write: a failure here must not be
          // reported as the ledger's.
          await explainADeniedRead(mission, events).catch(() => undefined)
        } catch (error) {
          // Anything else that escapes the two guarded steps above: still a
          // stop, still with whatever reason the error carries.
          persistenceReason = reasonOf(error)
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
        persistenceFailure(mission, persistenceReason)
        clearActive(mission)
      }
      return
    }

    let completion
    try {
      completion = await mission.process.completion
    } catch {
      mission.settled = true
      await persistTransportFailure(mission, options.ledger, now().toISOString())
      clearActive(mission)
      return
    }
    // From here the process is gone. Everything below -- the terminal events,
    // the disk observation, the share, the relay -- is bookkeeping, and a run
    // started during any of it is not running alongside this one.
    mission.settled = true

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

    // What the run changed that it never said. After the terminal events so
    // the record's own account comes first and the observation reads as what
    // it is -- the host looking at the tree afterwards. Best effort: an
    // observation that cannot be made or stored costs the run nothing.
    // The runtime's own events always stand -- those name their own tools.
    // What follows is the HOST's reading of the folder, and when another run
    // was writing in it the reading names nobody: it is reported as the
    // folder's change rather than attached to this teammate as files.
    if (mission.diskBefore !== undefined) {
      try {
        const diskAfter = await (options.observeDisk ?? snapshotWorkspace)(mission.cwd)
        if (diskAfter !== undefined && mission.sharedTree) {
          const changed = changedPaths(mission.diskBefore, diskAfter)
          if (changed.length > 0) {
            await persistAndEmit(
              mission,
              options.ledger,
              [
                sharedTreeNotice({
                  runId: mission.runId,
                  missionId: mission.missionId,
                  sourceAdapter: mission.runtime,
                  nextSequence: mission.lastSequence + 1,
                  at: now().toISOString(),
                  paths: changed
                })
              ] as ReturnType<CodexEventNormalizer['accept']>
            )
          }
        } else if (diskAfter !== undefined) {
          // Every path that changed, with the change read off the disk. A
          // path the runtime named keeps its own row and gets the patch
          // attached; one it never named gets a row of its own.
          const changed = changedPaths(mission.diskBefore, diskAfter)
          const unreported = new Set(unreportedPaths(changed, mission.persisted))
          const patches = changed.length === 0
            ? new Map<string, ToolPatch>()
            : await (options.observePatches ?? observedPatches)(mission.cwd, diskAfter, changed, {}, mission.diskBefore)
          const worth = changed.filter((path) => unreported.has(path) || patches.has(path))
          if (worth.length > 0) {
            await persistAndEmit(
              mission,
              options.ledger,
              observedEditEvents({
                runId: mission.runId,
                missionId: mission.missionId,
                sourceAdapter: mission.runtime,
                nextSequence: mission.lastSequence + 1,
                paths: worth,
                at: now().toISOString(),
                patches,
                reported: new Set(changed.filter((path) => !unreported.has(path)))
              }) as ReturnType<CodexEventNormalizer['accept']>
            )
          }
        }
      } catch {
        // The receipt stands on the runtime's own events.
      }
    }

    // Share only from a run that finished on its own terms, and before the
    // slot is released: a handoff waits on this loop, so it never reconciles
    // a mission whose findings are still being posted.
    if (mission.transcript.completed && mission.peer !== undefined && peerExchange !== undefined) {
      const text = mission.transcript.latestFinal
      if (text !== undefined) {
        const posted = await peerExchange.share(
          { runId: mission.runId, missionId: mission.missionId, peer: mission.peer, text },
          (update) => safelyEmit(mission, update)
        )
        if (posted.length > 0 && options.onShared !== undefined) {
          try {
            await options.onShared(
              {
                runId: mission.runId,
                missionId: mission.missionId,
                runtime: mission.runtime,
                sandbox: mission.sandbox,
                model: mission.model,
                peer: mission.peer,
                relay: mission.relay
              },
              posted
            )
          } catch {
            // The share stands and is recorded; a relay that could not start
            // is the relay's own notice to give, not a failure of this run.
          }
        }
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
      followUpOf?: string,
      relay?: RelayOrigin,
      startedBy?: MissionStarter
    ): Promise<CodexMissionStartResponse> {
      // `account-default` is the shell's word for "send no --model", not a
      // model id. Passing it through would make the CLI look for a model that
      // does not exist.
      const chosenModel =
        route.model === undefined || route.model === 'account-default' ? undefined : route.model
      // Before anything is recorded or spawned: a drive's window spends
      // nothing, whichever way the run was asked for (free-routes.ts).
      if (options.freeRoutesOnly === true && !isFreeRoute(runtime, chosenModel)) {
        return error('RUNTIME_START_FAILED', FREE_ONLY_REFUSAL) as CodexMissionStartResponse
      }
      // Read-only unless the renderer explicitly asked for edits. The host
      // decides the sandbox from this one value; the renderer never passes a
      // sandbox string of its own.
      //
      // Auto is checked against the workspace switch here, not taken on the
      // caller's word. A window left open across a change of mind, or a
      // routine recorded while Auto was on, would otherwise carry the widest
      // sandbox into a workspace that has since said no. Refused rather than
      // quietly narrowed: a person who chose Auto and silently got the folder
      // back would only find out from a run that could not do its job.
      if (mode === 'auto' && !(await (options.autoModeAllowed ?? (async () => false))())) {
        return error(
          'RUNTIME_START_FAILED',
          'Auto mode is switched off for this workspace. Turn it on in Settings to let a run work outside the workspace folder. Nothing was recorded.'
        ) as CodexMissionStartResponse
      }
      // Approve-each is workspace-write: approvals only mean something when
      // the run could otherwise act, and the server stops it before each act.
      // It used to fall through to read-only here because it never reached
      // this loop at all -- it had a service of its own -- and three other
      // start paths refused it rather than run it wrong. It runs here now.
      const sandbox: MissionSandbox =
        mode === 'auto'
          ? 'full-access'
          : mode === 'accept-edits' || mode === 'approve-each'
            ? 'workspace-write'
            : 'read-only'
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
        //
        // EXCEPT the next turn of a run that has already ended. A run's
        // terminal events reach the window before this service lets go of it
        // -- the disk observation and the share come after -- and a message
        // queued behind that run goes the moment the window sees it end. It
        // was refused here as "already has a mission running", and the queue
        // had nothing left to wait behind, so the message was dropped and the
        // window was left on a run that no longer existed (drive-long-
        // conversation on 0.297, 2026-09-23: turn 5 never ran). A follow-up of
        // that very mission, on the same runtime, is the conversation going
        // on, not a second run beside it. On another runtime it checkpoints
        // the record the bookkeeping is still writing to, so that one waits.
        const winding = (mission: ActiveCodexMission): boolean =>
          mission.settled && followUpOf !== undefined && mission.missionId === followUpOf && mission.runtime === runtime
        const live = [...active.values()].filter((mission) => !winding(mission))
        const ownerBusy = starting.has(owner) || live.some((mission) => ownerKeyOf(mission.peer) === owner)
        if (ownerBusy) {
          return error(
            'RUN_ALREADY_ACTIVE',
            peer === undefined
              ? 'Wait for the active Codex mission to finish or cancel it first.'
              : `${peer.self.name} already has a mission running. Wait for it to finish or stop it first.`
          ) as CodexMissionStartResponse
        }
        if (starting.size + live.length + (options.liveElsewhere ?? (() => 0))() >= MAX_LIVE_MISSIONS) {
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
          runtimes = await options.discover(runtime)
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
          if (prior === undefined) {
            return error(
              'RUNTIME_START_FAILED',
              'That conversation cannot be continued: its earlier mission is not in the ledger.'
            ) as CodexMissionStartResponse
          }
          if (prior.metadata.runtime !== runtime) {
            // A reply on ANOTHER runtime. This used to be refused ("switch the
            // route back, or hand the mission over"), and the person's
            // workaround was a fresh mission with the filenames and the task
            // retyped -- the 0.21.2 QA pass did exactly that after a quota
            // failure. It is a handoff without the stop: the earlier mission
            // is reconciled, the briefing carries what was done and what was
            // left unsettled, and the reply rides on it as the latest word.
            let checkpoint
            try {
              checkpoint = await options.ledger.createCheckpoint(prior.metadata.missionId, 'route-switch')
            } catch {
              return error(
                'RUNTIME_START_FAILED',
                'That conversation could not be reconciled, so it cannot be continued on another runtime.'
              ) as CodexMissionStartResponse
            }
            if (checkpoint.resumeSafety === 'unsafe') {
              return error(
                'RUNTIME_START_FAILED',
                `That conversation cannot be continued safely on another runtime: ${checkpoint.safetyReason}`
              ) as CodexMissionStartResponse
            }
            const briefing = composeHandoffPrompt(
              prior.metadata.prompt,
              checkpoint,
              runtimeDisplayName(prior.metadata.runtime),
              prompt
            )
            if (briefing === undefined) {
              return error(
                'RUNTIME_START_FAILED',
                'That conversation is too long to carry to another runtime with this reply.'
              ) as CodexMissionStartResponse
            }
            // Re-enter as a route-switch continuation of the prior mission:
            // the same record the live handoff writes, so the thread draws
            // the same divider and a reopened conversation stitches the same
            // way. The briefing, not the bare reply, starts the new runtime.
            // This call holds the owner's in-flight claim; the re-entry
            // would see it and refuse itself, so it is released first.
            if (claimed) {
              starting.delete(owner)
              claimed = false
            }
            return service.start(
              briefing.prompt,
              runtime,
              mode,
              route,
              emit,
              { missionId: prior.metadata.missionId, checkpointEpoch: checkpoint.epoch, reason: 'route-switch' },
              peer,
              undefined,
              relay,
              startedBy
            )
          }
          // A prior turn that failed before its runtime started recorded no
          // session. That used to refuse the reply outright; now the turn is
          // recorded as continuing that conversation and the runtime simply
          // starts fresh, because a person replying to a failure is still
          // replying to it. `resumeThreadId` staying undefined is what makes
          // the run cold: no `exec resume`, no borrowed context.
          // A resumed session keeps the tools it was BUILT with, so a mode
          // the person changed since cannot reach it: the chip said "Accept
          // edits" while the runtime still answered "this session has no
          // write, edit, or bash tools" (outside tester, 2026-09-07).
          //
          // So a changed mode starts cold rather than resuming. The thread
          // already says what that costs -- "Started without the earlier
          // messages" -- and that is a smaller thing to lose than the
          // guarantee that the mode on screen is the mode being run.
          const priorMode = prior.metadata.mode
          const modeChanged = priorMode !== undefined && priorMode !== mode
          resumeThreadId = modeChanged ? undefined : priorThread
          resumedMissionId = prior.metadata.missionId
        }

        const runId = `run_${createId()}`
        const missionId = `mission_${createId()}`
        const controller = new AbortController()
        const createdAt = now().toISOString()
        const routeId =
          runtime === 'claude'
            ? 'claude'
            : runtime === 'opencode'
              ? 'opencode'
              : runtime === 'copilot'
                ? 'copilot'
                : runtime === 'muse'
                  ? 'muse'
                  : 'codex'
        // ONE definition of what this run may touch, computed before anything
        // records it, so the durable header and the receipt agree with what
        // the process was actually allowed to do.
        //
        // Claude Code used to be forced to `read-only` here on the reading
        // that it takes no sandbox. It takes a different one: the permission
        // mode and the tool list, which `createClaudePrintCommand` now sets
        // from this very value -- `acceptEdits` with the editing tools named,
        // or `plan` with a reading list. MEASURED 2026-09-03: while this line
        // still forced read-only, a mission started in Accept edits recorded
        // `sandbox: read-only`, ran in plan mode, and its Write came back
        // "No such tool available: Write. Write is disabled for this
        // session." The composer offered a mode the run never received.
        const effectiveSandbox: MissionSandbox = sandbox
        // Cursor's plan mode asks a model not to write; only its sandbox stops
        // one, and that sandbox exists on macOS and Linux alone. Measured on
        // Windows: a plan-mode run told firmly to write created two files.
        // Rather than record `read-only` over a run that can edit, the mission
        // is refused and the person is told which mode does what they meant.
        if (
          runtime === 'cursor'
          && effectiveSandbox === 'read-only'
          && !cursorCanEnforceReadOnly(hostPlatform)
        ) {
          return error(
            'RUNTIME_START_FAILED',
            'Cursor Agent cannot be held read-only on this system: its sandbox needs macOS or Linux, and plan mode alone does not stop it editing files. Choose "Accept edits" if it may change this workspace, or run this on Codex CLI or Claude Code.'
          ) as CodexMissionStartResponse
        }
        const resolvedRouteId = `${routeId}-account:default`
        const normalizerContext = {
          runId,
          missionId,
          requestedRouteId: routeId,
          resolvedRouteId,
          ...(chosen.version?.version === undefined ? {} : { cliVersion: chosen.version.version }),
          now
        }
        // Copilot resumes by a session id the HOST chooses on a first run, so
        // the host mints it here and hands the same id to the normalizer; the
        // receipt then names a session that can really be resumed even if the
        // stream never echoes it back.
        const copilotSessionId = runtime === 'copilot' ? (resumeThreadId ?? randomUUID()) : undefined
        // Codex speaks app-server whenever the host can start one. The two
        // normalizers read different protocols, so this decision and the
        // command built below are the same decision and are made from the
        // same value.
        const codexStreams = runtime === 'codex' && options.appServerSpawn !== undefined
        // What the run has announced it will change, by item id. Read off the
        // stream so a file-change tool row can carry its diff, and so an
        // approval card for that item can show what it is about.
        const changesByItem = new Map<string, readonly FileChangeRecord[]>()
        const appServerNormalizer = (): CodexEventNormalizer => {
          const inner = asProcessNormalizer(createAppServerEventNormalizer({ ...normalizerContext, runtime: 'codex' }))
          return {
            get runtimeThreadId() {
              return inner.runtimeThreadId
            },
            get finalized() {
              return inner.finalized
            },
            accept: (record) => {
              const notification = notificationOfRecord(record)
              const found = notification === undefined ? undefined : itemOf(notification.params)
              if (found !== undefined) {
                const changes = fileChangesOf(found.item)
                if (changes !== undefined) changesByItem.set(found.id, changes)
              }
              return withFileChanges(inner.accept(record), changesByItem, runCwd)
            },
            finish: (completion) => inner.finish(completion)
          }
        }
        const normalizer = codexStreams
          ? appServerNormalizer()
          : runtime === 'claude'
          ? createClaudeEventNormalizer(normalizerContext)
          : runtime === 'cursor'
            ? createCursorEventNormalizer(normalizerContext)
            : runtime === 'opencode'
              ? createOpenCodeEventNormalizer(normalizerContext)
              : runtime === 'copilot'
                ? createCopilotEventNormalizer({ ...normalizerContext, sessionId: copilotSessionId! })
                : runtime === 'muse'
                  ? createMuseEventNormalizer(normalizerContext)
                  : createCodexEventNormalizer(normalizerContext)

        // The argv, decided BEFORE anything durable is written. The builders
        // refuse what they cannot honour -- an effort for a runtime that has
        // no effort flag, a model that is not plain text -- and a refusal
        // there used to leave a mission file and a failure record behind for
        // a run that never existed. Nothing created today can be pruned
        // today, so those files were permanent.
        // Narrowed above; captured so the closure below keeps the narrowing.
        const executable = chosen.executable
        // The teammate's own worktree when it has one, else the folder. The
        // ledger's workspace id stays the FOLDER's: history is per folder.
        const runCwd = peer?.cwd ?? options.workspacePath
        // Named by whoever made the worktree, not inferred from this folder:
        // a teammate with its own folder is in a worktree of a repository
        // that is not this one. Absent unless the run really is in a
        // worktree.
        const repositoryRoot = peer?.repositoryRoot
        /*
         * Somewhere for a Claude Code run to ASK before using a connector.
         *
         * Auto asks nothing, so it gets no bridge. Every other mode used to
         * have nowhere to put the question and refused every connector call;
         * then 0.61.0 allowed them all without asking. This is the asking:
         * the run is registered with the host, which mints it a token and an
         * mcp.json, and the card the app already has answers.
         */
        const askEveryConnector =
          globalThis.process.env.LOCUST_ASK_CONNECTORS === '1' || (await options.askConnectors?.()) === true
        const permissionBridge =
          runtime === 'claude' && effectiveSandbox !== 'full-access' && options.permissionHost !== undefined
            ? await options.permissionHost.register({ runId, missionId, cwd: runCwd })
            : undefined
        let command: RuntimeCommandSpec
        // OpenCode and Copilot take the prompt as an argument, not on stdin,
        // so their argv is built once now with the person's own words -- so a
        // builder's refusal still lands before anything durable -- and again
        // below with the prompt the runtime is actually sent.
        const buildCommand = (promptText: string): RuntimeCommandSpec => {
          const chosenEffort = route.effort
          const choice = {
            ...(chosenModel === undefined ? {} : { model: chosenModel }),
            ...(chosenEffort === undefined ? {} : { effort: chosenEffort }),
            ...(resumeThreadId === undefined ? {} : { resumeThreadId })
          }
          if (runtime === 'opencode') {
            return createOpenCodeRunCommand(executable, {
              workspacePath: runCwd,
              sandbox: effectiveSandbox,
              prompt: promptText,
              // Only when this run is in a worktree, which is exactly when
              // the folder it stands in is not the repository it belongs to.
              ...(repositoryRoot === undefined ? {} : { repositoryRoot }),
              ...choice
            })
          }
          if (runtime === 'muse') {
            // The prompt is named here only so the builder can refuse an
            // empty one before anything durable is written. What Muse is
            // SENT is the file the runner writes from `runtimePrompt`, which
            // is the same text every other runtime receives.
            return createMuseExecCommand(executable, {
              workspacePath: runCwd,
              sandbox: effectiveSandbox,
              prompt: promptText,
              ...choice
            })
          }
          if (runtime === 'copilot') {
            return createCopilotPromptCommand(executable, {
              workspacePath: runCwd,
              sandbox: effectiveSandbox,
              prompt: promptText,
              ...(chosenModel === undefined || chosenModel === 'auto' ? {} : { model: chosenModel }),
              ...(resumeThreadId === undefined ? { sessionId: copilotSessionId } : { resumeThreadId })
            })
          }
          return runtime === 'claude'
            ? createClaudePrintCommand(executable, {
                workspacePath: runCwd,
                ...(permissionBridge === undefined ? {} : { permissionBridge }),
                // Every connector the person's own Claude Code can reach.
                // Without a named allow rule the tools are offered and every
                // call is refused, because a printed run has nowhere to put
                // the approval question.
                ...(() => {
                  /*
                   * `LOCUST_ASK_CONNECTORS=1` sends NO allow rules, so every
                   * connector call goes to the permission host and the person
                   * is asked. Today it is the seam the host is driven through
                   * -- with the rules in place a covered connector never asks,
                   * which is Colin's ruling and the normal state. It is also
                   * the shape of a future "ask me each time" setting.
                   */
                  if (askEveryConnector) return {}
                  // The teammate's own list when it has one -- a NARROWING of
                  // what the person has -- else everything the person has.
                  const named = peer?.connectors ?? options.connectors?.() ?? []
                  return named.length === 0 ? {} : { connectors: named }
                })(),
                // Claude's containment IS this value: it picks the permission
                // mode and the tool list. Leaving it out defaulted every
                // Claude run to read-only, so a mission started in Accept
                // edits ran in plan mode and answered "I don't have a Write
                // tool available in this session" -- measured 2026-09-03.
                sandbox: effectiveSandbox,
                ...choice
              })
            : runtime === 'cursor'
              ? createCursorPrintCommand(executable, {
                  workspacePath: runCwd,
                  sandbox: effectiveSandbox,
                  ...choice
                })
              : codexStreams
              ? createCodexAppServerCommand(executable, {
                  workspacePath: runCwd,
                  sandbox: effectiveSandbox,
                  // Switches Codex's plan tool on, so its plan reaches the
                  // panel rather than being typed into the reply (0.304).
                  ...(chosen?.version?.version === undefined ? {} : { cliVersion: chosen.version.version })
                })
              : createCodexExecCommand(executable, {
                  workspacePath: runCwd,
                  sandbox: effectiveSandbox,
                  ...choice
                })
        }
        /*
         * Outside Auto, Cursor asks before every connector call and a print
         * run has nobody to answer -- 17 "user rejected" in one Accept-edits
         * run (Colin's ledger, 2026-09-16). Auto passes `--force` and never
         * asks. Every other mode gets the answer written down where Cursor
         * reads it, before the run starts. Best effort: a workspace that
         * cannot be written leaves the run exactly as it was.
         */
        if (runtime === 'cursor' && effectiveSandbox !== 'full-access' && options.allowConnectors !== undefined) {
          const added = await options.allowConnectors(runCwd).catch(() => [] as readonly string[])
          if (added.length > 0) options.note?.('connectors-allowed', `${missionId} ${added.join(' ')}`)
        }
        try {
          command = buildCommand(prompt)
        } catch (cause) {
          // The builder's own sentence is the reason; one line for every
          // reason hid "Cursor Agent takes no effort level" for a day.
          const why = cause instanceof Error && cause.message.length > 0 ? ` ${cause.message}.` : ''
          return error(
            'RUNTIME_START_FAILED',
            `That runtime cannot be started with the options chosen.${why} Nothing was recorded.`
          ) as CodexMissionStartResponse
        }

        // What the runtime is SENT is the person's words plus their teammates'
        // waiting messages and the share form. The ledger keeps the person's
        // words as the prompt and the delivered messages by id; the rest is
        // deterministic over those.
        let runtimePrompt = prompt
        let delivered: readonly WorkroomMessage[] = []
        let peerDeliveryFailed = false
        if (peer !== undefined && peerExchange !== undefined) {
          // The turn this one continues, so the brief can find the
          // conversation's group. A route switch names it in `continuation`;
          // a follow-up in `resumedMissionId`; a first turn has none.
          const prepared = await peerExchange.prepare(prompt, peer, runtime, {
            ...(continuation?.missionId ?? resumedMissionId ?? followUpOf) === undefined
              ? {}
              : { previousMissionId: continuation?.missionId ?? resumedMissionId ?? followUpOf }
          })
          runtimePrompt = prepared.runtimePrompt
          delivered = prepared.delivered
          peerDeliveryFailed = prepared.failed
        } else if (peerExchange !== undefined) {
          /*
           * A run that belongs to nobody still stands in the project folder
           * and still has the project's memory. It used to be briefed with
           * neither, because the whole briefing hung on a teammate (Grok,
           * pass 14, ranked second: the secret word answered NONE and no
           * memory file anywhere). Nothing here needs a roster.
           */
          runtimePrompt = await peerExchange.briefSolo(prompt, runtime, {
            ...(continuation?.missionId ?? resumedMissionId ?? followUpOf) === undefined
              ? {}
              : { previousMissionId: continuation?.missionId ?? resumedMissionId ?? followUpOf }
          })
        }
        // Plan first, for a teammate's mission or a plain one. Appended last
        // so it is the instruction closest to the model's answer.
        //
        // The sandbox is checked as well as the mode, and the pair is what a
        // mutation guard holds: with Plan as a MODE the mapping above already
        // makes it read-only, so this condition cannot currently be half
        // true -- which is exactly why the guard targets the mapping instead
        // of this line. A "plan" that could edit the workspace is a promise
        // the app cannot keep, whichever of the two ever changes.
        if (mode === 'plan' && sandbox === 'read-only') {
          runtimePrompt = [runtimePrompt, planSection()].join('\n\n')
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
            // What was ASKED for, beside what it was allowed. `ask` and
            // `plan` are both read-only, so without this a plan reopened
            // after a restart came back as an ordinary read-only run and
            // lost its "Build this plan" offer (QA, 2026-09-06).
            mode,
            executionPolicyVersion: 1,
            createdAt,
            ...(continuation === undefined
              ? resumedMissionId === undefined
                ? {}
                : {
                    continuesFrom: {
                      missionId: resumedMissionId,
                      // Follow-ups do not reconcile: nothing stopped, so there
                      // is no checkpoint to point at. Epoch 1 is the mission's
                      // own first, which is the only one a reader could mean.
                      checkpointEpoch: 1,
                      reason: 'follow-up' as const,
                      // Absent when the turn being continued left no session:
                      // the record then says "this followed that" without
                      // claiming a resume that never happened.
                      ...(resumeThreadId === undefined ? {} : { runtimeThreadId: resumeThreadId })
                    }
                  }
              : { continuesFrom: continuation }),
            // Who started this run. The relay starts a teammate's reply with a
            // prompt the HOST wrote, and until this was recorded the file said
            // only what every other mission says -- so the app had no way to
            // tell a conversation a person began from one it began itself, and
            // presented both the same way.
            ...(relay !== undefined
              ? { startedBy: { kind: 'relay' as const, hop: relay.hop } }
              : startedBy === undefined
                ? {}
                : { startedBy }),
            // What was actually run, so a failure can be diagnosed from the
            // record instead of by reconstructing the command from the builder
            // and hoping the reconstruction matched -- which is how eight
            // experiments went on 2026-09-05.
            //
            // The command built HERE, not the one rebuilt below for runtimes
            // that take the prompt as an argument. They differ only in the
            // prompt text, and the prompt is replaced by a marker either way,
            // so the recorded value is identical -- and taking this one keeps
            // the briefing, which is longer and quotes teammates, out of it.
            command: recordableCommand(command, prompt)
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

        let diskBefore: WorkspaceSnapshot | undefined
        let process: RuntimeProcessRun
        try {
          // The prompt the runtime is sent is the person's words plus their
          // teammates' messages; a runtime that takes it on the argv gets the
          // same text there. Options were validated above, so this cannot refuse.
          if (command.stdin === 'none') command = buildCommand(runtimePrompt)
          // Refused HERE rather than by cmd.exe, which answers a too-long
          // command line with exit 1, no output, and one line on stderr --
          // reported to the person as the runtime failing for no stated
          // reason. This is the last point at which the real length is known,
          // because the workroom briefing has just been folded in.
          const tooLong = commandTooLong(command)
          if (tooLong !== undefined) throw new Error(tooLong)
          // Look at the tree BEFORE the runtime can touch it. Only when it may:
          // a read-only run has nothing to observe, and asking git for every
          // question would be paying for an answer nobody reads.
          diskBefore = effectiveSandbox === 'read-only' ? undefined : await (options.observeDisk ?? snapshotWorkspace)(runCwd)
          if (codexStreams) {
            // The policy is chosen here, not carried in the argv, because on
            // this transport it is JSON on a socket -- so the rule that only
            // a full-access mission may say `danger-full-access` is enforced
            // at the point it is chosen. See `codexAppServerPolicy`.
            const policy = codexAppServerPolicy(effectiveSandbox, mode)
            // Approve-each stops to ask, and this is who answers. Any other
            // mode never asks, and the run's default refuses just in case.
            const onRequest =
              mode === 'approve-each' && options.approvals !== undefined
                ? options.approvals.requestHandlerFor({ runId, missionId, cwd: runCwd, changesByItem })
                : undefined
            process = startCodexAppServerRun({
              spawn: options.appServerSpawn!,
              command,
              prompt: runtimePrompt,
              sandbox: policy.sandbox,
              approvalPolicy: policy.approvalPolicy,
              ...(onRequest === undefined ? {} : { onRequest }),
              ...(chosenModel === undefined ? {} : { model: chosenModel }),
              ...(route.effort === undefined ? {} : { effort: route.effort }),
              ...(resumeThreadId === undefined ? {} : { resumeThreadId }),
              signal: controller.signal,
              now
            })
          } else {
            process = options.runner.start(command, runtimePrompt, { signal: controller.signal })
          }
        } catch (startError) {
          // A refusal this file raised knows WHY; anything else does not, and
          // must not borrow a specific-sounding reason it cannot back.
          const why = startError instanceof Error && startError.message.length > 0
            ? startError.message
            : 'The Codex process could not be started safely.'
          // A run that never started still registered a token. Let it go.
          void options.permissionHost?.release(runId).catch(() => undefined)
          try {
            await options.ledger.appendHostFailure(missionId, {
              code: 'runtime-start-failed',
              message: why,
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
            why
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
          transcript: createTranscriptTracker(),
          sandbox: effectiveSandbox,
          model: chosenModel,
          relay,
          diskBefore,
          cwd: runCwd,
          sharedTree: false,
          settled: false,
          saidWhyAReadFailed: false,
          lastSequence: 0,
          persisted: []
        }
        active.set(runId, mission)
        /*
         * Before anything runs: has Cursor been told not to look at this
         * folder?
         *
         * Its file tools refuse an ignored path with "permission denied" and
         * no reason, so the model explains the failure by inventing a cause,
         * and the invention is what the person reads and then chases. Three
         * incidents on one machine (`shared/cursorIgnore.ts`), the last of
         * them a screenshot LOCUST had written into the workspace it then
         * handed over.
         *
         * Best effort, and never fatal: a run that can still use its shell
         * may do perfectly good work. What it cannot do is explain itself.
         */
        // Whoever else is writing in this same folder right now: neither of
        // us can be credited with what the tree looks like afterwards.
        if (mission.diskBefore !== undefined) {
          for (const other of active.values()) {
            if (other.runId === runId || other.cwd !== runCwd || other.diskBefore === undefined) continue
            // Still in `active` is not the same as still running. A run whose
            // process has exited is not sharing anything with this one, and
            // treating it as though it were is what put the notice on every
            // relayed reply.
            if (other.settled) continue
            other.sharedTree = true
            mission.sharedTree = true
          }
        }
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
            ...(resumedMissionId === undefined
              ? {}
              : {
                  followsUp: {
                    missionId: resumedMissionId,
                    ...(resumeThreadId === undefined ? {} : { runtimeThreadId: resumeThreadId })
                  }
                })
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
      // Refused BEFORE the abort, while the run's client is still alive, so
      // the runtime hears the refusal rather than only losing its pipe. The
      // same release happens again in `clearActive` for every other way a run
      // can end, and is idempotent; doing it only there would resolve the
      // pending promise after the client had been disposed, and the answer
      // would go nowhere. The old approval service released in this order too.
      options.approvals?.release(mission.runId)
      mission.controller.abort()
      return {
        ok: true,
        data: {
          runId: mission.runId,
          state: 'cancellation-requested'
        }
      }
    },

    decide(answer: MissionApprovalAnswer): boolean {
      return options.approvals?.decide(answer) ?? false
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

    async resume(
      missionId: unknown,
      runtime: MissionRuntimeId,
      mode: MissionMode,
      route: { readonly model?: string; readonly effort?: string },
      emit: (update: CodexMissionUpdate) => void
    ): Promise<MissionHandoffResponse> {
      if (!validRunId(missionId)) {
        return error('RUN_NOT_ACTIVE', 'That mission id is not one this app wrote.') as MissionHandoffResponse
      }
      // A mission still running has nothing to resume, and starting a second
      // run against the same work would have two processes writing the same
      // tree. Cancel it or let it finish first.
      if ([...active.values()].some((mission) => mission.missionId === missionId)) {
        return error(
          'HANDOFF_REFUSED',
          'That mission is still running, so there is nothing to resume.'
        ) as MissionHandoffResponse
      }

      let recovered
      try {
        recovered = await options.ledger.getMission(missionId)
      } catch {
        recovered = undefined
      }
      if (recovered === undefined) {
        return error(
          'HANDOFF_REFUSED',
          'That mission could not be read back from the local ledger, so there is nothing to continue from.'
        ) as MissionHandoffResponse
      }

      let checkpoint
      try {
        checkpoint = await options.ledger.createCheckpoint(missionId, 'manual')
      } catch {
        return error(
          'HANDOFF_REFUSED',
          'The mission could not be reconciled, so nothing was resumed.'
        ) as MissionHandoffResponse
      }

      // Same rule as a handoff, and for the same reason: `unsafe` means the
      // ledger itself is damaged, and a briefing built from a record that
      // cannot be trusted would carry that damage into a fresh run under a
      // confident heading. The renderer already declines to offer this, so
      // reaching here means the offer and the record disagreed -- which is
      // exactly when the host must not take the renderer's word for it.
      if (checkpoint.resumeSafety === 'unsafe') {
        return error(
          'HANDOFF_REFUSED',
          `This mission cannot be resumed: ${checkpoint.safetyReason}`
        ) as MissionHandoffResponse
      }

      const briefing = composeHandoffPrompt(
        recovered.metadata.prompt,
        checkpoint,
        runtimeDisplayName(recovered.metadata.runtime)
      )
      if (briefing === undefined) {
        return error(
          'HANDOFF_REFUSED',
          'The original request is too long to carry into a resumed run.'
        ) as MissionHandoffResponse
      }

      const started = await service.start(
        briefing.prompt,
        runtime,
        mode,
        route,
        emit,
        // A resume continues the same conversation on the same runtime, so it
        // is a follow-up rather than a route switch -- drawing a handoff
        // divider here would claim a change of runtime that did not happen.
        { missionId, checkpointEpoch: checkpoint.epoch, reason: 'follow-up' },
        undefined,
        undefined,
        undefined,
        { kind: 'resume', epoch: checkpoint.epoch }
      )
      if (!started.ok) {
        return {
          ok: false,
          error: {
            code: started.error.code,
            message: `The mission could not be resumed. ${started.error.message}`
          }
        }
      }

      return {
        ok: true,
        data: {
          ...started.data,
          continuesFrom: { missionId, checkpointEpoch: checkpoint.epoch },
          resumeSafety: checkpoint.resumeSafety,
          omittedBriefing: briefing.omitted,
          unsettledCount: checkpoint.unsettledActions.length
        }
      }
    },

    hasMission(missionId: string): boolean {
      return [...active.values()].some((mission) => mission.missionId === missionId)
    },

    runIdOwnedBy(teammateId: string): string | undefined {
      return [...active.values()].find((mission) => ownerKeyOf(mission.peer) === teammateId)?.runId
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
