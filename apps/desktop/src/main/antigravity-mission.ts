import { workspaceIdFor } from './workspace.js'
import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'

import type { MissionLedger, Workroom, WorkroomMessage } from '@teammate/mission-store'
import { antigravityMessageStep, createAntigravityEventNormalizer, hasAntigravityGap, withRestoredGaps } from '@teammate/runtime-adapters'
import type { NormalizedRuntimeEvent, RuntimeProcessCompletion, ToolQuestion } from '@teammate/runtime-adapters'

import type { CodexMissionUpdate, MissionApprovalAnswer, MissionApprovalRequest, MissionQuestion, PublicPeerMessage } from '../shared/ipc.js'
import { createCascadeApi } from './antigravity-cascade.js'
import type { AntigravityPendingQuestion, AntigravityQuestionResponse, CascadeApi } from './antigravity-cascade.js'
import { createAgentApi, projectIdFor, transcriptPathFor } from './antigravity-host.js'
import type { AgentApi, AntigravityHost } from './antigravity-host.js'
import { runtimeThreadIdOf } from './codex-mission.js'
import { changedPaths, observedEditEvents, observedPatches, sharedTreeNotice, snapshotWorkspace, unreportedPaths } from './disk-observation.js'
import type { WorkspaceSnapshot } from './disk-observation.js'
import { createPeerExchange, createTranscriptTracker, publicPeerMessage } from './peer-exchange.js'
import { deliverWhenRuntimeStarts } from './runtime-delivery.js'
import type { MemoryBriefing } from './peer-exchange.js'
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
/**
 * The same number as every other transport, because the cap is ONE pool.
 *
 * It was a literal 4 here, a literal 4 in codex-mission.ts and a literal 4
 * in the approval transport that has since been folded into it -- three
 * copies of one decision. When the cap was measured and raised on 2026-09-09
 * only one of them moved, and the transports disagreed until
 * `approve-each-reaches-every-start` caught it.
 * A re-export cannot drift.
 */
import { MAX_LIVE_MISSIONS as MAX_LIVE_ANTIGRAVITY_MISSIONS } from '../shared/live-missions.js'
import { FREE_ONLY_REFUSAL } from './free-routes.js'

export { MAX_LIVE_ANTIGRAVITY_MISSIONS }
/** No new transcript line for this long means the agent is not coming back. */
export const ANTIGRAVITY_IDLE_TIMEOUT_MS = 10 * 60_000

/**
 * HOW OFTEN A LIVE RUN IS LOOKED AT (0.608). Once a second put each of
 * Antigravity's steps on the thread up to a second late, half a second on
 * average -- the longest tail of any runtime (the Fable review, 2026-10-04,
 * item 7). Four times a second now, and cheap: the poll stats the transcript
 * first and reads it only when its size or time has moved (`seen`), so a run
 * that is thinking costs four stats a second, not four reads of a file that
 * grows for an hour.
 */
export const ANTIGRAVITY_POLL_MS = 250
/**
 * How long a silence with a tool still open may last before the person is
 * told it might be a question. Ninety seconds: long enough that an ordinary
 * slow step does not raise it, short enough that nobody watches a still
 * screen wondering.
 */
export const ANTIGRAVITY_ASKING_NOTICE_MS = 90_000
/**
 * How many looks, one a poll, for the step that waits on a question's answer
 * before the card goes up without it -- saying to answer in Antigravity. The
 * step is written a moment after the call that asks (two seconds, measured).
 */
export const ANTIGRAVITY_QUESTION_LOOKUPS = 8
const NOBODY = ''

