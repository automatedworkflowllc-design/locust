import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import { stepWordsOf } from '../shared/hand-off.js'
import { taggedWordsOf } from '../shared/tagging.js'
import type { CheckpointMessage, CheckpointResult } from './worktrees.js'

/**
 * A COMMIT PER TURN ON THE TEAMMATE'S OWN BRANCH (0.439).
 *
 * Colin picked idea #2 of PRODUCT-SUGGESTIONS-2026-09-28: when a turn ends for
 * a teammate with Own branch on -- completed, failed or stopped -- the host
 * commits what changed in its tree to `locust/<name>`, so the branch's log
 * reads like the thread and the work never sits uncommitted (where the code
 * review's C1 came from). These are Locust's checkpoints, not the person's
 * commits (worktrees.ts `checkpoint`). Nothing is pushed.
 *
 * The receipt is a host diagnostic in the mission's own stream, like the
 * shared-folder notice: recorded before it is shown, with the branch, the
 * commit and the files, and no new kind of ledger record.
 */
export const CHECKPOINT_CODE = 'host.turn_checkpoint'
const SUBJECT_MAX = 72
const SUMMARY_MAX = 200

export type TurnOutcome = 'completed' | 'failed' | 'stopped'

/**
 * How a turn ended, from EVERY event it wrote, newest terminal one first
 * (0.531). It read only the batch the process's end returned, and a Codex turn
 * reports its completion while it streams -- so every Codex turn on Own branch
 * was committed as "failed" (drive-review-changes, LOCUST_RUNTIME=codex).
 */
export function turnOutcomeOf(events: readonly { readonly type: string }[]): TurnOutcome {
  for (let at = events.length - 1; at >= 0; at -= 1) {
    const type = events[at]?.type
    if (type === 'run.completed') return 'completed'
    if (type === 'run.cancelled') return 'stopped'
    if (type === 'run.failed') return 'failed'
  }
  return 'failed'
}

/**
 * The first line, as a commit subject: its first sentence when that fits,
 * else cut at a word. The first landing drive's message read "Change nothing
 * el…" -- a subject cut mid-word is the first thing the person reads in their
 * own history.
 */
const firstLine = (text: string, max: number): string => {
  const line = text.split(/\r?\n/).map((part) => part.trim()).find((part) => part.length > 0) ?? ''
  const sentence = /^.+?[.!?](?=\s|$)/.exec(line)?.[0]
  if (sentence !== undefined && sentence.length <= max) return sentence
  if (line.length <= max) return line
  const cut = line.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/** "opencode / nemotron-3-ultra-free", never "opencode / opencode/nemotron-3-ultra-free". */
export function routeLabel(runtime: string, model: string | undefined): string {
  if (model === undefined) return runtime
  return `${runtime} / ${model.startsWith(`${runtime}/`) ? model.slice(runtime.length + 1) : model}`
}

/** The person's ask as the subject, the teammate's first line as the body, and trailers naming the turn. */
export function checkpointMessage(input: {
  readonly prompt: string
  readonly answer: string | undefined
  readonly teammate: { readonly teammateId: string; readonly name: string }
  readonly missionId: string
  readonly runtime: string
  readonly model: string | undefined
  readonly outcome: TurnOutcome
}): CheckpointMessage {
  // A routine step or a tag carries host text around the person's words.
  const asked = firstLine(taggedWordsOf(stepWordsOf(input.prompt)), SUBJECT_MAX)
  return {
    subject: asked.length > 0 ? asked : `${input.teammate.name}'s turn`,
    ...(input.answer === undefined || input.answer.trim().length === 0 ? {} : { body: firstLine(input.answer, SUMMARY_MAX) }),
    trailers: [
      ['Locust-Teammate', input.teammate.name],
      ['Locust-Mission', input.missionId],
      ['Locust-Route', routeLabel(input.runtime, input.model)],
      ['Locust-Turn', input.outcome]
    ],
    author: { name: input.teammate.name, email: `${input.teammate.teammateId}@teammates.locust` }
  }
}

const fileList = (files: readonly string[]): string =>
  files.length <= 4 ? files.join(', ') : `${files.slice(0, 3).join(', ')} and ${String(files.length - 3)} more`

const megabytes = (bytes: number): string => `${String(Math.round(bytes / (1024 * 1024)))} MB`

/** What the thread says about the checkpoint, or nothing when the turn changed nothing. */
export function checkpointSentence(result: CheckpointResult | { readonly kind: 'failed'; readonly message: string }): string | undefined {
  if (result.kind === 'clean') return undefined
  if (result.kind === 'failed') return `This turn's changes could not be saved on the teammate's branch: ${result.message} They are still in its folder.`
  const left = result.skipped.length === 0
    ? ''
    : ` Left out, too big to commit: ${result.skipped.map((file) => `${file.path} (${megabytes(file.bytes)})`).join(', ')}.`
  if (result.kind === 'skipped') return `Nothing from this turn was saved on the branch.${left}`
  // Its files are what came in with the merge, not this turn's own work (0.440).
  /*
   * Not "it can land now" while markers remain (0.680). The 0.678 sweep: Wren,
   * asked to resolve cart.py, asked which side to keep instead -- a fair
   * question -- and the thread said the merge was finished and could land,
   * under a card saying conflict markers were still in cart.py.
   */
  if (result.mergeFinished === true && result.stillMarked !== undefined && result.stillMarked.length > 0) {
    const many = result.stillMarked.length > 1
    return `Saved this turn on ${result.branch} as ${result.sha.slice(0, 12)}, but ${fileList(result.stillMarked)} still ${many ? 'have' : 'has'} conflict markers, so it cannot land until ${many ? 'they are' : 'it is'} resolved.${left}`
  }
  if (result.mergeFinished === true && result.markersUnchecked === true) {
    return `Saved this turn on ${result.branch} as ${result.sha.slice(0, 12)}. Locust could not check it for conflict markers, so it does not say it can land; Land checks again first.${left}`
  }
  if (result.mergeFinished === true) return `Saved this turn on ${result.branch} as ${result.sha.slice(0, 12)}: the merge is finished, so it can land now.${left}`
  const count = result.files.length
  return `Saved this turn on ${result.branch} as ${result.sha.slice(0, 12)}: ${String(count)} ${count === 1 ? 'file' : 'files'} (${fileList(result.files)}).${left}`
}

export function checkpointNotice(input: {
  readonly runId: string
  readonly missionId: string
  readonly sourceAdapter: NormalizedRuntimeEvent['sourceAdapter']
  readonly nextSequence: number
  readonly at: string
  readonly sentence: string
  readonly failed: boolean
}): NormalizedRuntimeEvent {
  return {
    runId: input.runId,
    missionId: input.missionId,
    occurredAt: input.at,
    sourceAdapter: input.sourceAdapter,
    id: `${input.runId}:checkpoint:${String(input.nextSequence)}`,
    sequence: input.nextSequence,
    type: 'adapter.diagnostic',
    payload: {
      level: input.failed ? 'warning' : 'info',
      code: CHECKPOINT_CODE,
      message: input.sentence,
      terminal: false,
      evidence: { redacted: true as const }
    }
  } as NormalizedRuntimeEvent
}