export interface AntigravityMissionOptions {
  readonly workspacePath: string
  /**
   * Refuse every run: Antigravity has no free route, and a drive's window may
   * only use free ones. See `free-routes.ts`.
   */
  readonly freeRoutesOnly?: boolean
  /** The teammate's monthly limit, checked before every start (codex-mission.ts). */
  readonly spendRefusal?: (teammateId: string) => Promise<string | undefined>
  readonly ledger: MissionLedger
  /** Missions live on the other transports; the cap is one pool. See codex-mission.ts. */
  readonly liveElsewhere?: () => number
  readonly workroom?: Workroom
  /** What the team remembers, briefed to every teammate mission. */
  readonly memory?: MemoryBriefing
  readonly probe: () => Promise<AntigravityHost | undefined>
  readonly emitEvent: (runId: string, missionId: string, event: unknown) => void
  readonly emitUpdate?: (update: CodexMissionUpdate) => void
  readonly onShared?: (mission: SharingMission, posted: readonly WorkroomMessage[]) => Promise<void>
  readonly onRunEnded?: (mission: EndedMission) => Promise<void>
  /** Test seams. */
  readonly agentApi?: (host: AntigravityHost) => AgentApi
  readonly readTranscript?: (path: string) => Promise<string | undefined>
  /** The folder before and after a run, and the change behind a path; test seams (codex-mission.ts has the same two). */
  readonly observeDisk?: (workspacePath: string) => Promise<WorkspaceSnapshot | undefined>
  readonly observePatches?: typeof observedPatches
  readonly home?: string
  readonly createId?: () => string
  readonly now?: () => Date
  readonly pollMs?: number
  /** The transcript's size and time, for the poll to skip an unmoved file (0.608). Test seam; absent means every poll reads. */
  readonly statTranscript?: (path: string) => Promise<{ readonly size: number; readonly mtimeMs: number } | undefined>
  readonly idleTimeoutMs?: number
  /** How long an open tool may be silent before the person is told. Test seam. */
  readonly askingNoticeMs?: number
  /** A note into the mission's own thread; absent means the notice is not drawn. */
  readonly notify?: (input: { runId: string; missionId: string; message: string }) => void
  /**
   * Raise a question card, and take one down that was answered elsewhere.
   * Absent: a question is only its row in the thread, as before 0.280.
   */
  readonly emitApproval?: (request: MissionApprovalRequest) => void
  readonly withdrawApproval?: (approvalId: string) => void
  /** Test seam: Antigravity's own server, which takes a question's answer. */
  readonly cascadeApi?: (host: AntigravityHost) => CascadeApi
  /** Test seam: looks for the waiting step before the card goes up without it. */
  readonly questionLookups?: number
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
  /** The run this teammate has going here, if any. */
  runIdOwnedBy(teammateId: string): string | undefined
  /**
   * The person's answer to a question card this service raised. False when
   * no question here is waiting under that id, or Antigravity did not take
   * the answer (said in the thread).
   */
  decide(answer: MissionApprovalAnswer): Promise<boolean>
  dispose(): Promise<void>
}

/**
 * Why an Antigravity mission did not start.
 *
 * `busy` marks the two refusals that waiting fixes (A2.19): this teammate is
 * mid-run, or every Antigravity slot is taken (`pool`). The relay HOLDS a
 * reply for a busy recipient and starts it when a run ends; told only the
 * sentence, it refused the reply as if Antigravity could not take it.
 */
export class AntigravityStartError extends Error {
  constructor(message: string, readonly busy?: 'teammate' | 'pool' | 'limit') {
    super(message)
  }
}

/**
 * A failed Antigravity start, as the relay reads a start (A2.19): busy is
 * RUN_ALREADY_ACTIVE -- `pool` when every slot is taken -- so the reply is
 * held and started when a run ends, the same as for every other runtime;
 * anything else is a start that failed.
 */
export function antigravityStartRefusal(error: unknown): {
  readonly ok: false
  readonly error: { readonly code: 'RUN_ALREADY_ACTIVE' | 'RUNTIME_START_FAILED' | 'SPEND_LIMIT_REACHED'; readonly message: string; readonly busy?: 'pool' }
} {
  // Not busy: at the limit, waiting for the run to end starts nothing.
  if (error instanceof AntigravityStartError && error.busy === 'limit') {
    return { ok: false, error: { code: 'SPEND_LIMIT_REACHED', message: error.message } }
  }
  if (error instanceof AntigravityStartError && error.busy !== undefined) {
    return { ok: false, error: { code: 'RUN_ALREADY_ACTIVE', message: error.message, ...(error.busy === 'pool' ? { busy: 'pool' as const } : {}) } }
  }
  return {
    ok: false,
    error: { code: 'RUNTIME_START_FAILED', message: error instanceof Error ? error.message : 'Antigravity could not start the mission.' }
  }
}

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

/** The transcript's size and time, or nothing when it cannot be stated -- then the poll reads, as it always did. */
async function statTranscriptFile(path: string): Promise<{ readonly size: number; readonly mtimeMs: number } | undefined> {
  try {
    const info = await stat(path)
    return { size: info.size, mtimeMs: info.mtimeMs }
  } catch {
    return undefined
  }
}

export function createAntigravityMissionService(options: AntigravityMissionOptions): AntigravityMissionService {
  const createId = options.createId ?? randomUUID
  const now = options.now ?? (() => new Date())
  const home = options.home ?? homedir()
  const readTranscript = options.readTranscript ?? readTranscriptFile
  const statTranscript = options.statTranscript ?? statTranscriptFile
  const pollMs = options.pollMs ?? ANTIGRAVITY_POLL_MS
  const idleTimeoutMs = options.idleTimeoutMs ?? ANTIGRAVITY_IDLE_TIMEOUT_MS
  /*
   * ASSERTED, not assumed: the notice must come before the ending.
   *
   * These are two clocks watching one silence, and the notice only fires in
   * the window between them -- so if the ending is set at or below the
   * notice, the notice is DEAD CODE and nobody finds out, because dead code
   * looks exactly like a silence that never happened. The suite already
   * contains a case where it is dead (an idle timeout of 20 ms against the
   * 90 s default), which is harmless there and is precisely how this reaches
   * production unnoticed.
   *
   * Builder.io's `agent-run-stop-conditions.md` §6.4 is the same finding on
   * a much bigger machine: their ordering invariants "were prose until this
   * branch", and one was already violated in a shipped build -- an
   * automation took a 13-minute budget under its own 10-minute abort,
   * "making its recoverable boundary dead code". Locust has twenty-odd
   * timeout constants and, before this line, no asserted ordering anywhere.
   * Read 2026-09-21; the idea is theirs, the code is ours.
   */
  const askingNoticeMs = Math.min(
    options.askingNoticeMs ?? ANTIGRAVITY_ASKING_NOTICE_MS,
    // Half, so a caller that shortens the ending still gets one notice
    // rather than silently losing it.
    Math.floor(idleTimeoutMs / 2)
  )
  const questionLookups = Math.max(1, options.questionLookups ?? ANTIGRAVITY_QUESTION_LOOKUPS)
  const peerExchange: PeerExchange | undefined =
    options.workroom === undefined ? undefined : createPeerExchange({
          workroom: options.workroom,
          ledger: options.ledger,
          ...(options.memory === undefined ? {} : { memory: options.memory })
        })
  const ownerKeyOf = (peer: MissionPeerContext | undefined): string => peer?.self.teammateId ?? NOBODY

  /**
   * A question the agent put to the person with `ask_question`, from the call
   * until its answer is in the transcript.
   */
  interface Asking {
    readonly itemId: string
    readonly question: ToolQuestion
    readonly approvalId: string
    /** The step waiting on the answer, with the ids an answer names; once found. */
    pending: AntigravityPendingQuestion | undefined
    lookups: number
    /** The card is up. */
    raised: boolean
    /** Answered from Locust; the transcript's completion is on its way. */
    answered: boolean
  }

  interface LiveRun {
    readonly runId: string
    readonly missionId: string
    readonly conversationId: string
    readonly model: AntigravityTier
    readonly peer: MissionPeerContext | undefined
    readonly relay: RelayOrigin | undefined
    readonly transcript: TranscriptTracker
    readonly deliverMessages: (events: readonly NormalizedRuntimeEvent[]) => Promise<void>
    readonly normalizer: ReturnType<typeof createAntigravityEventNormalizer>
    readonly transcriptPath: string
    readonly startedAt: string
    /** Lines already handed to the normalizer; a follow-up starts past the prior turns. */
    fed: number
    lastProgressAt: number
    /** Whether the person has already been told this silence looks like a question. */
    saidItMightBeAsking: boolean
    /** Antigravity's own server, for answering a question. */
    readonly cascade: CascadeApi
    /** The question waiting on the person, if the agent asked one. */
    asking: Asking | undefined
    timer: NodeJS.Timeout | undefined
    polling: boolean
    /** The transcript's size and time at the last read (0.608): an unmoved file is not read again. */
    seen: { readonly size: number; readonly mtimeMs: number } | undefined
    ended: boolean
    /** The folder as it was before the agent was told to begin; undefined when the host could not look. */
    readonly diskBefore: WorkspaceSnapshot | undefined
    /** Every event persisted for this run, for what the agent itself named (unreportedPaths). */
    readonly persisted: NormalizedRuntimeEvent[]
    /** The highest sequence persisted; a host note after the run takes the next. */
    lastSequence: number
    /** Another Antigravity run was live in this folder at the same time: the disk reading names nobody. */
    sharedTree: boolean
  }

  const runs = new Map<string, LiveRun>()
  const starting = new Set<string>()
  let disposed = false

  /** Thrown when the LEDGER refused, so a caller can tell it from a read error. */
  class LedgerWriteFailed extends Error {
    constructor(readonly cause: unknown) {
      super('The mission could not be written to the durable local ledger.')
    }
  }

  /*
   * End a run whose receipts cannot be written, and say so.
   *
   * Not persisted, because the ledger is the thing that just failed and
   * writing this through it would be the same failure again.
   */
  const endOnReceiptFailure = async (run: LiveRun): Promise<void> => {
    if (run.ended) return
    run.ended = true
    if (run.timer !== undefined) clearInterval(run.timer)
    runs.delete(run.runId)
    options.emitUpdate?.({
      kind: 'persistence-error',
      runId: run.runId,
      missionId: run.missionId,
      error: {
        code: 'MISSION_PERSISTENCE_FAILED',
        message: 'The mission could not be written to the durable local ledger.'
      }
    })
    // And that it ended, as every other end says: a relay reply held behind
    // this run, a room drain and memory reading all waited on it (B4 lead).
    if (options.onRunEnded !== undefined) {
      void options.onRunEnded({ missionId: run.missionId, peer: run.peer, relay: run.relay }).catch(() => undefined)
    }
    await Promise.resolve()
  }

  /*
   * A QUESTION, FROM THE CALL THAT ASKS IT TO THE ANSWER IN THE TRANSCRIPT.
   *
   * Yurt's beta run (2026-09-23) sat on an `ask_question` that Locust showed
   * only as a row among the folded tool calls; the agent waits in
   * Antigravity until someone answers. So the call raises the same question
   * card Codex's questions use -- the person is told by the OS if they are
   * looking elsewhere, and the teammate reads "waiting on you" -- and the
   * card answers it through Antigravity's own server (antigravity-cascade.ts).
   * If it is answered in Antigravity's window instead, the completion arrives
   * in the transcript and the card is taken down.
   */
  const settleQuestion = (run: LiveRun): void => {
    const asking = run.asking
    if (asking === undefined) return
    run.asking = undefined
    if (asking.raised) options.withdrawApproval?.(asking.approvalId)
  }

  const noteQuestions = (run: LiveRun, events: readonly NormalizedRuntimeEvent[]): void => {
    for (const event of events) {
      const payload = event.payload as { readonly itemId?: string; readonly question?: ToolQuestion }
      if (event.type === 'tool.started' && payload.question !== undefined && payload.itemId !== undefined) {
        // A newer question replaces one still open; the transcript is linear.
        settleQuestion(run)
        run.asking = {
          itemId: payload.itemId,
          question: payload.question,
          approvalId: `ap_${createId()}`,
          pending: undefined,
          lookups: 0,
          raised: false,
          answered: false
        }
      } else if ((event.type === 'tool.completed' || event.type === 'tool.failed') && payload.itemId === run.asking?.itemId) {
        settleQuestion(run)
      }
    }
  }

  /** A question's markdown links, as the words they show. */
  const plainQuestion = (text: string): string => text.replace(/\[([^\]]+)\]\([^)\s]+\)/g, '$1')

  const questionCard = (run: LiveRun, asking: Asking): MissionApprovalRequest => {
    const pending = asking.pending
    const questions: readonly MissionQuestion[] =
      pending === undefined
        ? [
            {
              id: '0',
              header: null,
              question: plainQuestion(asking.question.question),
              options: asking.question.options.map((label) => ({ label, description: null })),
              isOther: false,
              isSecret: false
            }
          ]
        : pending.questions.map((question, index) => ({
            id: String(index),
            header: null,
            question: plainQuestion(question.question),
            // Labels exactly as Antigravity sent them: an answer is matched
            // back to its option id by this text.
            options: question.options.map((option) => ({ label: option.text, description: null })),
            // Antigravity's card takes a written answer ("Other").
            isOther: true,
            isSecret: false
          }))
    return {
      approvalId: asking.approvalId,
      runId: run.runId,
      missionId: run.missionId,
      runtime: 'antigravity',
      kind: 'question',
      summary: pending?.action ?? 'Antigravity is asking you something',
      detail: '',
      cwd: options.workspacePath,
      requestedAt: now().toISOString(),
      questions,
      blocking: true,
      ...(pending === undefined ? { answerIn: 'Antigravity' } : { skippable: true })
    }
  }

  /** Look for the waiting step, and raise the card: with it, or after enough looks, without. */
  const raiseQuestion = async (run: LiveRun): Promise<void> => {
    const asking = run.asking
    if (asking === undefined || asking.raised || options.emitApproval === undefined) return
    asking.lookups += 1
    try {
      asking.pending = await run.cascade.pendingQuestion(run.conversationId, asking.question.askedAtStep)
    } catch {
      asking.pending = undefined
    }
    // Answered, or replaced, while the server was being asked.
    if (run.asking !== asking || run.ended) return
    if (asking.pending === undefined && asking.lookups < questionLookups) return
    asking.raised = true
    options.emitApproval(questionCard(run, asking))
  }

  const persistAndEmit = async (run: LiveRun, events: readonly NormalizedRuntimeEvent[]): Promise<void> => {
    if (events.length === 0) return
    // Persist-before-emit, as every transport here does: a receipt the person
    // has seen is already on disk.
    //
    // Wrapped so the poll loop can tell a durability failure from the ordinary
    // transient read failure it also catches. Matching on a message would be
    // guessing; this is the only write here, so it can say so itself.
    try {
      await options.ledger.appendEvents(run.missionId, events as never)
    } catch (error) {
      throw new LedgerWriteFailed(error)
    }
    run.transcript.track(events)
    run.persisted.push(...events)
    for (const event of events) {
      if (event.sequence > run.lastSequence) run.lastSequence = event.sequence
      options.emitEvent(run.runId, run.missionId, event)
    }
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
    outputLimitExceeded: false, oversizedRecordsDropped: 0,
    startedAt: run.startedAt,
    finishedAt: now().toISOString()
  })

  /**
   * What the run changed on disk, read after it (0.596; codex-mission.ts does
   * the same for the process transports). Until now this service never looked,
   * and every Antigravity edit row read "did not report the change" -- the
   * transcript names the file, never the change. A path the agent named gets
   * its patch on its own row; one it never named gets a row of its own. From a
   * folder another Antigravity run shared, a notice instead: the reading cannot
   * tell one run's writes from the other's.
   */
  const observeAfter = async (run: LiveRun): Promise<void> => {
    if (run.diskBefore === undefined) return
    try {
      const diskAfter = await (options.observeDisk ?? snapshotWorkspace)(options.workspacePath)
      if (diskAfter === undefined) return
      const changed = changedPaths(run.diskBefore, diskAfter)
      if (changed.length === 0) return
      const at = now().toISOString()
      if (run.sharedTree) {
        await persistAndEmit(run, [sharedTreeNotice({ runId: run.runId, missionId: run.missionId, sourceAdapter: 'antigravity', nextSequence: run.lastSequence + 1, at, paths: changed })])
        return
      }
      const unreported = new Set(unreportedPaths(changed, run.persisted))
      const patches = await (options.observePatches ?? observedPatches)(options.workspacePath, diskAfter, changed, {}, run.diskBefore)
      // Every changed path (0.597): a named one whose text could not be read still gets the word that it changed.
      const worth = changed
      await persistAndEmit(
        run,
        observedEditEvents({
          runId: run.runId,
          missionId: run.missionId,
          sourceAdapter: 'antigravity',
          nextSequence: run.lastSequence + 1,
          paths: worth,
          at,
          patches,
          reported: new Set(changed.filter((path) => !unreported.has(path)))
        })
      )
    } catch {
      // The receipt stands on Antigravity's own events.
    }
  }

  const end = async (run: LiveRun, input: { cancelled?: boolean; stderr?: string }): Promise<void> => {
    if (run.ended) return
    run.ended = true
    if (run.timer !== undefined) clearInterval(run.timer)
    runs.delete(run.runId)
    // No card outlives its run.
    settleQuestion(run)
    try {
      await persistAndEmit(run, run.normalizer.finish(completion(run, input)))
    } catch {
      // The ledger refused the receipt; the run is still over. The renderer
      // learns from the absence of further events, and recovery on next
      // launch reports the mission as interrupted, which is the truth.
    }
    await observeAfter(run)
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

  /*
   * THE HOLES ANTIGRAVITY'S TRANSCRIPT LEAVES, FILLED BEFORE ANYTHING IS
   * RECORDED (0.389; withRestoredGaps in the adapter says why and how). Asked
   * of Antigravity's own server only when a message has a gap -- from the
   * gapped step on, since the transcript's step numbers are the server's
   * offsets (the question route relies on the same) -- and a server that does
   * not answer leaves the gap, drawn as before.
   */
  const restoreGaps = async (run: LiveRun, events: readonly NormalizedRuntimeEvent[]): Promise<readonly NormalizedRuntimeEvent[]> => {
    const gapped = events.filter(hasAntigravityGap)
    if (gapped.length === 0) return events
    const steps = gapped.map((event) => (event.type === 'message.delta' ? antigravityMessageStep(event.payload.itemId) : undefined))
    const from = steps.every((step): step is number => step !== undefined) ? Math.min(...steps) : 0
    try {
      return withRestoredGaps(events, await run.cascade.plannerTexts(run.conversationId, from))
    } catch {
      return events
    }
  }

  const poll = async (run: LiveRun): Promise<void> => {
    if (run.polling || run.ended) return
    run.polling = true
    try {
      // Stat first (0.608): a file that has not moved since the last read has nothing new in it.
      const info = await statTranscript(run.transcriptPath)
      const unmoved = info !== undefined && run.seen !== undefined && info.size === run.seen.size && info.mtimeMs === run.seen.mtimeMs
      const text = unmoved ? undefined : await readTranscript(run.transcriptPath)
      if (!unmoved) run.seen = info
      const lines = text === undefined ? [] : text.split('\n').filter((line) => line.trim().length > 0)
      let fresh: readonly NormalizedRuntimeEvent[] = []
      const read: NormalizedRuntimeEvent[] = []
      for (let index = run.fed; index < lines.length; index += 1) {
        read.push(...run.normalizer.accept({ sequence: index + 1, raw: lines[index]! }))
      }
      fresh = await restoreGaps(run, read)
      /*
       * The cursor advances only once the events are DURABLE.
       *
       * It used to advance first, so a ledger write that failed took those
       * events with it: never persisted, never emitted, and never retried,
       * because the next tick started after them. The transcript is re-read
       * from `run.fed` every tick, so leaving it where it was is what makes a
       * transient failure genuinely retryable.
       */
      if (fresh.length > 0) {
        await persistAndEmit(run, fresh)
        await run.deliverMessages(fresh)
        noteQuestions(run, fresh)
      }
      if (lines.length > run.fed) {
        run.fed = lines.length
        run.lastProgressAt = Date.now()
        // It spoke, so the next silence is a new one worth naming.
        run.saidItMightBeAsking = false
      }
      /*
       * NOT WHILE ITS BACKGROUND WORK IS OUT (0.487). An answer with no tool
       * calls ended the turn -- and Antigravity's agent, having said "Waiting
       * for task completion", was woken by its own task's notice and went on:
       * one of Colin's runs worked 18 more minutes, 88 tool calls and 5 file
       * edits, all of it undrawn under a turn that said "no files changed".
       * The idle limit below still ends a run whose task never reports.
       */
      if (run.normalizer.latestFinal && run.normalizer.pendingBackground === 0) {
        await end(run, {})
        return
      }
      await raiseQuestion(run)
      /*
       * A question waiting on the person is not a silence. The agent is held
       * until they answer, which may take longer than any idle limit, and the
       * card already says what "might be asking" would guess at.
       */
      const waitingOnPerson = run.asking !== undefined && !run.asking.answered
      /*
       * SAY IT EARLY, and do not end the run to say it.
       *
       * Colin, 2026-09-21, on a run that sat for forty minutes: *"this
       * antigrav question was not appearing in locust ui, didnt know it was
       * hung up."* Antigravity had stopped on its own "Allow reading this
       * URL?" prompt, in its own window, and Locust showed a working run
       * with nothing to read. The sentence that explains it already existed
       * -- but only in the ten-minute timeout, which ENDS the mission, and
       * his app was restarted for an update before it fired. So the one
       * thing he needed to know was ten minutes away and then never came.
       *
       * A silence with a tool still open is worth saying at ninety seconds,
       * as a note in the thread rather than an ending. Said ONCE: it is a
       * standing condition, not news each tick. If it clears, progress
       * resets the flag with `lastProgressAt`.
       */
      const silentFor = Date.now() - run.lastProgressAt
      const pendingNow = run.normalizer.pendingToolName
      if (!waitingOnPerson && silentFor > askingNoticeMs && silentFor <= idleTimeoutMs && pendingNow !== undefined && !run.saidItMightBeAsking) {
        run.saidItMightBeAsking = true
        options.notify?.({
          runId: run.runId,
          missionId: run.missionId,
          message: `Antigravity has been on its own "${pendingNow}" step for ${String(Math.round(silentFor / 60_000) || 1)} minute${Math.round(silentFor / 60_000) === 1 ? '' : 's'} without reporting anything. It asks questions in its own window, not here -- if it is waiting on you, answer it there.`
        })
      }
      if (!waitingOnPerson && Date.now() - run.lastProgressAt > idleTimeoutMs) {
        // Say WHY, and do not blame the model for a silence this app caused.
        //
        // Antigravity's native `ask_question` holds the run open waiting for an
        // answer through a channel Locust does not collect, so the run sat
        // until this timeout and was then reported as the agent having written
        // nothing -- which is true and completely misleading. The tool is still
        // open in the normalizer, so the timeout can name it.
        //
        // The real fix is to route a native question into the approval path so
        // it can be answered; see docs/FINDING-antigravity-ask-question.md.
        // This is the half that stops the app misattributing the hang.
        const minutes = String(Math.round(idleTimeoutMs / 60_000))
        const pending = run.normalizer.pendingToolName
        await end(run, {
          stderr: pending === undefined
            ? `Antigravity's agent wrote nothing to its transcript for ${minutes} minutes.`
            : `Antigravity's agent has been waiting ${minutes} minutes on its own "${pending}" step. If it is asking you something, Locust cannot see the question or answer it yet — answer it in Antigravity's own window.`
        })
      }
    } catch (error) {
      /*
       * A transient READ failure is retried on the next tick, which is what
       * this catch was written for. A LEDGER failure is not that: it means the
       * receipt for work already done cannot be written, and continuing to
       * poll would keep the run alive with nobody recording it -- the same
       * defect fixed on the app-server path in 0.51.0.
       *
       * The two are told apart by asking the ledger, not by matching on a
       * message: `persistAndEmit` is the only thing here that writes, so a
       * failure it reports is a durability failure by construction.
       */
      if (error instanceof LedgerWriteFailed) {
        await endOnReceiptFailure(run)
        return
      }
      // A transient read failure is retried on the next tick.
    } finally {
      run.polling = false
    }
  }

  return {
    has: (runId) => runs.has(runId),
    hasMission: (missionId) => [...runs.values()].some((run) => run.missionId === missionId),
    liveMissionIds: () => [...runs.values()].map((run) => run.missionId),
    runIdOwnedBy: (teammateId) =>
      [...runs.values()].find((run) => run.peer?.self.teammateId === teammateId)?.runId,

    async start(prompt, peer, route) {
      if (disposed) throw new AntigravityStartError('The mission service is shutting down.')
      if (options.freeRoutesOnly === true) throw new AntigravityStartError(FREE_ONLY_REFUSAL)
      // As on the other five: a limit that cannot be checked lets the run start.
      const overLimit = peer === undefined ? undefined : await options.spendRefusal?.(peer.self.teammateId).catch(() => undefined)
      if (overLimit !== undefined) throw new AntigravityStartError(overLimit, 'limit')
      const owner = ownerKeyOf(peer)
      if (starting.has(owner) || [...runs.values()].some((run) => ownerKeyOf(run.peer) === owner)) {
        throw new AntigravityStartError(
          peer === undefined ? 'A mission is already running.' : `${peer.self.name} already has a mission running. Wait for it to finish or stop it first.`,
          'teammate'
        )
      }
      if (starting.size + runs.size + (options.liveElsewhere ?? (() => 0))() >= MAX_LIVE_ANTIGRAVITY_MISSIONS) {
        throw new AntigravityStartError(`Up to ${String(MAX_LIVE_ANTIGRAVITY_MISSIONS)} Antigravity missions can run at once.`, 'pool')
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
          const prepared = await peerExchange.prepare(prompt, peer, 'antigravity', {
            ...(route.followUpOf === undefined ? {} : { previousMissionId: route.followUpOf }),
            // A2.12, as the other five runtimes have it: a relayed run is
            // shown the messages it was started to answer first, and its
            // memory is chosen by them rather than by the relay's own rules.
            ...(route.relay?.answering === undefined ? {} : { startedFor: route.relay.answering })
          })
          runtimePrompt = prepared.runtimePrompt
          delivered = prepared.delivered
          peerDeliveryFailed = prepared.failed
        }

        // The conversation is opened BEFORE the record so a refusal from
        // Antigravity leaves nothing behind; a follow-up must know how far the
        // transcript already reaches before it sends, or it would replay the
        // earlier turns as this one's.
        // Look at the folder BEFORE the agent is told to begin: the message below
        // starts it, and what differs when the run ends is read against this.
        const diskBefore = await (options.observeDisk ?? snapshotWorkspace)(options.workspacePath).catch(() => undefined)
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

        // L3 (the code review): Antigravity has the conversation by now, so a
        // record that fails here leaves its agent working with nothing in
        // Locust to show it -- and a plain "could not start" invited a retry
        // that started it twice. Said as what it is.
        try {
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
            // Who started it, as every other runtime's record says (code
            // review B4, own runs 3). The relay handed its origin in and this
            // record dropped it, so a reply the host began read, after a
            // restart, as a conversation the person began -- its prompt the
            // host's briefing, shown as their words.
            ...(route.relay === undefined ? {} : { startedBy: { kind: 'relay' as const, hop: route.relay.hop } }),
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
        } catch {
          throw new AntigravityStartError(
            'Antigravity has already started on this, but Locust could not record the mission, so it will not appear here. Open Antigravity to follow it, and do not send it again.'
          )
        }
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
          deliverMessages: deliverWhenRuntimeStarts(peerExchange, missionId, delivered),
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
          saidItMightBeAsking: false,
          cascade: (options.cascadeApi ?? createCascadeApi)(host),
          asking: undefined,
          polling: false,
          ended: false,
          seen: undefined,
          diskBefore,
          persisted: [],
          lastSequence: 0,
          // Every Antigravity run works in the one folder Antigravity has open, so
          // two live at once share it, and neither reading can be told from the other's.
          sharedTree: runs.size > 0
        }
        for (const other of runs.values()) other.sharedTree = true
        runs.set(runId, run)
        run.timer = setInterval(() => {
          void poll(run)
        }, pollMs)
        void poll(run)

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

    async decide(answer) {
      const run = [...runs.values()].find((entry) => entry.asking?.approvalId === answer.approvalId)
      const asking = run?.asking
      if (run === undefined || asking === undefined || !asking.raised || asking.answered) return false
      // A question is answered, never approved; and without the waiting step
      // there is nothing to answer here (the card said to use Antigravity).
      if (!('answers' in answer) || asking.pending === undefined) return false
      const pending = asking.pending
      const responses: AntigravityQuestionResponse[] = pending.questions.map((question, index) => {
        const given = answer.answers[String(index)] ?? []
        if (given.length === 0) return { selectedOptionIds: [], skipped: true }
        const selectedOptionIds = question.options.filter((option) => given.includes(option.text)).map((option) => option.id)
        const written = given.filter((entry) => !question.options.some((option) => option.text === entry)).join('\n').trim()
        return { selectedOptionIds, ...(written.length > 0 ? { writeIn: written } : {}) }
      })
      try {
        await run.cascade.answerQuestion(run.conversationId, pending, responses)
      } catch (error) {
        const why = error instanceof Error ? error.message : String(error)
        options.notify?.({
          runId: run.runId,
          missionId: run.missionId,
          message: `Locust could not hand your answer to Antigravity (${why}). Answer it in Antigravity's own window; this run carries on from there.`
        })
        return false
      }
      asking.answered = true
      // The agent picks up from here; its silence starts now, not at the question.
      run.lastProgressAt = Date.now()
      return true
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
