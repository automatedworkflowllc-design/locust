import type { NormalizedRuntimeEvent, ToolPatch } from '@teammate/runtime-adapters'

import { SUBAGENT_TOOL } from './faceState.js'
import { LARGE_FILE_LINES, fileCounts, parseUnifiedDiff } from './diff.js'
import type { DiffCounts, DiffFile } from './diff.js'

import type { MissionRuntimeId } from '@teammate/runtime-adapters'

import type { PublicPeerMessage, PublicRecoveredMission } from '../../shared/ipc.js'
import { splitAttachments } from '../../shared/attachments.js'
import { stripShareBlocks } from '../../shared/peer-share.js'
import { stripTaskBlocks } from '../../shared/room-task.js'
import { stripMemoryBlocks } from '../../shared/memory.js'
import { parseDecision, stripDecisionBlocks } from '../../shared/decision.js'
import type { DecisionRequest } from '../../shared/decision.js'

/**
 * Turns the normalized event stream into the thread the workroom renders.
 *
 * This is the layer where "logs never dump into the thread" is actually
 * enforced: raw events go to the Signal Rail, and the thread shows semantic
 * items derived here. Everything is a pure function of the events, so the UI
 * cannot show a step, a count, or a piece of text the provider did not send.
 */

export interface ActivityDetail {
  readonly kind: string
  readonly name: string
  /**
   * What the runtime called the tool. `name` is often the target -- a path,
   * a command -- so without this a read of a file it also edited renders as
   * the same path twice with nothing to tell them apart.
   */
  readonly tool?: string
  /** What the model said it was doing, on the runtimes that carry one. */
  readonly title?: string
  readonly settled: boolean
  /** True only for a tool the runtime itself reported as failed. */
  readonly failed?: boolean
  readonly exitCode?: number
  /** The change the tool made, when the runtime reported one. */
  readonly patch?: ToolPatch
  /** The runtime's own status word for the call; a subagent's type, for its launcher. */
  readonly status?: string
  /** What the tool returned, when the runtime reported it in words; a subagent's summary. */
  readonly output?: string
}

/**
 * An activity row, ready to draw. Files carry their parsed diff; shell rows
 * carry their result; an edit whose runtime reported no patch stays in the
 * list as an `unreported` row rather than vanishing, because a missing row
 * would understate what the teammate did.
 */
/** How many of a folded run's names the row shows before it starts counting. */
export const FOLDED_TOOL_NAMES_SHOWN = 3

/**
 * Fold runs of consecutive plain tool rows into one.
 *
 * The rule is narrow on purpose: a row folds only if it is a plain `tool`,
 * SETTLED and not failed. A command, a file change, an unreported change, a
 * helper, anything still running and anything that failed keeps its own row.
 * So the fold can never hide work that changed something or went wrong -- it
 * only ever quietens rows that were already quiet.
 *
 * A single row is left alone: folding one thing into "1 tool call" would be
 * the same row with the name taken off it.
 */
export function foldPlainToolRuns(entries: readonly ActivityEntry[]): readonly ActivityEntry[] {
  const foldable = (entry: ActivityEntry): boolean =>
    entry.kind === 'tool' && entry.settled && !entry.failed
  const out: ActivityEntry[] = []
  let index = 0
  while (index < entries.length) {
    const entry = entries[index]
    if (entry === undefined) break
    if (!foldable(entry)) {
      out.push(entry)
      index += 1
      continue
    }
    let end = index + 1
    while (end < entries.length && foldable(entries[end]!)) end += 1
    const run = entries.slice(index, end)
    if (run.length < 2) {
      out.push(entry)
    } else {
      const names = run.map((row) => (row.kind === 'tool' ? row.name : '')).filter((name) => name.length > 0)
      const verbs = new Set(run.map((row) => (row.kind === 'tool' ? row.tool : undefined)))
      const verb = verbs.size === 1 ? [...verbs][0] : undefined
      out.push({
        kind: 'tools',
        key: `tools_${entry.key}`,
        names,
        ...(verb === undefined ? { verb: undefined } : { verb })
      })
    }
    index = end
  }
  return out
}

/**
 * The names a folded row shows, and what it says about the rest.
 *
 * grok-build's rule, which this repo did not have written down anywhere:
 * never truncate silently. An over-long list ends by saying how much of it is
 * not being shown, so a reader can tell a short list from a cut one.
 */
export function foldedToolsText(names: readonly string[], verb: string | undefined): string {
  const shown = names.slice(0, FOLDED_TOOL_NAMES_SHOWN).join(', ')
  const rest = names.length - FOLDED_TOOL_NAMES_SHOWN
  const tail = rest > 0 ? `${shown} … ${String(rest)} more` : shown
  const lead = verb === undefined ? `${String(names.length)} tool calls` : `${verb} ${String(names.length)}`
  return `${lead} — ${tail}`
}

export type ActivityEntry =
  | {
      readonly kind: 'file'
      readonly key: string
      readonly file: DiffFile
      readonly counts: DiffCounts
      readonly truncated: boolean
      /** The runtime's own total, when the recorded text was cut short. */
      readonly reported: DiffCounts | undefined
      readonly large: boolean
    }
  | {
      readonly kind: 'shell'
      readonly key: string
      readonly command: string
      /**
       * What the model said it was doing, where the runtime carries it.
       *
       * Claude Code's Bash tool takes a `description` on every call and the
       * model fills it in; it is the whole reason its own transcript reads
       * "Checked what the app says about the free route" rather than a shell
       * pipeline. Locust dropped it and drew the pipeline.
       *
       * The row leads with this and keeps the command underneath, because
       * the command is evidence of what ran on this machine and the
       * description is only a claim about it. Undefined on the runtimes that
       * send none -- Codex has no such field at all -- and those rows read
       * exactly as they did.
       */
      readonly title: string | undefined
      readonly settled: boolean
      readonly failed: boolean
      readonly exitCode: number | undefined
      /**
       * What the command printed, where the runtime reported it.
       *
       * Undefined is the ordinary case, not a failure: only the Codex exec
       * stream carries `aggregated_output` today. A row with nothing to show
       * simply does not offer to show anything -- which is why this is a
       * capability the row reads off the data rather than a promise made in
       * advance and then broken per runtime.
       *
       * Already redacted when it gets here: the adapter runs it through
       * `sanitizeJson`, pinned by a test that puts a bearer token in a command's
       * output and asserts it never reaches the event.
       */
      readonly output?: string
    }
  | {
      /**
       * A helper the runtime started for itself: Claude Code's Task tool,
       * OpenCode's task tool. Until now one plain tool row; what the helper
       * did inside is not reported by the runtime, so the row says what it
       * was asked and whether it reported back (Colin, 2026-09-05).
       */
      readonly kind: 'helper'
      /** The subagent's type when the runtime said (Claude Code's Explore, general-purpose, ...). */
      readonly subagentType?: string
      /** Its one-line summary when it reported back. */
      readonly summary?: string
      readonly key: string
      readonly description: string
      readonly settled: boolean
      readonly failed: boolean
    }
  | {
      /**
       * A run of consecutive plain tool calls, folded into one row.
       *
       * grok-build's `group_tool_verbs`, read 2026-09-13: runs of read /
       * search / list fold into one line while edits keep their own, and
       * `collapsed_edit_blocks` keeps `+N/-M` visible even collapsed. A turn
       * that reads eleven files drew eleven rows of equal weight here, and
       * the one edit among them looked exactly like the ten reads.
       *
       * Only rows that changed NOTHING fold. A command, a file change, an
       * unreported change, a helper and anything that FAILED all keep their
       * own row, always -- the fold may only ever quieten what was already
       * quiet.
       */
      readonly kind: 'tools'
      readonly key: string
      /** Every name in the run, in order. The row shows some and counts the rest. */
      readonly names: readonly string[]
      /** The shared verb when they all share one, so the row can lead with it. */
      readonly verb: string | undefined
    }
  | {
      readonly kind: 'unreported' | 'tool'
      readonly key: string
      readonly name: string
      /** The runtime's own word for what it did: `read`, `search`, `list`. */
      readonly tool: string | undefined
      readonly settled: boolean
      readonly failed: boolean
    }

/**
 * Expand each activity detail into the rows the card draws. One patch can
 * touch several files, and each becomes its own row -- the same rows the
 * counts are summed from, so the card's total and the diffs beneath it are
 * two views of one array and cannot disagree.
 */
export function activityEntries(
  details: readonly ActivityDetail[],
  /** The folder this ran in, so one file reported two ways is one row. */
  workspacePath?: string
): readonly ActivityEntry[] {
  const entries: ActivityEntry[] = []
  // An edit some runtimes report twice is still one edit.
  //
  // MEASURED 2026-09-07, OpenCode, one append to one file: the fold drew
  // `notes.md MODIFIED +1 -0` TWICE, the line above said `1 file +2 -0`, and
  // git said `1 0 notes.md` -- one line, in one file, appearing once in the
  // file on disk. A first outside tester reported the same shape as
  // `2 files / +2 -0` against a one-line change.
  //
  // The key is the file's PATH AS DRAWN plus every hunk and row, so this only
  // ever folds a restatement of one change. The path has to go through
  // `relativePath` first for the same reason the count does: measured across
  // six runs of the same one-line append, OpenCode reported the edit twice on
  // two of them, once relatively and once absolutely, and a raw-path key saw
  // two files where the fold drew the same row twice.
  //
  // Two real edits to one file cannot collide: the second is diffed against a
  // file the first already changed, so its rows differ -- and when they do,
  // both are drawn and both are counted, which is correct.
  const seenFiles = new Set<string>()
  details.forEach((detail, index) => {
    const failed = detail.failed === true
    if (detail.kind === 'shell') {
      entries.push({
        kind: 'shell',
        key: `shell_${String(index)}`,
        command: shellCommandText(detail.name),
        title: detail.title,
        settled: detail.settled,
        failed,
        exitCode: detail.exitCode,
        /*
         * Carried whenever the runtime SAID something about output, including
         * when what it said was "none".
         *
         * It was captured by the adapter and dropped here, so a teammate could
         * run `seq 1 1200`, say "printed 1 through 1200", and leave the person
         * looking at a row that said `done` and nothing else (drive-huge-turn,
         * 2026-09-08).
         *
         * The empty string used to be dropped along with the absent case, and
         * that collapsed two different facts into one: `undefined` is a
         * runtime that reports no output at all -- five of the six -- and `''`
         * is one that ran the command and it printed nothing. The row draws
         * "no output" for the second and must stay silent for the first, so
         * they cannot arrive here as the same value. Caught by rendering the
         * card: the case was written, and unreachable.
         */
        ...(typeof detail.output === 'string' ? { output: detail.output } : {})
      })
      return
    }
    const patch = detail.patch
    const files = patch === undefined ? [] : parseUnifiedDiff(patch.text)
    if (files.length === 0) {
      // An edit whose runtime named its files but sent no diff (Codex's
      // file_change) is one row PER FILE, each saying the change was not
      // reported -- never one row named after the tool with no path at all.
      // MEASURED 2026-09-03 in a real run, correcting a first attempt: for a
      // Codex `file_change` the detail's NAME is the joined paths (they
      // arrive as the tool's command) while its TOOL is the literal string
      // `file_change`. Requiring name and tool to be equal -- which they
      // never are -- meant the card kept drawing ONE row with both paths run
      // together, labelled `file_change`, saying the change was not reported.
      // Any edit naming more than one path splits, whatever the tool is called.
      const named = detail.kind === 'edit' && detail.name.includes('\n')
        ? detail.name.split('\n').map((path) => path.trim()).filter((path) => path.length > 0)
        : undefined
      if (named !== undefined && named.length > 0) {
        named.forEach((path, fileIndex) => {
          entries.push({
            kind: 'unreported',
            key: `item_${String(index)}_${String(fileIndex)}`,
            name: path,
            tool: undefined,
            settled: detail.settled,
            failed
          })
        })
        return
      }
      if (detail.kind === 'helper') {
        entries.push({
          kind: 'helper',
          key: `helper_${String(entries.length)}`,
          // The target is what the helper was asked; without one, say so.
          description: detail.tool !== undefined && detail.tool !== detail.name ? detail.name : subagentVerb(detail.tool),
          // Claude Code's launcher carries the subagent's type in status;
          // Codex's carries the call's lifecycle word, which is not a type.
          ...(detail.status === undefined || /^(error|completed|failed|in_progress|started|cancelled)$/i.test(detail.status) ? {} : { subagentType: detail.status }),
          ...(detail.output === undefined ? {} : { summary: detail.output }),
          settled: detail.settled,
          failed: detail.failed === true
        })
        return
      }
      entries.push({
        kind: detail.kind === 'edit' ? 'unreported' : 'tool',
        key: `item_${String(index)}`,
        name: detail.name,
        tool: detail.tool === detail.name ? undefined : detail.tool,
        settled: detail.settled,
        failed
      })
      return
    }
    files.forEach((file, fileIndex) => {
      const signature = JSON.stringify({
        ...file,
        path: relativePath(file.path, workspacePath).replace(/[\\/]+/g, '/').toLowerCase()
      })
      if (seenFiles.has(signature)) return
      seenFiles.add(signature)
      const counts = fileCounts(file)
      entries.push({
        kind: 'file',
        key: `file_${String(index)}_${String(fileIndex)}`,
        file,
        counts,
        truncated: patch?.truncated === true,
        // A single-file patch can be checked against the runtime's own total;
        // across several files the total belongs to none of them, so it is
        // withheld rather than repeated on each row as if it were theirs.
        reported:
          patch !== undefined && patch.truncated && files.length === 1
            ? { added: patch.added, removed: patch.removed }
            : undefined,
        large: counts.added + counts.removed > LARGE_FILE_LINES
      })
    })
  })
  return foldPlainToolRuns(entries)
}

/**
 * The card's `+N -M`. Summed from the rendered rows, never from a runtime's
 * header: if a patch was cut short, the header would promise lines the diff
 * below cannot show.
 */
export function activityCounts(details: readonly ActivityDetail[], workspacePath?: string): DiffCounts {
  let added = 0
  let removed = 0
  for (const entry of activityEntries(details, workspacePath)) {
    if (entry.kind !== 'file') continue
    added += entry.counts.added
    removed += entry.counts.removed
  }
  return { added, removed }
}

/**
 * Which file opens by default: the first one, unless it is large enough that
 * opening it would bury everything after it.
 */
export function defaultOpenEntry(entries: readonly ActivityEntry[]): string | undefined {
  const first = entries.find((entry) => entry.kind === 'file')
  if (first === undefined || first.kind !== 'file') return undefined
  return first.large ? undefined : first.key
}

/** `14:44`, in the host's own timezone. */
/**
 * A usage window as the runtime worded it, with its ISO reset instants
 * turned into local clock times: "5-hour window 67% used · resets 10:10 PM".
 * The ledger keeps the instant; a person reads a time.
 */
export function usageWindowLabel(said: string): string {
  return said.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, (iso) => {
    const at = new Date(iso)
    if (Number.isNaN(at.getTime())) return iso
    const sameDay = at.toDateString() === new Date().toDateString()
    return sameDay ? clockTime(iso) : `${at.toLocaleDateString(undefined, { weekday: 'short' })} ${clockTime(iso)}`
  })
}

/** The fullest window's percentage in a usage-window reading, or undefined. */
export function usagePercent(said: string): number | undefined {
  const found = [...said.matchAll(/(\d{1,3})% used/g)].map((match) => Number(match[1]))
  return found.length === 0 ? undefined : Math.max(...found)
}

/**
 * The reading in the spec's words: "67% of the 5-hour window used, resets
 * 10:10 PM · 53% of the 7-day window, resets Sun 3:00 AM" (SURFACES-0.22 §3).
 */
export function usageWindowSentence(said: string): string {
  const parts = [...usageWindowLabel(said).matchAll(/([^·]+?) window (\d{1,3})% used(?: · resets ([^·]+?))?(?= · |$)/g)]
  if (parts.length === 0) return usageWindowLabel(said)
  return parts
    .map((match, index) => `${match[2]}% of the ${match[1].trim()} window${index === 0 ? ' used' : ''}${match[3] === undefined ? '' : `, resets ${match[3].trim()}`}`)
    .join(' · ')
}

export function clockTime(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return '--:--'
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

/**
 * When a mission began, said the way a person needs it.
 *
 * The marker read `started 12:25 AM` with no date, which is unambiguous for
 * exactly as long as you keep the app open. Come back the next morning and a
 * mission from last night reads as one from five minutes ago. Today keeps the
 * bare time; anything older carries its date.
 */
export function startedLabel(iso: string, now: Date = new Date()): string | undefined {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return undefined
  const time = at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const sameDay =
    at.getFullYear() === now.getFullYear()
    && at.getMonth() === now.getMonth()
    && at.getDate() === now.getDate()
  if (sameDay) return time
  const day = at.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(at.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' })
  })
  return `${day}, ${time}`
}

/** Whole minutes between two instants, floored, never negative. */
export function minutesBetween(from: string, to: string): number {
  const start = new Date(from).getTime()
  const end = new Date(to).getTime()
  if (Number.isNaN(start) || Number.isNaN(end)) return 0
  return Math.max(0, Math.floor((end - start) / 60_000))
}

/**
 * A quiet gap worth marking. Below this a marker is noise; above it, the
 * reader deserves to know the mission sat still.
 */
export const QUIET_GAP_MINUTES = 2

export interface ThreadMarker {
  /** Index of the turn this marker sits ABOVE. */
  readonly beforeTurn: number
  readonly at: string
  readonly minutesIn: number
  /** Said only when the gap is the point, e.g. `waited 6 min`. */
  readonly note: string | undefined
}

/**
 * Where a long conversation earns a time marker. A turn that follows the one
 * before it within a couple of minutes needs no marker -- it reads as the
 * same stretch of work. A gap longer than that is a fact about the mission
 * (you were away, or it was waiting on you), and stating it beats leaving
 * the reader to subtract two timestamps that are not on screen.
 */
export function threadMarkers(turns: readonly (readonly NormalizedRuntimeEvent[])[]): readonly ThreadMarker[] {
  const origin = turns.flat()[0]?.occurredAt
  if (origin === undefined) return []
  const markers: ThreadMarker[] = []
  for (let index = 1; index < turns.length; index += 1) {
    const previous = turns[index - 1]?.at(-1)?.occurredAt
    const next = turns[index]?.[0]?.occurredAt
    if (previous === undefined || next === undefined) continue
    const gap = minutesBetween(previous, next)
    if (gap < QUIET_GAP_MINUTES) continue
    markers.push({
      beforeTurn: index,
      at: next,
      minutesIn: minutesBetween(origin, next),
      note: `waited ${String(gap)} min`
    })
  }
  return markers
}

export interface PlanStep {
  readonly text: string
  readonly state: 'done' | 'running' | 'pending'
}

export type ThreadItem =
  | { readonly key: string; readonly type: 'agent-message'; readonly text: string; readonly streaming: boolean }
  | {
      readonly key: string
      readonly type: 'activity'
      /**
       * Open this fold without being asked.
       *
       * True for the NEWEST turn once it has finished. While a run is going
       * the live step narrates it -- "Thinking", then each tool as it is
       * called -- and the moment it ended all of that was replaced by one
       * collapsed line, so the work vanished at exactly the moment a person
       * turns back to look at it (Colin, 2026-09-08: "the thoughts and tool
       * calls disappear after an agent is done ... we want that to stay so
       * they can see after the fact or if they missed it").
       *
       * Newest turn only. Every finished fold opening would make a long
       * conversation a wall of tool rows, which is what the fold is for.
       */
      readonly openByDefault?: boolean
      /**
       * Notices about this turn's work, drawn at the FOOT of the fold.
       *
       * These are the diagnostics the thread's own gate drops -- the ones a
       * runtime raises before its first tool call, which used to be counted in
       * the trace line as `1 notice` and shown nowhere. The count is gone; the
       * sentence is here.
       */
      readonly notices?: readonly { readonly level: 'info' | 'warning' | 'error'; readonly message: string; readonly source: MissionRuntimeId }[]
      /** The plan this run stated, drawn as the fold's first rows. */
      readonly plan?: { readonly steps: readonly PlanStep[]; readonly doneCount: number }
      readonly summary: string
      /** The trace line, as segments, so its tones stay addressable (SURFACES-0.22 §1). */
      readonly trace: readonly TraceSegment[]
      /** True once the turn is over: an unsettled subagent then "did not report". */
      readonly finished: boolean
      readonly details: readonly ActivityDetail[]
      /**
       * Which runtime reported this work, so a row with no recorded change
       * can name it. Read off the events, never assumed.
       */
      readonly reportedBy: MissionRuntimeId | undefined
    }
  | {
      readonly key: string
      readonly type: 'live-step'
      /**
       * WHICH REGISTER this line is, always, in one word.
       *
       * Colin, 2026-09-11: thinking, tool calls and connector calls all have
       * to be distinguishable from text the teammate actually wrote. The
       * label alone could not carry that -- it is whatever the runtime said,
       * so "Exploring the repository" and a sentence of the reply were the
       * same shape of words in the same place. This is derived from the
       * step's own kind and never from its wording.
       */
      readonly register: 'starting' | 'working' | 'thinking' | 'writing' | 'tool' | 'connector'
      readonly label: string
      readonly detail: string | undefined
      /** When the step began, so the card can show elapsed time as it runs. */
      readonly startedAt: string
      /**
       * What kind of step: a tool or turn is the teammate DOING something and
       * their face works; reasoning is thought, shown as a still face with
       * staggered dots. Never a bar or a synthetic percentage.
       */
      readonly kind: 'turn' | 'reasoning' | 'item'
      /**
       * True when the teammate is waiting on the model rather than doing
       * something nameable -- the launch before the first event, and the gaps
       * between steps. Draws the dots, which is the only honest thing to show
       * for a wait: there is no step to name and no progress to claim.
       */
      readonly waiting?: boolean
      /**
       * Whether the runtime has reported ANYTHING yet, beyond the app's own
       * record of launching it. Absent on a line that names a real step,
       * because a named step is itself the answer. See `quiet.ts`.
       */
      readonly spoken?: boolean
    }
  | {
      readonly key: string
      readonly type: 'decision'
      /** What the runtime asked, and what it says each choice costs. */
      readonly request: DecisionRequest
    }
  | {
      readonly key: string
      readonly type: 'plan'
      readonly steps: readonly PlanStep[]
      readonly doneCount: number
    }
  | {
      readonly key: string
      readonly type: 'limit'
      readonly kind: 'quota-exhausted' | 'temporary-rate-limit'
      readonly message: string
    }
  | {
      readonly key: string
      readonly type: 'diagnostic'
      readonly level: 'info' | 'warning' | 'error'
      readonly message: string
    }

/**
 * Read a provider plan into steps. The payload is redacted JSON of whatever
 * shape the provider sent, so every field is checked rather than assumed --
 * an unreadable plan yields no card instead of a malformed one.
 */
export function readPlan(value: unknown): readonly PlanStep[] {
  const list = Array.isArray(value)
    ? value
    : typeof value === 'object' && value !== null && Array.isArray((value as { plan?: unknown }).plan)
      ? ((value as { plan: unknown[] }).plan)
      : []
  const steps: PlanStep[] = []
  for (const entry of list) {
    if (typeof entry === 'string') {
      steps.push({ text: entry, state: 'pending' })
      continue
    }
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    // `content` is OpenCode's word for the step (2026-09-13); the others are
    // Codex's and the app-server's. One plan, four spellings.
    const text = record.step ?? record.text ?? record.title ?? record.name ?? record.content
    if (typeof text !== 'string' || text.length === 0) continue
    const status = typeof record.status === 'string' ? record.status.toLowerCase() : ''
    const state: PlanStep['state'] =
      status.includes('complete') || status === 'done'
        ? 'done'
        : status.includes('progress') || status === 'running' || status === 'active'
          ? 'running'
          : 'pending'
    steps.push({ text, state })
  }
  return steps
}

/** Shell verbs that read as file edits rather than as commands. */
const EDIT_COMMANDS = /^(?:apply_patch|patch|edit|write|sed|tee)\b/

function pluralize(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`
}

/**
 * The collapsed activity line. Counts come from tool events only -- never from
 * a guess about what the model said it did.
 */
/**
 * What a person means by "the command that ran".
 *
 * Runtimes reach a shell through a host, and the host is not the work: a
 * Codex run on Windows records every command as
 * `"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -Command "npm test"`.
 * The row is one line wide, so the host name and its escaped backslashes
 * filled it and the actual command was cut off -- measured 2026-09-03 by
 * reading the card after a real run and being unable to tell what had been
 * run. The host is unwrapped for DISPLAY only; the ledger keeps the argv it
 * really used.
 */
export function shellCommandText(command: string): string {
  const host = /^\s*"?[^"]*(?:powershell|pwsh|cmd)\.exe"?\s+(?:-NoProfile\s+|-NonInteractive\s+|\/d\s+|\/s\s+)*(?:-Command|\/c)\s+([\s\S]+)$/i
  const match = host.exec(command)
  if (match === null) return command
  const inner = match[1]!.trim()
  // The host quotes the whole command; unwrap one matched layer, and undo the
  // doubling that quoting introduced.
  const unquoted =
    (inner.startsWith('"') && inner.endsWith('"')) || (inner.startsWith("'") && inner.endsWith("'"))
      ? inner.slice(1, -1)
      : inner
  return unquoted.replace(/\\"/g, '"').replace(/""/g, '"').replace(/''/g, "'").trim()
}

/**
 * A path as the person working in this folder would write it.
 *
 * Runtimes report absolute paths, and an activity row is one line wide, so a
 * real edit read as a long temp path with the filename cut off -- the one
 * part that mattered. MEASURED 2026-09-03 while using the app. Anything
 * outside the workspace keeps its full path, because there the location IS
 * the information.
 */
const WORKTREE_PATH_PREFIX = /^\.locust\/worktrees\/[^/]+\//

/**
 * Cursor Agent reports the file it edited from inside its OWN copy of the
 * project, not from the folder you opened:
 *
 *   C:/Users/you/.cursor/projects/C-Users-you-code-streaks/src/streak.js
 *
 * That directory name is the workspace path with its separators and colon
 * beaten into hyphens, so it can be recognised for certain rather than
 * guessed at -- and only then, when it matches THIS workspace, is the rest
 * of it the same file you would open yourself. Measured on a real Cursor run
 * 2026-09-07: a two-line edit reported eleven file rows, every one of them
 * wearing a path like that, with the filename pushed off the end of a
 * one-line row.
 *
 * A mirror belonging to some OTHER project keeps its full path, because then
 * the location genuinely is the information.
 */
function cursorMirrorRelative(full: string, root: string): string | undefined {
  const mirror = /^(.*)\/\.cursor\/projects\/([^/]+)\/(.+)$/i.exec(full)
  if (mirror === null) return undefined
  const [, , project, rest] = mirror
  if (project === undefined || rest === undefined) return undefined
  // Colons AND both separators. The class here was one backslash short --
  // it named the forward slash and the escape, not the backslash -- so a
  // Windows root flattened to `C-Users` plus its remaining separators,
  // and never matched Cursor's own project name. The mirror
  // then went unrecognised and every Cursor file row wore the full path
  // this function exists to remove. Found 2026-09-10 by
  // `escapes-survived-the-shell`; `relativePath` below had it right all
  // along, four lines away.
  const flattened = root.replace(/[:\\/]+/g, '-').replace(/^-+|-+$/g, '')
  return project.toLowerCase() === flattened.toLowerCase() ? rest : undefined
}

export function relativePath(path: string, workspacePath: string | undefined): string {
  if (workspacePath === undefined || workspacePath.length === 0) return path
  const normalise = (value: string): string => value.replace(/[\\/]+/g, '/').replace(/\/$/, '')
  const root = normalise(workspacePath)
  const full = normalise(path)
  if (root.length === 0) return path
  // Windows paths are case-insensitive; comparing them case-sensitively is how
  // a correct prefix fails to match and the row keeps the unreadable path.
  const mirrored = cursorMirrorRelative(full, root)
  if (mirrored !== undefined) return mirrored
  // The workspace root ITSELF, which a directory-listing tool reports as the
  // thing it acted on. It fell through every branch below and kept its whole
  // absolute path -- so a stopped run's FINISHED list opened with
  // `C:\Users\...\locust-stopmid-ws-FtLao7` above three bare filenames
  // (measured 2026-09-07). The folder's own name is what a person calls it.
  if (full.toLowerCase() === root.toLowerCase()) return root.split('/').at(-1) ?? path
  if (!full.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
    // Already relative (a runtime that reports paths from its cwd): the tree
    // prefix is still noise. An absolute path elsewhere stays whole.
    const relative = /^([a-z]:)?\//i.test(full) ? full : full.replace(WORKTREE_PATH_PREFIX, '')
    return relative.length === 0 ? path : relative === full ? path : relative
  }
  const inside = full.slice(root.length + 1)
  if (inside.length === 0) return path
  // A teammate on its own branch works in <folder>/.locust/worktrees/<id>/,
  // and every path it touches carries that prefix. The tree is the same
  // project, so the row reads the way it would in the folder; the sidebar
  // already says which branch the teammate is on.
  const stripped = inside.replace(WORKTREE_PATH_PREFIX, '')
  return stripped.length === 0 ? inside : stripped
}

export interface TraceSegment {
  readonly key: string
  readonly text: string
  readonly tone?: 'amber' | 'muted'
}

export type TraceOutcome = 'running' | 'completed' | 'failed' | 'cancelled'

/** How the turn ended, off its own events. */
export function traceOutcome(events: readonly NormalizedRuntimeEvent[], running: boolean): TraceOutcome {
  if (events.some((event) => event.type === 'run.failed')) return 'failed'
  if (events.some((event) => event.type === 'run.cancelled')) return 'cancelled'
  return running ? 'running' : 'completed'
}

/** "41s", "4m 20s", "1h 06m". */
export function durationText(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${String(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${String(minutes)}m ${String(seconds % 60).padStart(2, '0')}s`
  const hours = Math.floor(minutes / 60)
  return `${String(hours)}h ${String(minutes % 60).padStart(2, '0')}m`
}

/**
 * What a finished turn did, as one line a person reads coming back to the
 * laptop: duration, delegation, work, exceptions -- outermost fact to
 * innermost (SURFACES-0.22 §1). A segment that is zero is absent; the floor
 * is the duration alone, so the line never disappears.
 */
export function activityTrace(
  details: readonly ActivityDetail[],
  events: readonly NormalizedRuntimeEvent[],
  outcome: TraceOutcome,
  /**
   * The plan riding on this fold, when there is one.
   *
   * The reference draws the summary as `41s · 3 of 3 steps · asked 1
   * subagent · 6 tool calls · 3 files`, so the plan's progress is part of
   * what the line says the run did -- not just rows hidden inside it. Reading
   * the prose alone got the plan INTO the fold and left this out
   * (`Locust UI Review 2026-09-06.dc.html`, looked at properly 2026-09-06).
   */
  plan?: { readonly steps: readonly PlanStep[]; readonly doneCount: number },
  /**
   * Whether this run was allowed to change files.
   *
   * A run that COULD edit, finished, and edited nothing is a fact worth
   * stating. Cursor Agent said "Applying the two edits to notes.ts now",
   * reported completed, and left the file untouched (measured 2026-09-07);
   * the line above read `41s · thought 3s · asked 4 subagents · 14 tool
   * calls` and never mentioned files at all, because the count is only drawn
   * when it is greater than zero. Nothing on screen contradicted the model's
   * own account of itself.
   *
   * WHY THAT RUN CHANGED NOTHING, found later the same day and recorded
   * because the original note reads like an accusation: the workspace was
   * under `AppData`, and `~/.cursorignore` on that machine excludes it, so
   * Cursor was refused every read and write before it began. Cursor was not
   * misreporting -- it had been handed a folder it was configured to ignore.
   * The harness fix is `_tools/scratch-root.mjs`.
   *
   * The line still belongs here. A run that finished having changed nothing
   * is worth saying whatever the reason, and the reason is exactly what the
   * person cannot see: config, quota, a refusal, or a model that only said
   * it would. Silence reads as success in all four.
   *
   * Stated plainly rather than in amber: asking a question in an
   * edit-permitted session changes nothing either, and that is not a
   * problem. It is the person who asked for an edit who needs this, and for
   * them the plain fact is enough.
   */
  mayEdit?: boolean,
  /**
   * The folder this conversation is open in, so the count can tell one file
   * from two.
   *
   * A first outside tester, on OpenCode: "Alpha UI: 3s / 1 tool call / 2
   * files / +2 -0. Git: one line in one file." One append, counted twice --
   * because a runtime is free to report the same file relatively on one call
   * and absolutely on the next, and to the key below those were two files.
   *
   * `relativePath` already folds absolute-into-workspace, the worktree
   * prefix and Cursor's mirror, and the file ROWS have been drawn through it
   * since 0.38.8. The count never was. Same function on both now, so what
   * the fold lists and what the line counts cannot disagree.
   */
  workspacePath?: string
): readonly TraceSegment[] {
  const segments: TraceSegment[] = []
  const times = events.map((event) => Date.parse(event.occurredAt)).filter((t) => Number.isFinite(t))
  const elapsed = times.length >= 2 ? Math.max(...times) - Math.min(...times) : 0
  const duration = durationText(elapsed)
  const finished = outcome !== 'running'
  const entries = activityEntries(details, workspacePath)
  // How many FILES this run changed, which is not how many rows the card
  // drew. Two corrections from the 0.35.0 targeted QA:
  //
  // - The same path edited twice is one file. The card is right to draw both
  //   rows -- they are two things the runtime did -- but "2 files" over one
  //   file is a claim about the workspace, and it is false.
  // - A refused write changed nothing. It is already counted among the calls
  //   below and said again as "N refused", so counting it here was both a
  //   double count and the wrong noun.
  // Windows paths are case-insensitive and runtimes disagree about separators
  // and a leading `./`; the same file must key the same way whichever one
  // reported it.
  // Through `relativePath` first, because `README.md` and
  // `/home/you/proj/README.md` are one file and only the workspace root
  // knows that.
  const pathKey = (path: string): string =>
    relativePath(path, workspacePath).replace(/[\\/]+/g, '/').replace(/^\.\//, '').toLowerCase()
  const changedPaths = new Set<string>()
  for (const entry of entries) {
    // A parsed diff is a change that landed, by definition -- it is the change.
    if (entry.kind === 'file') changedPaths.add(pathKey(entry.file.path))
    // An edit the runtime named but did not diff counts only if it succeeded.
    else if (entry.kind === 'unreported' && entry.failed !== true) changedPaths.add(pathKey(entry.name))
  }
  const files = changedPaths.size
  const helpers = entries.filter((entry) => entry.kind === 'helper')
  const helpersFailed = helpers.filter((entry) => entry.failed).length
  const helpersSilent = finished ? helpers.filter((entry) => !entry.settled && !entry.failed).length : 0
  /*
   * Shell commands are counted SEPARATELY, not among the anonymous calls.
   *
   * The line already named the command when there was exactly one -- "ran seq
   * 1 300" instead of "1 tool call" -- on the reasoning that a count of a
   * thing you cannot see is not worth the room. The same is true of four of
   * them, and counting them twice ("6 tool calls · ran 4 commands") would say
   * one fact in two places, which this line does not do.
   */
  const calls = details.filter((detail) => detail.kind !== 'helper' && detail.kind !== 'edit' && detail.kind !== 'shell').length
    + details.filter((detail) => detail.kind === 'edit' && detail.failed === true).length
  const diagnostics = events.filter(
    (event): event is Extract<NormalizedRuntimeEvent, { type: 'adapter.diagnostic' }> => event.type === 'adapter.diagnostic' && !/\.usage_window$/.test(event.payload.code)
  )
  // `no files changed` is a claim about the workspace, and it must not be made
  // in the one case where the host has ALREADY said it cannot tell what this
  // run changed. Two teammates in one folder suppress the git inference and
  // raise `host.shared_workspace` -- "what changed on disk cannot be told
  // apart ... it is not counted as this run's work" -- and the line then read
  // `no files changed - 1 notice` next to that sentence.
  //
  // MEASURED 2026-09-07, one teammate on OpenCode and one on Cursor at once:
  // Wren's card said `no files changed` while `wren-note.txt` sat on disk,
  // correct, written by that very run. Its runtime reported no edit of its
  // own and the overlap suppressed the inference, so the app knew nothing --
  // which is not the same as knowing nothing happened.
  //
  // The notice still appears and the fold still carries the whole sentence,
  // so silence is not what replaces it. What goes is the false half.
  const cannotAttribute = diagnostics.some(
    (event) => event.payload.code === 'host.shared_workspace'
  )
  const refused = diagnostics.filter((event) => /denied|refus|permission/i.test(event.payload.code) || /not permitted|refused/i.test(event.payload.message)).length

  if (outcome === 'failed' || outcome === 'cancelled') {
    segments.push({ key: 'duration', text: `stopped at ${duration}` })
    if (outcome === 'cancelled' && files === 0) segments.push({ key: 'nothing', text: 'nothing was changed', tone: 'muted' })
  } else {
    segments.push({ key: 'duration', text: duration })
  }

  // Thought only when reasoning spans exist; most runtimes never report one.
  let thought = 0
  const openReasoning = new Map<string, number>()
  for (const event of events) {
    if (event.type === 'step.started' && event.payload.stepKind === 'reasoning') openReasoning.set(event.payload.itemId ?? 'reasoning', Date.parse(event.occurredAt))
    if ((event.type === 'step.completed' || event.type === 'step.failed') && event.payload.stepKind === 'reasoning') {
      const key = event.payload.itemId ?? 'reasoning'
      const began = openReasoning.get(key)
      if (began !== undefined) { thought += Math.max(0, Date.parse(event.occurredAt) - began); openReasoning.delete(key) }
    }
  }
  if (thought >= 1000) segments.push({ key: 'thought', text: `thought ${durationText(thought)}` })
  // Before the subagents and the tool calls: the plan is the shape of the
  // work, and the rest is how it was carried out.
  if (plan !== undefined && plan.steps.length > 0) {
    segments.push({
      key: 'steps',
      // `pluralize`, like every other count in this file. A one-step plan
      // read "0 of 1 steps" (static sweep, 2026-09-14, A3) -- and a one-step
      // plan is reachable, because this line only renders where there are
      // outcomes to count.
      text: `${String(plan.doneCount)} of ${pluralize(plan.steps.length, 'step')}`
    })
  }

  if (helpers.length > 0) {
    let text = `asked ${pluralize(helpers.length, 'subagent')}`
    let tone: TraceSegment['tone']
    if (helpersFailed > 0) { text += helpers.length === 1 ? ' · it failed' : ` · ${String(helpersFailed)} failed`; tone = 'amber' }
    else if (helpersSilent > 0) { text += helpers.length === 1 ? ' · it did not report' : ` · ${String(helpersSilent)} did not report`; tone = 'amber' }
    segments.push({ key: 'subagents', text, ...(tone === undefined ? {} : { tone }) })
  }
  /*
   * One command, and the line NAMES it: `ran seq 1 300`.
   *
   * "1 tool call" is a count of a thing the person cannot see without opening
   * the fold, which is the same complaint as the `1 notice` chip above. The
   * point of the closed state is that a finished turn reads as bubble, one
   * line, two replies -- and that only works if the one line says what
   * happened (design, 2026-09-08).
   *
   * Only when there is exactly one, and only for a shell command: naming one
   * of four would be arbitrary, and a `Read` of a path is already the file
   * rows' job. Bounded, because a command can be a paragraph and this line
   * shares its row with the duration, the file count and the cost.
   */
  const shellCommands = details.filter((detail) => detail.kind === 'shell')
  // Through `shellCommandText`, the same unwrapping the command ROW uses. A
  // raw name on Windows begins with the whole
  // `"C:\Windows\...\powershell.exe" -NoProfile -Command` preamble, so a
  // summary built from it would spend its 60 characters on the host shell and
  // never reach the command.
  const onlyCommand =
    shellCommands.length === 1
      ? shellCommandText(shellCommands[0]?.name ?? '').split('\n')[0]?.trim()
      : undefined
  if (calls > 0) segments.push({ key: 'calls', text: pluralize(calls, 'tool call') })
  /*
   * What it RAN, and what came back.
   *
   * One command still gets its name -- that is the most useful thing the line
   * can say, and it was already true. Several get a count and their outcome,
   * because four command lines will not fit and "all exit 0" is the part a
   * reader is actually asking about.
   */
  if (shellCommands.length === 1 && onlyCommand !== undefined && onlyCommand.length > 0) {
    const one = commandsRunText(commandsRun(details, finished))
    const named = `ran ${onlyCommand.length > 60 ? `${onlyCommand.slice(0, 59)}…` : onlyCommand}`
    segments.push({
      key: 'commands',
      // The command's own exit code is on its ROW, so the line repeats it only
      // when it is the thing worth knowing: something other than success.
      text: one !== undefined && one.amber ? `${named} · ${one.text.split(' · ')[1] ?? ''}` : named,
      ...(one?.amber === true ? { tone: 'amber' as const } : {})
    })
  } else {
    const many = commandsRunText(
      commandsRun(details, finished),
      shellCommands.map((detail) => detail.name)
    )
    if (many !== undefined) {
      segments.push({ key: 'commands', text: many.text, ...(many.amber ? { tone: 'amber' as const } : {}) })
    }
  }
  if (files > 0 && !(outcome === 'cancelled' && files === 0)) segments.push({ key: 'files', text: pluralize(files, 'file') })
  else if (files === 0 && outcome === 'completed' && mayEdit === true && !cannotAttribute) {
    segments.push({ key: 'files', text: 'no files changed' })
  }
  if (refused > 0) segments.push({ key: 'refused', text: `${String(refused)} refused`, tone: 'amber' })
  /*
   * No `1 notice` chip. The notices themselves are drawn at the foot of the
   * fold instead -- see `activityNotices` and ActivityCard.
   *
   * The chip counted a thing the person could not read, and worse, it counted
   * a DIFFERENT set than the thread showed. This function counted every
   * diagnostic bar a usage window; the thread's own gate drops any diagnostic
   * arriving before the first tool call unless it is a run-level
   * `runtime_error` or `notification`, because Codex comments on its own setup
   * as every turn opens. So a `seq 1 300` run displayed `1 notice` with no
   * sentence anywhere on the screen -- confirmed in the shipped 0.52.0 capture,
   * whose whole recorded text is "1 tool call / no files changed / 1 notice /
   * seq 1 300 / exit 0".
   *
   * A count of an unnamed thing is not information. Naming it also makes the
   * two filters impossible to drift apart again, because there is only one.
   */
  return segments
}

export function activitySummary(details: readonly ActivityDetail[]): string {
  // Files, not edit calls: one Codex file_change can touch several files, and
  // "Edited 1 file" over a two-file change is the wrong number.
  // An edit that FAILED edited nothing: a read-only Claude Code run whose
  // Write was refused still read "Edited 1 file" (seen driving, 2026-09-05).
  // The refused row stays in the list, marked failed; it counts as a call.
  const edits = details
    .filter((detail) => detail.kind === 'edit' && detail.failed !== true)
    .reduce((sum, detail) => sum + Math.max(1, detail.name.split('\n').filter((line) => line.length > 0).length), 0)
  const commands = details.filter((detail) => detail.kind === 'shell').length
  const helpers = details.filter((detail) => detail.kind === 'helper').length
  const other = details.length - edits - commands - helpers
  const parts: string[] = []
  if (edits > 0) parts.push(`Edited ${pluralize(edits, 'file')}`)
  if (commands > 0) parts.push(`ran ${pluralize(commands, 'command')}`)
  if (helpers > 0) parts.push(`asked ${pluralize(helpers, 'subagent')}`)
  if (other > 0) parts.push(`${pluralize(other, 'tool call')}`)
  return parts.length === 0 ? 'No tool activity' : parts.join(' · ')
}

/**
 * The commands a turn RAN, and what they returned.
 *
 * Astra's proposal, 2026-09-11, and the one part of it that needs no new
 * judgement from anybody: a turn's line says what it CHANGED -- `3 files` --
 * and never what it ran, so a run that edited three files and a run that
 * edited three files and proved them read identically. The ledger has had the
 * commands and their exit codes the whole time.
 *
 * Deliberately no inference about what a command MEANS. This does not decide
 * that `pnpm test` is a test and `ls` is not; it says what was run and what
 * came back, and the reader decides whether that is evidence. Anything else
 * would be the app guessing at proof, which is worse than staying quiet.
 *
 * An unsettled command is its own answer: a turn that is over and a command
 * that never reported is not a pass, and not a failure either.
 */
export interface CommandsRun {
  readonly ran: number
  /** Reported a non-zero exit, or failed outright. */
  readonly nonZero: number
  /** Started, and the turn ended without an outcome. Only meaningful once finished. */
  readonly unsettled: number
}

export function commandsRun(details: readonly ActivityDetail[], finished: boolean): CommandsRun {
  const shell = details.filter((detail) => detail.kind === 'shell')
  return {
    ran: shell.length,
    nonZero: shell.filter((detail) => detail.failed === true || (detail.exitCode !== undefined && detail.exitCode !== 0)).length,
    unsettled: finished
      ? shell.filter((detail) => detail.settled !== true && detail.failed !== true).length
      : 0
  }
}

/**
 * That, as the words the trace line uses. `undefined` when nothing ran.
 *
 * THE SUCCESS CASE NAMES THE COMMANDS RATHER THAN GRADING THEM.
 *
 * It shipped as `ran 4 commands · all exit 0`, and the design agent's ruling
 * on 2026-09-11 found the defect in it: that is the ONE segment on the line
 * where the app aggregates and grades. Every other segment names a thing that
 * happened; this collapsed four facts into a verdict, and "all" plus "0" is
 * about as close to the word PASSED as you can get without typing it. Their
 * test for whether a segment is grading -- "could it be wrong?" -- catches it
 * exactly: `all exit 0` cannot be wrong literally, but what it COMMUNICATES
 * can be, and that gap is the whole bug. A person who read it as "checked"
 * did not misread the line; the line told them.
 *
 * `ran pnpm check, tsc and 2 more` is the same derivation with no verdict in
 * it. The reader supplies the judgement, which is the division of labour this
 * whole feature committed to.
 *
 * The non-zero case is untouched, and deliberately: a command that failed IS
 * news, it IS derived, and amber is right because a person does need to act.
 */
export function commandsRunText(
  run: CommandsRun,
  names: readonly string[] = []
): { readonly text: string; readonly amber: boolean } | undefined {
  if (run.ran === 0) return undefined
  const ran = `ran ${pluralize(run.ran, 'command')}`
  if (run.nonZero > 0) {
    return {
      text: `${ran} · ${run.ran === 1 ? 'it exited non-zero' : `${String(run.nonZero)} exited non-zero`}`,
      amber: true
    }
  }
  if (run.unsettled > 0) {
    return {
      text: `${ran} · ${run.ran === 1 ? 'it did not report' : `${String(run.unsettled)} did not report`}`,
      amber: true
    }
  }
  const named = commandList(names, run.ran)
  return { text: named ?? ran, amber: false }
}

/**
 * `ran pnpm check, tsc and 2 more`, bounded to a line.
 *
 * The FIRST WORD of each command, which is the part that identifies it: the
 * rest is flags and paths, and four full command lines do not fit beside a
 * duration, a file count and a cost. `undefined` when nothing usable was
 * recorded, and then the caller falls back to the plain count -- a count is
 * not a verdict, it is just less useful.
 */
export function commandList(names: readonly string[], ran: number): string | undefined {
  const heads = names
    .map((name) => shellCommandText(name).split('\n')[0]?.trim() ?? '')
    .map((line) => line.split(/\s+/)[0] ?? '')
    .filter((head) => head.length > 0 && head.length <= 24)
  if (heads.length === 0) return undefined
  // Two named, then a count. Three names is already longer than the rest of
  // the line put together.
  const shown = heads.slice(0, 2)
  const rest = ran - shown.length
  if (rest <= 0) return `ran ${shown.join(' and ')}`
  return `ran ${shown.join(', ')} and ${String(rest)} more`
}

/**
 * What a subagent call without an ask of its own was doing. Codex's collab
 * tools arrive as `subagent:<verb>`; only spawn carries a prompt (2026-09-06).
 */
function subagentVerb(tool: string | undefined): string {
  const verb = tool === undefined ? undefined : /^subagent:(\w+)$/i.exec(tool)?.[1]
  switch (verb) {
    case 'wait':
    case 'wait_agent':
      return 'waiting for a subagent to report'
    case 'send_input':
      return 'a message to a subagent'
    case 'close_agent':
    case 'close':
      return 'closing a subagent'
    default:
      return 'a subagent, unnamed'
  }
}

/**
 * An MCP tool call, split into the two things a person recognises.
 *
 * A connector's tool arrives as one machine name --
 * `mcp__claude_ai_Robinhood__get_watchlists` -- and the row drew it whole.
 * Colin, seeing the first one that ever reached a teammate (2026-09-09):
 * "the mcp tool calls came out a little messy, might need to make that part
 * of the ui".
 *
 * The shape is `mcp__<server>__<tool>`, and both halves are worth having
 * separately: the SERVER is the thing a person connected and thinks in
 * ("Robinhood"), the TOOL is what was done with it ("get_watchlists"). That
 * is the same split the row already draws for every other tool -- the name
 * it acted on, and the tool that acted -- so an MCP call stops being a
 * special case and becomes an ordinary row.
 *
 * `claude_ai_` is stripped because it is a transport detail. An account
 * connector and a local server for the same product are the same product to
 * the person who connected it, and neither of them calls it "claude ai
 * Robinhood".
 *
 * Codex already sends `server.tool` for its own MCP calls, so that shape is
 * read too rather than left as the one runtime this does not help.
 */
export function mcpToolParts(name: string): { readonly server: string; readonly tool: string } | undefined {
  const doubled = /^mcp__(.+?)__(.+)$/.exec(name)
  if (doubled !== null) {
    return { server: prettyServer(doubled[1] ?? ''), tool: doubled[2] ?? '' }
  }
  /*
   * `Google_Drive__create_file` -- a connector tool with no `mcp__` prefix.
   *
   * MEASURED 2026-09-11, driving a real run: it read as `using a tool ·
   * Google_Drive__create_file`, an ordinary tool with a strange name. Every
   * connector name this app had ever been shown carried the prefix, so the
   * split required it; this one does not, and the shape is still unambiguous.
   *
   * Deliberately narrow. The left part must look like a name -- letters,
   * digits and single underscores, nothing that could be a path, a flag or a
   * sentence -- because the only thing separating this from a false positive
   * is that no ordinary tool is called `Read__something`. Read, Write, Bash,
   * Grep, Task and WebFetch carry no double underscore at all.
   */
  const bare = /^([A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)*)__([A-Za-z][A-Za-z0-9_-]*)$/.exec(name)
  if (bare !== null) {
    return { server: prettyServer(bare[1] ?? ''), tool: bare[2] ?? '' }
  }
  // Codex's own join, and only when it really is one: a dot in a file path
  // is not a server.
  const dotted = /^mcp[_.]?(?:tool)?[_.](.+)$/.exec(name)
  if (dotted !== null && dotted[1] !== undefined && dotted[1].includes('.')) {
    const at = dotted[1].indexOf('.')
    return { server: prettyServer(dotted[1].slice(0, at)), tool: dotted[1].slice(at + 1) }
  }
  return undefined
}

/** The name a person connected, not the transport that carries it. */
function prettyServer(raw: string): string {
  return raw.replace(/^claude_ai_/, '').replace(/[_-]+/g, ' ').trim()
}

/**
 * Whether a tool call is a command, whatever the runtime calls its shell.
 *
 * This asked for the name `shell` or the kind `command_execution`, which
 * between them describe exactly ONE runtime: Codex. Claude Code names the
 * tool `Bash` and OpenCode names it `bash`, so every shell call either of
 * them made fell through to a generic tool row -- no exit-code badge,
 * nothing to expand, and counted under "other" in the turn summary rather
 * than as a command.
 *
 * Found trying to see 0.56.0's intent line on screen (2026-09-09). That
 * feature reads the model's own `description` for a Bash call, and both
 * those adapters carry it -- but the line is drawn by the COMMAND ROW, and
 * neither runtime ever produced one. So the feature was invisible on every
 * runtime: the two that send a description had no row, and the one with a
 * row sends no description. A test of the adapters passed the whole time.
 *
 * Matched case-blind, because the two spellings differ only in case and the
 * next runtime will pick one of them.
 */
export function isShellTool(name: string, toolKind: string | undefined): boolean {
  // `run_command` is Antigravity's word, and leaving it out cost every one of
  // its runs their commands: MEASURED 2026-09-13 across the recorded ledgers,
  // 76 `run_command` calls, none of them counted as a command. So "Ran N
  // commands" said nothing, the trace line had nothing to trace, and the
  // reviewer's WHAT RAN was empty for a run that had run seventy-six things.
  return /^(bash|shell|run_command|run_terminal_cmd|execute_command)$/i.test(name)
    || toolKind === 'command_execution'
    || toolKind === 'run_command'
}

function toolKindOf(event: Extract<NormalizedRuntimeEvent, { type: 'tool.started' }>): string {
  const name = event.payload.name
  const command = event.payload.command
  if (isShellTool(name, event.payload.toolKind)) {
    return command !== undefined && EDIT_COMMANDS.test(command.trim()) ? 'edit' : 'shell'
  }
  // A runtime's own sub-agent: Claude Code's `Task`, OpenCode's `task`.
  if (SUBAGENT_TOOL.test(name)) return 'helper'
  return editToolName(name) ? 'edit' : 'tool'
}

/**
 * Whether a tool name means "this touched a file".
 *
 * Matching `write` anywhere caught two tools that never touch one: OpenCode's
 * `todowrite`, the model's own to-do list -- offered even to read-only runs --
 * and Copilot's `write_agent`. Each names no path and carries no diff, so the
 * fold counted a changed file on a run that changed nothing (QA, 2026-09-06).
 * Missing `delete` was the same mistake from the other side: Cursor names a
 * removal `delete`, and a run that deleted a file reported a tool call and no
 * file.
 *
 * So the words are matched as whole words rather than as substrings, and the
 * list is the vocabulary the adapters actually produce.
 */
const EDIT_TOOL_WORDS = new Set([
  'file',
  'files',
  'patch',
  'write',
  'edit',
  'delete',
  'remove',
  'create',
  'move',
  'rename'
])
const NOT_EDIT_TOOLS = /^(todowrite|todoread|todo_write|todo_read|write_agent|writeagent)$/i

/**
 * Words that mean the tool LOOKED at something.
 *
 * They beat the nouns below, and they have to, because the noun is the half
 * the two kinds of tool share: `view_file` and `write_to_file` both contain
 * `file`, and matching nouns alone made READING a file count as changing one.
 *
 * MEASURED 2026-09-13 in the recorded ledgers: 38 Antigravity `view_file`
 * calls, every one of them counted as an edit. So an Antigravity run that
 * changed nothing reported changed files -- and since 0.96.0 those files are
 * handed to a reviewer under WHAT CHANGED, which makes it a false claim about
 * the work rather than a miscount.
 */
const READ_TOOL_WORDS = new Set(['view', 'read', 'open', 'show', 'list', 'cat', 'search', 'find', 'grep'])

export function editToolName(name: string): boolean {
  const trimmed = name.trim()
  if (trimmed.length === 0) return false
  if (NOT_EDIT_TOOLS.test(trimmed)) return false
  const words = trimmed
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z]+/)
    .map((word) => word.toLowerCase())
  if (words.some((word) => READ_TOOL_WORDS.has(word))) return false
  // Split on separators AND on camelCase, so `deleteFile`, `delete_file` and
  // `DeleteFile` all read as the two words they are -- and `todowrite`, which
  // is one word, reads as one and matches nothing.
  return words.some((word) => EDIT_TOOL_WORDS.has(word))
}

/**
 * Rebuild the assistant text the way the transcript did. Deltas carry an
 * `append` or `replace` operation against a per-item buffer, so taking the last
 * delta's text alone returns only its final fragment -- the same trap the
 * checkpoint reconciler documents.
 */
export function assistantMessages(
  events: readonly NormalizedRuntimeEvent[]
): readonly { readonly itemId: string; readonly text: string; readonly final: boolean }[] {
  const order: string[] = []
  const buffers = new Map<string, { text: string; final: boolean }>()
  for (const event of events) {
    if (event.type !== 'message.delta') continue
    const { itemId, operation, text, final } = event.payload
    const existing = buffers.get(itemId)
    if (existing === undefined) order.push(itemId)
    const next = operation === 'replace' ? text : `${existing?.text ?? ''}${text}`
    buffers.set(itemId, { text: next, final })
  }
  return order.map((itemId) => ({ itemId, ...buffers.get(itemId)! }))
}

/**
 * Everything a teammate SAID in one turn, as one piece of prose.
 *
 * For the surfaces that draw a turn as a single utterance -- a room's
 * exchange, the collapsed answers list -- where the thread itself draws each
 * message separately.
 *
 * It exists because those surfaces each took `the last message marked final`
 * and fell back to `the latest message` while none was. So a teammate's
 * progress appeared as it was written and vanished the moment the turn
 * finished, the final message replacing everything before it (Colin,
 * 2026-09-13). A turn is what was said, all of it, in order.
 */
export function turnText(events: readonly NormalizedRuntimeEvent[]): string {
  return assistantMessages(events)
    .map((message) => message.text)
    .filter((text) => text.trim().length > 0)
    .join(PARAGRAPH_GAP)
}

/** A blank line between two things that were said separately. */
const PARAGRAPH_GAP = String.fromCharCode(10, 10)

export interface MissionThreadOptions {
  /** While a run is live the last message shows a streaming caret. */
  readonly running: boolean
  /**
   * When the run was started, so the waiting line can time the launch itself.
   * Without it a run with no events yet has no clock to show, and the line is
   * held back -- which is the lag it exists to remove.
   */
  readonly startedAt?: string
  /**
   * True when the run is stopped on an approval. A run awaiting a decision is
   * still `running`, so the waiting line would sit directly above the card
   * asking the question and say "Working" while the header says "waiting on
   * you" -- two surfaces describing one teammate differently, which is the
   * exact defect `faceState.ts` exists to prevent. The card is already saying
   * what is happening, so nothing is added above it.
   */
  readonly awaitingDecision?: boolean
  /** Whether the run was allowed to change files; see activityTrace. */
  readonly mayEdit?: boolean
  /**
   * The folder the conversation is open in. The file COUNT needs it for the
   * same reason each file ROW does -- see activityTrace.
   */
  readonly workspacePath?: string
  /**
   * Whether this turn wrote to a teammate. Those messages are drawn beside
   * the thread rather than inside it, so a turn whose whole output was a
   * message to a colleague looked, from in here, like a turn that said
   * nothing -- and got told so, in a warning sitting directly above the
   * message it had just sent (Colin, 2026-09-06: "the this turn ended with a
   * reply intended?").
   */
  readonly spokeToPeers?: boolean
  /**
   * True for the turn at the END of the conversation. A question a runtime
   * asked is only answerable there: on an earlier turn the answer already
   * exists -- it is the next turn's prompt, visible a few lines below -- and
   * offering the buttons again would invite answering it twice.
   */
  readonly latestTurn?: boolean
}

export function buildThread(
  events: readonly NormalizedRuntimeEvent[],
  options: MissionThreadOptions
): readonly ThreadItem[] {
  const items: ThreadItem[] = []
  const openTools = new Map<string, ActivityDetail>()
  /**
   * When each open tool began, so the live line can be the TOOL rather than
   * the turn around it.
   *
   * Claude Code reports no step for a tool call -- only `tool.started` -- so
   * a run that spent thirty seconds reading files said "working" the whole
   * way (MEASURED 2026-09-11, `probe-live-line-says-which`: `sawATool:
   * false`). The register was honest and useless, which is the worst of both.
   */
  const openToolAt = new Map<string, { readonly at: string; readonly connector: string | undefined }>()
  const activity: ActivityDetail[] = []
  let runningStep:
    | {
        label: string
        detail: string | undefined
        startedAt: string
        kind: 'turn' | 'reasoning' | 'item'
        register: 'working' | 'thinking' | 'writing' | 'tool'
      }
    | undefined
  let plan: readonly PlanStep[] = []
  // Notices that arrive before the run has done anything are the runtime
  // talking about its own setup (a skills budget, a config warning), not
  // about the mission. They stay in the Signal Rail; the thread keeps only
  // notices raised while the work was under way.
  let workBegan = false
  /** Diagnostics the thread gate drops, drawn at the foot of the fold instead. */
  const foldNotices: { readonly level: 'info' | 'warning' | 'error'; readonly message: string; readonly source: MissionRuntimeId }[] = []

  for (const event of events) {
    switch (event.type) {
      case 'tool.started': {
        workBegan = true
        // The host's disk observation of a path the runtime already named:
        // its patch belongs on the runtime's row, not on a second one.
        //
        // This used to require the runtime's row to have NO patch, which
        // quietly meant "only for Codex": its `file_change` names a path and
        // sends no diff, while Cursor, OpenCode and Claude all diff their own
        // edits. So on every one of those, the observation of a change the
        // runtime had ALREADY reported became a second, identical row --
        // measured 2026-09-07 by `_tools/drive-reveal.mjs`, where one written
        // file drew `report.md ADDED +1 -0` twice under a line reading
        // `1 file`. The stated intent above was always unconditional; the
        // condition was the accident.
        if (event.payload.toolKind === 'observed_edit' && /reported by the runtime/.test(event.payload.status ?? '')) {
          const path = (event.payload.command ?? '').toLowerCase()
          const tail = path.split('/').at(-1) ?? path
          const own = activity.find((detail) => detail.kind === 'edit' && detail.name.toLowerCase().replace(/\\/g, '/').split('/').at(-1) === tail)
          if (own !== undefined) {
            openTools.set(event.payload.itemId, own)
            openToolAt.set(event.payload.itemId, { at: event.occurredAt, connector: undefined })
            break
          }
        }
        // A connector call names the SERVER as its tool and the tool as its
        // name, which is the split every other row already uses.
        const mcp = mcpToolParts(event.payload.name)
        const detail: ActivityDetail = {
          kind: toolKindOf(event),
          name: mcp?.tool ?? event.payload.command ?? event.payload.name,
          tool: mcp?.server ?? event.payload.name,
          // Only Claude Code and OpenCode send one; the others leave it
          // undefined and their rows read exactly as they always have.
          ...(typeof event.payload.title === 'string' && event.payload.title.length > 0
            ? { title: event.payload.title }
            : {}),
          settled: false
        }
        openTools.set(event.payload.itemId, detail)
        // Whether it reaches OFF this machine, decided by the same split the
        // row uses. `tool !== name` cannot answer it: an ordinary call names
        // the tool and its target too (`Read` / `README.md`).
        openToolAt.set(event.payload.itemId, { at: event.occurredAt, connector: mcp?.server })
        activity.push(detail)
        break
      }
      case 'tool.completed':
      case 'tool.failed': {
        const open = openTools.get(event.payload.itemId)
        if (open !== undefined) {
          const index = activity.indexOf(open)
          const patch = event.payload.patch
          if (index >= 0) {
            activity[index] = {
              ...open,
              settled: true,
              failed: event.type === 'tool.failed',
              ...(event.payload.exitCode === undefined ? {} : { exitCode: event.payload.exitCode }),
              ...(event.payload.status === undefined ? {} : { status: event.payload.status }),
              ...(typeof event.payload.output === 'string' ? { output: event.payload.output } : {}),
              // A completion that carries a patch also names what it touched:
              // the row's kind follows the evidence, not the tool's name.
              ...(patch === undefined ? {} : { patch, kind: 'edit' }),
              // Some runtimes only know what a tool acted on once it is done:
              // Claude streams a tool's input as JSON deltas AFTER the call
              // opens, so its rows read `Read done` with no file until the
              // target arrives here. A start that already named one keeps it.
              ...(event.payload.command === undefined || open.name !== open.tool
                ? {}
                : { name: event.payload.command })
            }
          }
          openTools.delete(event.payload.itemId)
        }
        openToolAt.delete(event.payload.itemId)
        break
      }
      case 'step.started': {
        // A turn opening is not work yet: Codex raises its setup notices
        // right after it, before any tool runs, and counting the turn as work
        // put "skill descriptions were shortened" back in every thread.
        if (event.payload.stepKind !== 'turn') workBegan = true
        const message = event.payload.message
        // A message item is the model writing, not a tool: "Thinking ·
        // userMessage · 5s" beside an approval card read as a tool nobody
        // had heard of (seen driving the app, 2026-09-05). The label stays;
        // the item type is only worth showing when it names real work.
        const itemType = event.payload.itemType
        // A message ITEM is the model writing; anything else a runtime opens
        // an item for is it using something. Read off the item type, which is
        // the same fact the detail is suppressed for.
        const writingNow = itemType !== undefined && /message$/i.test(itemType)
        runningStep = {
          label: message ?? (event.payload.stepKind === 'turn' ? 'Working' : 'Thinking'),
          // The item type is gone from the line. It was there to name the
          // kind of work -- `subagent`, `commandExecution` -- and the register
          // now does that in words a person uses, so printing the runtime's
          // own word for it beside them is the same fact twice, in jargon.
          detail: undefined,
          startedAt: event.occurredAt,
          kind: event.payload.stepKind,
          register:
            event.payload.stepKind === 'reasoning'
              ? 'thinking'
              : event.payload.stepKind === 'turn'
                ? 'working'
                : writingNow
                  ? 'writing'
                  : 'tool'
        }
        break
      }
      case 'plan.updated': {
        workBegan = true
        plan = readPlan(event.payload.plan)
        break
      }
      case 'step.completed':
      case 'step.failed': {
        runningStep = undefined
        break
      }
      case 'route.limit_detected': {
        items.push({
          key: event.id,
          type: 'limit',
          kind: event.payload.kind,
          message: event.payload.message
        })
        break
      }
      case 'adapter.diagnostic': {
        // Before any tool runs, only trouble with the RUN ITSELF gets through.
        //
        // The gate exists because Codex comments on its own setup the moment a
        // turn opens ("Skill descriptions were shortened...") and that belongs
        // nowhere near the top of a thread. But it was swallowing something
        // very different: MEASURED 2026-09-03, against a dead endpoint Codex
        // retries five times across five to eight minutes and reports each
        // attempt as `Reconnecting... 2/5`. Those arrive before the first tool
        // too, so every one was dropped and the mission sat reading "running"
        // with nothing on screen at all. The run was working; the thread
        // refused to say so.
        //
        // The adapters already separate these: a `*.runtime_error` is the run
        // in trouble, an item diagnostic is the provider talking about one
        // item. Only the former is worth interrupting an empty thread for.
        // A usage window is state the host keeps, not a line in the thread.
        if (/\.usage_window$/.test(event.payload.code)) break
        if (!workBegan && !/\.(runtime_error|notification)$/.test(event.payload.code)) {
          /*
           * Not shown in the thread -- and, until now, not shown anywhere.
           *
           * The trace line counted these as `1 notice` while this gate kept
           * the sentence off the screen, so the person read a number for a
           * thing they could never open. The design's rule is that a chip
           * counting an unnamed thing becomes a sentence that names it, and
           * these belong to the turn's WORK, so the fold's foot is where they
           * go.
           *
           * Collected HERE, in the same branch that drops them, rather than
           * re-derived by a second function -- two filters over one set is
           * how the count and the sentence disagreed in the first place.
           */
          // With its source: the fold names who said it, so a runtime's
          // remark about itself is never read as a command's output.
          foldNotices.push({ level: event.payload.level, message: event.payload.message, source: event.sourceAdapter })
          break
        }
        // Said once. A quota failure arrives as a limit event AND as the
        // runtime's error line carrying the same sentence; user session 1
        // (2026-09-05) showed "You've hit your usage limit..." three times in
        // a row for one failure. The limit card is the one that names it.
        if (items.some((held) => held.type === 'limit' && sameSentence(held.message, event.payload.message))) break
        items.push({
          key: event.id,
          type: 'diagnostic',
          level: event.payload.level,
          message: event.payload.message
        })
        break
      }
      default:
        break
    }
  }

  // The plan goes INSIDE the fold, as its first rows.
  //
  // A plan is the clearest possible statement of what the run DID -- it is
  // the fold's own content, not a separate object above it. Drawn as its own
  // card it put a second species on the screen for almost every Codex run,
  // saying the same kind of thing the fold below it says (design review,
  // 2026-09-06).
  //
  // It only rides along when there IS a fold. A plan with no activity behind
  // it -- a read-only run that answered with steps and touched nothing -- is
  // still the only account of that turn, and it keeps its own item rather
  // than vanishing.
  const planSteps = plan.length > 0
    ? { steps: plan, doneCount: plan.filter((step) => step.state === 'done').length }
    : undefined

  if (activity.length > 0) {
    items.push({
      key: 'activity',
      type: 'activity',
      summary: activitySummary(activity),
      trace: activityTrace(
        activity,
        events,
        traceOutcome(events, options.running),
        planSteps,
        options.mayEdit,
        options.workspacePath
      ),
      finished: !options.running,
      /*
       * ANY finished turn keeps its work on screen, not only the newest.
       *
       * It used to be the newest alone, so that a long conversation was not a
       * wall of tool rows. The cost of that turned out to be worse than the
       * wall: `ActivityCard` remounts when a turn stops being the current one
       * -- proven, because a fold opened BY HAND survives a later message and
       * a defaulted one does not -- so sending a follow-up took a fold the
       * person was reading and closed it. Measured in
       * `docs/user-session/2026-09-08T14-07-32-earlier-turn-work`: six rows on
       * screen, then `expanded: false, rowsVisible: 0`, with nothing pressed.
       *
       * Colin, 2026-09-08: "the thoughts and tool calls disappear after an
       * agent is done ... we want that to stay so they can see after the fact
       * or if they missed it." This is also what Claude Code does -- a
       * transcript keeps its tool calls, they do not fold away behind you --
       * and his standing rule is to match it where we have no better reason.
       *
       * Closing one still sticks, because a press is remembered where a
       * default is not.
       */
      ...(options.running ? {} : { openByDefault: true }),
      details: activity,
      ...(planSteps === undefined ? {} : { plan: planSteps }),
      ...(foldNotices.length === 0 ? {} : { notices: foldNotices }),
      reportedBy: events.find((event) => event.type.startsWith('tool.'))?.sourceAdapter
    })
  } else if (planSteps !== undefined) {
    items.push({
      key: 'plan',
      type: 'plan',
      steps: planSteps.steps,
      doneCount: planSteps.doneCount
    })
  }

  for (const message of assistantMessages(events)) {
    // A share block is shown in the peer card, attributed and labelled; left
    // in the bubble it would present the same claim twice, once unlabelled.
    const text = stripMemoryBlocks(stripTaskBlocks(stripDecisionBlocks(stripShareBlocks(message.text))))
    if (text.length === 0) continue
    items.push({
      key: `msg_${message.itemId}`,
      type: 'agent-message',
      text,
      // A caret only where text is genuinely still arriving: the run is live
      // AND the provider has not marked this message final.
      streaming: options.running && !message.final
    })
  }

  if (options.running) {
    const streaming = items.some((item) => item.type === 'agent-message' && item.streaming)
    /*
     * A TOOL STILL OPEN outranks everything, because it is the most specific
     * true thing about the run: more specific than the turn around it, and
     * the one register a person most wants told apart from the reply.
     *
     * Newest first -- a tool that opened inside another is what is happening
     * now. A connector is named as one: the row already splits server from
     * tool, and "using a connector - get_watchlists - Robinhood" is what a
     * person would say about it.
     */
    /*
     * ONE CLOCK FOR THE TURN, and the phase is a label on it.
     *
     * Two captures of one running turn, seconds apart, in the frame pass of
     * 2026-09-15:
     *
     *     starting ... - 3s
     *     working  -    0s
     *
     * The counter restarted when the register changed, because each branch
     * below timed from its own beginning. That is the one thing an elapsed
     * counter must never do, and it is worse here than in most apps: this
     * number is how a person tells a slow runtime from a hung one.
     *
     * The bottom branch already ran from the turn's start and said why --
     * "a number that only ever climbs cannot be mistaken for one" -- and the
     * other two did not. Now all three share this.
     *
     * A tool's own duration is not lost; the trace states it per call, where
     * it is a fact about that call rather than a clock a person is watching.
     */
    const turnStartedAt = options.startedAt ?? events[0]?.occurredAt ?? events.at(-1)?.occurredAt
    const openToolId = [...openTools.keys()].at(-1)
    const openTool = openToolId === undefined ? undefined : openTools.get(openToolId)
    const openToolMeta = openToolId === undefined ? undefined : openToolAt.get(openToolId)
    if (openTool !== undefined && openToolMeta !== undefined) {
      items.push({
        key: 'live-step',
        type: 'live-step',
        label: openTool.name,
        detail: openToolMeta.connector,
        startedAt: turnStartedAt ?? openToolMeta.at,
        kind: 'item',
        register: openToolMeta.connector === undefined ? 'tool' : 'connector'
      })
    } else if (runningStep !== undefined) {
      items.push({
        key: 'live-step',
        type: 'live-step',
        label: runningStep.label,
        detail: runningStep.detail,
        startedAt: turnStartedAt ?? runningStep.startedAt,
        kind: runningStep.kind,
        register: runningStep.register,
        ...(runningStep.kind === 'reasoning' ? { waiting: true } : {})
      })
    } else if (!streaming && options.awaitingDecision !== true) {
      // Nothing has begun, or the last step closed and the next has not
      // opened. The thread used to draw NOTHING here, so pressing Enter left
      // an empty page until the runtime's first event -- seconds, for a CLI
      // that has to launch a process. Colin reported it twice as the working
      // bounce lagging the send (2026-09-03, 2026-09-04); the bounce was not
      // late, there was no line for it to be on.
      //
      // A live run is always doing something, so a line always shows. What it
      // SAYS stays honest: no step has been reported, so it names the wait
      // rather than inventing a step.
      //
      // The clock runs from the START OF THE TURN, not from the last event.
      // It used to run from the last event, on the reasoning that "waiting 3s"
      // is more useful than "running 4m" -- but a runtime that reports
      // something every few seconds then resets the clock every few seconds,
      // and Colin watched one count to 10 and start over, repeatedly, which
      // reads as a stuck loop rather than a run making progress. A number that
      // only ever climbs cannot be mistaken for one.
      const since = turnStartedAt
      if (since !== undefined) {
        items.push({
          key: 'live-step',
          type: 'live-step',
          label: events.length === 0 ? 'Starting' : 'Working',
          register: events.length === 0 ? ('starting' as const) : ('working' as const),
          detail: undefined,
          startedAt: since,
          kind: 'turn',
          waiting: true,
          // Whether the RUNTIME has said anything, which is not the same as
          // whether the mission has events: 'run.started' is the app's own
          // record of launching the process. Past twenty seconds with none,
          // the line says so -- see quiet.ts for the measured Cursor run
          // that showed 'working' for 128 seconds in silence.
          spoken: events.some((event) => event.type !== 'run.started')
        })
      }
    }
  }

  // A run that ended by asking. Read from the LAST message the provider marked
  // final, because that is where a runtime puts the question it stopped on --
  // and only once the run is over, since a block still streaming may not have
  // its closing tag yet and would parse as nothing or as half a question.
  if (!options.running && options.latestTurn === true) {
    const answer = assistantMessages(events).filter((message) => message.final).at(-1)
    const request = answer === undefined ? undefined : parseDecision(answer.text)
    if (request !== undefined) {
      items.push({ key: `decision_${answer!.itemId}`, type: 'decision', request })
    }
  }

  // A turn that finished and said nothing.
  //
  // MEASURED 2026-09-05, Colin watching a live test: a follow-up on Cursor
  // completed cleanly -- exit 0, tokens spent, reasoning recorded -- and
  // emitted no assistant text at all. The thread drew the person's message,
  // then blank space, and the header said `completed`. That reads as the app
  // losing the answer, or the teammate ignoring you. Neither is what
  // happened, and the record can say which: the runtime thought and then
  // ended the turn without writing a reply.
  //
  // Only for a finished run, and only when there is genuinely nothing to
  // read -- a turn that did work says so through its activity card, and a
  // failure has its own card already.
  if (!options.running && events.some((event) => event.type === 'run.completed')) {
    const saidSomething =
      options.spokeToPeers === true
      || items.some((item) => item.type === 'agent-message' || item.type === 'activity')
    if (!saidSomething) {
      items.push({
        key: 'silent_turn',
        type: 'diagnostic',
        level: 'warning',
        message:
          'This turn ended without a reply: the runtime finished and wrote nothing back. Nothing was changed. Sending it again usually works.'
      })
    }
  }

  return items
}

/**
 * The cancellation summary, derived from events rather than from file
 * bookkeeping the host does not have. The design's card offers KEPT / STOPPED /
 * NOT DONE; only the middle two are knowable here, so "kept" is deliberately
 * described as what the provider reported finishing, and nothing claims a
 * revert is possible.
 */
export interface CancellationSummary {
  readonly settled: readonly string[]
  readonly interrupted: readonly string[]
  readonly neverStarted: number
}

export function cancellationSummary(
  events: readonly NormalizedRuntimeEvent[],
  plannedSteps = 0,
  /** The folder this ran in, so the list reads the way a person writes paths. */
  workspacePath?: string
): CancellationSummary {
  // Through `relativePath`, and deduplicated.
  //
  // MEASURED 2026-09-07 by `_tools/drive-stopped-midedit.mjs`: a stopped run
  // listed FIVE things finished, of which one was the workspace DIRECTORY and
  // two were the same file -- an absolute path and a bare `note-1.txt` -- because
  // one tool named it absolutely and another relatively. The count of what a
  // stopped run finished is the one number on that card a person might act on,
  // and it was inflated by the same file twice.
  //
  // Same fix as the activity fold's, for the same reason: a path is not an
  // identity until the workspace root has had a say.
  const shown = (name: string): string => relativePath(name, workspacePath)
  const key = (name: string): string => shown(name).replace(/[\\/]+/g, '/').toLowerCase()
  const settled: string[] = []
  const seen = new Set<string>()
  const open = new Map<string, string>()
  for (const event of events) {
    if (event.type === 'tool.started') {
      open.set(event.payload.itemId, event.payload.command ?? event.payload.name)
    } else if (event.type === 'tool.completed' || event.type === 'tool.failed') {
      const name = open.get(event.payload.itemId)
      if (name !== undefined) {
        if (!seen.has(key(name))) {
          seen.add(key(name))
          settled.push(shown(name))
        }
        open.delete(event.payload.itemId)
      }
    }
  }
  const interrupted = [...open.values()].map(shown).filter((name) => {
    if (seen.has(key(name))) return false
    seen.add(key(name))
    return true
  })
  const done = settled.length + interrupted.length
  return {
    settled,
    interrupted,
    neverStarted: Math.max(0, plannedSteps - done)
  }
}

/** Colour class for a Signal Rail row, by what the event means. */
export type SignalTone = 'lime' | 'blue' | 'violet' | 'amber' | 'red' | 'muted'

export interface SignalRow {
  readonly key: string
  readonly name: string
  readonly meta: string
  readonly tone: SignalTone
  readonly live: boolean
}

/**
 * A rail row names what happened; it is not the place for the payload. A real
 * shell invocation can be hundreds of characters (a full PowerShell line, an
 * absolute interpreter path), and pasting it whole turns one row into four and
 * pushes everything else off screen.
 */
export function railLabel(value: string, limit = 72): string {
  const single = value.replace(/\s+/g, ' ').trim()
  return single.length <= limit ? single : `${single.slice(0, limit - 1)}…`
}

function clockOf(occurredAt: string): string {
  const parsed = new Date(occurredAt)
  return Number.isFinite(parsed.getTime())
    ? parsed.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : ''
}

/**
 * The Signal Rail: raw events, newest first, in the product's own vocabulary.
 *
 * This is where detail belongs -- the thread shows semantic items, the rail
 * shows what actually happened. Tone carries meaning rather than decoration:
 * tools are lime while running and neutral once settled, checkpoints blue,
 * limits amber, failures red.
 */
export function buildSignalRail(
  events: readonly NormalizedRuntimeEvent[],
  options: { readonly running: boolean }
): readonly SignalRow[] {
  const settled = new Set<string>()
  for (const event of events) {
    if (event.type === 'tool.completed' || event.type === 'tool.failed') settled.add(event.payload.itemId)
  }

  const rows: SignalRow[] = []
  for (const event of events) {
    const clock = clockOf(event.occurredAt)
    switch (event.type) {
      case 'run.started':
        rows.push({
          key: event.id,
          name: `runtime.started · ${event.sourceAdapter}`,
          meta: `${clock} · handshake verified`,
          tone: 'muted',
          live: false
        })
        break
      case 'tool.started': {
        const open = !settled.has(event.payload.itemId)
        rows.push({
          key: event.id,
          name: railLabel(`tool.${event.payload.name} · ${event.payload.command ?? event.payload.toolKind}`),
          meta: `${clock} · ${open ? 'running' : 'started'}`,
          tone: open && options.running ? 'lime' : 'muted',
          live: open && options.running
        })
        break
      }
      case 'tool.completed':
        rows.push({
          key: event.id,
          name: `tool.completed · ${event.payload.name}`,
          meta: `${clock}${event.payload.exitCode === undefined ? '' : ` · exit ${event.payload.exitCode}`}`,
          tone: 'muted',
          live: false
        })
        break
      case 'tool.failed':
        rows.push({
          key: event.id,
          name: `tool.failed · ${event.payload.name}`,
          meta: `${clock} · ${event.payload.status ?? 'failed'}`,
          tone: 'red',
          live: false
        })
        break
      case 'step.started':
      case 'step.completed':
      case 'step.failed':
        rows.push({
          key: event.id,
          name: `${event.type} · ${event.payload.stepKind}`,
          meta: clock,
          tone: event.type === 'step.failed' ? 'red' : 'muted',
          live: false
        })
        break
      case 'plan.updated':
        rows.push({
          key: event.id,
          name: `plan.updated${event.payload.final ? ' · final' : ''}`,
          meta: clock,
          tone: 'violet',
          live: false
        })
        break
      case 'route.limit_detected':
        rows.push({
          key: event.id,
          name: `route.limit_detected · ${event.payload.kind}`,
          meta: railLabel(`${clock} · ${event.payload.message}`, 96),
          tone: 'amber',
          live: false
        })
        break
      case 'adapter.diagnostic':
        rows.push({
          key: event.id,
          name: `adapter.diagnostic · ${event.payload.code}`,
          meta: `${clock} · ${event.payload.level}`,
          tone: event.payload.level === 'error' ? 'red' : 'amber',
          live: false
        })
        break
      case 'run.completed':
        rows.push({ key: event.id, name: 'run.completed', meta: `${clock} · receipt written`, tone: 'blue', live: false })
        break
      case 'run.cancelled':
        rows.push({ key: event.id, name: 'run.cancelled', meta: `${clock} · stopped by you`, tone: 'amber', live: false })
        break
      case 'run.failed':
        rows.push({
          key: event.id,
          name: `run.failed · ${event.payload.kind}`,
          meta: railLabel(`${clock} · ${event.payload.message}`, 96),
          tone: 'red',
          live: false
        })
        break
      default:
        break
    }
  }
  // Newest first, as drawn.
  return rows.reverse()
}

export interface PeerGroup {
  /** The OTHER party: `from` of a received message, `to` of a posted one. */
  readonly peer: { readonly teammateId: string; readonly name: string }
  /** Chronological. */
  readonly messages: readonly PublicPeerMessage[]
  /** True when any message in the group was delivered to this mission. */
  readonly received: boolean
}

/**
 * One card per peer. A group that includes a received message sits at the top
 * of the thread, where it was in time -- delivered before the work began; a
 * group of only posted messages sits after the work that produced them.
 */
export function peerGroups(messages: readonly PublicPeerMessage[]): readonly PeerGroup[] {
  const groups = new Map<string, { peer: PeerGroup['peer']; messages: PublicPeerMessage[]; received: boolean }>()
  for (const message of messages) {
    const peer = message.direction === 'received' ? message.from : message.to
    const key = peer.teammateId.length > 0 ? peer.teammateId : `name:${peer.name}`
    const group = groups.get(key) ?? { peer: { teammateId: peer.teammateId, name: peer.name }, messages: [], received: false }
    group.messages.push(message)
    if (message.direction === 'received') group.received = true
    groups.set(key, group)
  }
  return [...groups.values()].map((group) => ({
    peer: group.peer,
    messages: [...group.messages].sort((left, right) => Date.parse(left.at) - Date.parse(right.at)),
    received: group.received
  }))
}

/**
 * How many messages an exchange may hold and still be drawn open.
 *
 * The card collapses so a colleague's aside does not read as the mission's
 * own work, which is right for a long back-and-forth and wrong for the
 * common case: one teammate asks, one answers. Colin's report on 2026-09-04
 * -- *"lets try and keep the whole convo between the bots"* -- was about an
 * exchange of exactly two messages, both hidden behind a toggle he had to
 * find. Two is an exchange you read in place; more is a thread you open.
 */
export const PEER_EXCHANGE_OPEN_LIMIT = 2

/** Whether an exchange is short enough to read in place. */
export function peerExchangeStartsOpen(messageCount: number): boolean {
  return messageCount > 0 && messageCount <= PEER_EXCHANGE_OPEN_LIMIT
}

/**
 * The first line of an exchange, for the collapsed card to preview. A count
 * alone ("2 messages with Wren") says an exchange happened and nothing about
 * what it was, which is the whole reason it went unread.
 */
export function peerSnippet(text: string | null, limit = 72): string | undefined {
  if (text === null) return undefined
  const flat = text.replace(/\s+/gu, ' ').trim()
  if (flat.length === 0) return undefined
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1).trimEnd()}…`
}

/**
 * What the decision card may honestly say about the workspace.
 *
 * The design's line is "paused, nothing changed". That is a CLAIM, and in a
 * mode that permits edits it is often false -- a run can rewrite four files
 * and then reach the fork it should have asked about first. Saying "nothing
 * changed" there would be a comforting lie in the one place the product is
 * asking to be trusted, so the sentence is derived rather than written:
 *
 *   read-only        the sandbox could not write. A guarantee, not an
 *                    observation, so it is the only case that says "nothing".
 *   edits + evidence a patch came back, so work exists and is kept.
 *   edits + none     nothing was OBSERVED, which is not the same as nothing
 *                    happening -- a runtime need not report every write. So
 *                    it states the permission and claims nothing.
 */
export function decisionStanding(input: {
  readonly sandbox: 'read-only' | 'workspace-write' | 'full-access' | undefined
  readonly events: readonly NormalizedRuntimeEvent[]
}): string {
  if (input.sandbox === 'read-only') return 'stopped here · nothing was changed'
  const wrote = input.events.some(
    (event) =>
      (event.type === 'tool.completed' || event.type === 'tool.failed')
      && (event.payload as { readonly patch?: unknown }).patch !== undefined
  )
  return wrote ? 'stopped here · work already done is kept' : 'stopped here · this run could edit files'
}

export interface ThreadPeerCard {
  readonly key: string
  /** Which turn of the conversation the exchange happened in. */
  readonly turnIndex: number
  /** Received messages sit before that turn's work; posted ones after it. */
  readonly placement: 'before-work' | 'after-work'
  readonly group: PeerGroup
}

/**
 * Every peer card the thread draws, for every turn -- not just the last one.
 *
 * The thread rendered the CURRENT turn's exchange and silently dropped every
 * earlier turn's. That is invisible in the ordinary case and wrong in the one
 * that matters: a teammate who messages a peer usually does it on the turn a
 * person asked them to, and the peer's answer arrives on the NEXT turn. So
 * the message asking was always in an earlier turn and was never drawn. Colin
 * watched Booty ask Wren for a soliloquy on 2026-09-04 and saw only Wren's
 * reply -- the thread read as though Wren had answered HIM.
 *
 * Taking every turn is what makes both halves of an exchange visible. The
 * placement rule is unchanged: what a turn was handed sits above its work,
 * what it sent sits below.
 */
export function threadPeerCards(
  turns: readonly (readonly PublicPeerMessage[])[]
): readonly ThreadPeerCard[] {
  const cards: ThreadPeerCard[] = []
  turns.forEach((messages, turnIndex) => {
    for (const group of peerGroups(messages)) {
      const name = group.peer.teammateId.length > 0 ? group.peer.teammateId : group.peer.name
      cards.push({
        // Turn-scoped: the same peer appears on more than one turn of a
        // conversation, and two cards keyed alike would collapse into one.
        key: `peer_${String(turnIndex)}_${name}`,
        turnIndex,
        placement: group.received ? 'before-work' : 'after-work',
        group
      })
    }
  })
  return cards
}

/**
 * The mission a continuation chain started from. A handed-off mission's own
 * recorded prompt is the briefing the host wrote, so the words a person
 * actually typed live on the FIRST mission of the chain. Bounded walk: a
 * cycle in hand-edited ledgers must not spin forever.
 */
export function rootMission(
  mission: PublicRecoveredMission,
  byId: ReadonlyMap<string, PublicRecoveredMission>
): PublicRecoveredMission {
  let current = mission
  for (let hops = 0; hops < 32; hops += 1) {
    const priorId = current.continuesFrom?.missionId
    if (priorId === undefined) return current
    const prior = byId.get(priorId)
    if (prior === undefined) return current
    current = prior
  }
  return current
}

export interface StitchedHandoff {
  readonly from: PublicRecoveredMission['runtime']
  readonly to: PublicRecoveredMission['runtime']
  readonly at: string | undefined
  readonly unsettledCount: number
  readonly omittedBriefing: readonly string[]
  readonly priorEvents: readonly NormalizedRuntimeEvent[]
}

/**
 * The divider for a recovered continuation, rebuilt from the durable record.
 * The unsettled count is the prior mission's route-switch checkpoint -- the
 * same number the live divider showed -- and not a recount, so a reopened
 * thread says what it said at the time. What the briefing omitted was never
 * recorded, so it is reported as nothing rather than guessed.
 */
export function stitchedHandoff(
  mission: PublicRecoveredMission,
  byId: ReadonlyMap<string, PublicRecoveredMission>
): StitchedHandoff | undefined {
  const link = mission.continuesFrom
  // A follow-up continues the same runtime's own conversation: there is no
  // seam to draw, and a "Codex to Codex" divider across an ordinary reply
  // would invent an event that never happened.
  if (link === undefined || link.reason !== 'route-switch') return undefined
  const prior = byId.get(link.missionId)
  if (prior === undefined) return undefined
  const checkpoint = prior.checkpoints.find((entry) => entry.epoch === link.checkpointEpoch)
  return {
    from: prior.runtime,
    to: mission.runtime,
    at: new Date(mission.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
    unsettledCount: checkpoint?.unsettledActions.length ?? 0,
    omittedBriefing: [],
    priorEvents: prior.events
  }
}

/**
 * What a route's model actually turned out to be, learned from missions that
 * already ran.
 *
 * Claude Code takes an ALIAS -- `fable`, `opus`, `sonnet` -- and resolves it
 * to whichever model is newest in that family, so the shell cannot know the
 * real name up front without asking, and asking costs a turn. It does not
 * have to: the runtime states the resolved model in its own start record, so
 * every finished mission on that alias is a free, current answer. Keyed
 * `runtime:model`, newest mission wins.
 *
 * This is earned knowledge, never a guess: an alias nobody has run yet simply
 * has no entry, and the picker says what it does know instead of inventing a
 * version number that would rot.
 */
export function resolvedModelNames(
  missions: readonly PublicRecoveredMission[]
): ReadonlyMap<string, string> {
  const byRoute = new Map<string, { readonly at: number; readonly name: string }>()
  for (const mission of missions) {
    // The runtime's own word, in either place it says it. Claude Code's
    // START record repeats the alias it was given -- `sonnet` for `sonnet`,
    // which teaches nothing -- and it is the RESULT that states the model
    // the alias turned out to mean. Reading only the start is why the picker
    // showed three bare aliases however many runs a person had done (Colin,
    // 2026-09-06: "in model list they are just listed as sonnet, fable, and
    // opus").
    const settled = mission.events.find((event) => event.type === 'run.completed')
    const resolved =
      settled?.type === 'run.completed' ? settled.payload.resolvedModel : undefined
    const started = mission.events.find((event) => event.type === 'run.started')
    if (resolved === undefined && (started === undefined || started.type !== 'run.started')) continue
    const raw = started?.type === 'run.started' ? started.payload.evidence.raw : undefined
    const fromStart =
      typeof raw === 'object' && raw !== null && !Array.isArray(raw)
        ? (raw as Record<string, unknown>).model
        : undefined
    const name = resolved ?? fromStart
    // Only a real, different name is worth showing: `fable -> fable` teaches
    // nothing, and a blank teaches less.
    if (typeof name !== 'string' || name.length === 0 || name === mission.model) continue
    const key = `${mission.runtime}:${mission.model}`
    const at = Date.parse(mission.createdAt)
    const held = byRoute.get(key)
    if (held === undefined || (Number.isFinite(at) && at > held.at)) {
      byRoute.set(key, { at: Number.isFinite(at) ? at : 0, name })
    }
  }
  return new Map([...byRoute].map(([key, held]) => [key, held.name]))
}

export function resolvedModelKey(runtime: MissionRuntimeId, model: string): string {
  return `${runtime}:${model}`
}

export interface ConversationTurn {
  readonly missionId: string
  /** What the person typed for this turn. */
  readonly prompt: string
  readonly events: readonly NormalizedRuntimeEvent[]
  readonly peerMessages: PublicRecoveredMission['peerMessages']
}

/**
 * A mission and every earlier turn of its conversation, oldest first.
 *
 * Each turn is its own mission -- one mission holds one run, and a second turn
 * is a second process -- so the thread has to walk the `follow-up` links back
 * to rebuild what a person experienced as one exchange. Only follow-ups are
 * walked: a route switch is a different kind of continuation and keeps its
 * divider. Bounded, so a hand-edited cycle cannot spin.
 */
export function conversationTurns(
  mission: PublicRecoveredMission,
  byId: ReadonlyMap<string, PublicRecoveredMission>
): readonly ConversationTurn[] {
  const chain: PublicRecoveredMission[] = [mission]
  let current = mission
  for (let hops = 0; hops < 64; hops += 1) {
    const link = current.continuesFrom
    if (link === undefined || link.reason !== 'follow-up') break
    const prior = byId.get(link.missionId)
    if (prior === undefined || chain.some((held) => held.missionId === prior.missionId)) break
    chain.push(prior)
    current = prior
  }
  return chain
    .reverse()
    .map((turn) => ({
      missionId: turn.missionId,
      prompt: turn.prompt,
      events: turn.events,
      peerMessages: turn.peerMessages
    }))
}

/**
 * The runtime session a reply could resume, if the run left one.
 *
 * A mission that ended is not automatically a conversation you can continue.
 * When a run fails BEFORE its runtime ever started -- the CLI was not ready,
 * the process could not launch -- no session was ever opened, and the host
 * has nothing to resume. Treating the next message as a reply there turns an
 * ordinary sentence into an error card, and the person's message is not sent
 * at all. A fresh mission is what they meant, and what they get.
 *
 * The session id is read from the events the run actually produced, so this
 * cannot claim one that was never recorded.
 */
/**
 * Capacity exhaustion, in whatever words a runtime uses for it. Cursor says
 * `RetriableError: [resource_exhausted]`, which names a real condition in
 * language nobody outside its codebase can read.
 */
const EXHAUSTION_PATTERNS = [
  /\bresource_exhausted\b/i,
  /\binsufficient_quota\b/i,
  /\bquota (?:exceeded|exhausted)\b/i,
  /\brate[_ -]?limit(?:ed| exceeded)?\b/i,
  /\btoo many requests\b/i,
  /\bhttp\s*429\b/i
] as const

/**
 * A runtime that could not write its OWN settings file.
 *
 * Colin, 2026-09-14, 0.119.0, on a peer message between two Cursor
 * teammates -- "this def used to work":
 *
 *   Cursor Agent ended without a terminal result record. The runtime's own
 *   last word was: Error: EPERM: operation not permitted, rename
 *   'C:\Users\...\.cursor\cli-config.json.19620.<uuid>.tmp' ->
 *   'C:\Users\...\.cursor\cli-config.json'
 *
 * Which is two absolute paths, a uuid and a POSIX errno to say something a
 * person could act on in one sentence. `cursor-agent` rewrites that file on
 * startup by writing a temp beside it and renaming over the top, and on
 * WINDOWS that rename fails with EPERM while another process still has the
 * destination open. Asking one teammate to ask another starts a second
 * `cursor-agent` while the first is live, so the room features are exactly
 * what provokes it. There were thirteen abandoned `.tmp` files beside that
 * config dating back to 2026-09-02, so it is intermittent and old, not new.
 *
 * This is NOT Locust's file and not the person's workspace -- it is the
 * runtime's own config in their home folder -- and that is the fact the
 * sentence has to carry, because "operation not permitted" reads like a
 * permissions problem with THEIR project.
 *
 * Deliberately says nothing about whether the workspace was touched. The run
 * died somewhere and this cannot know where; a reassuring second clause that
 * turns out to be wrong is worse than the bare sentence it replaced.
 */
const CONFIG_LOCKED_PATTERNS = [/\bEPERM\b/i, /\boperation not permitted\b/i] as const

/** The runtime's own settings file, as each CLI names it on disk. */
const RUNTIME_CONFIG_FILES = ['cli-config.json', 'config.json', 'settings.json', 'auth.json'] as const

function isLockedRuntimeConfig(said: string): boolean {
  if (!said.toLowerCase().includes('rename')) return false
  if (!CONFIG_LOCKED_PATTERNS.some((pattern) => pattern.test(said))) return false
  return RUNTIME_CONFIG_FILES.some((name) => said.includes(name))
}

/**
 * Terminal colour codes, stripped.
 *
 * A runtime writes stderr for a terminal, so its own last word arrives
 * wrapped in escape sequences -- and this card is not a terminal. Colin,
 * 2026-09-05: OpenCode's refusal reached the screen as three boxes before
 * the sentence a person needs to read, because ESC[93m ESC[1m ESC[0m have
 * no glyphs. The codes carry no meaning here; the card has its own colour.
 *
 * Built from the character code rather than a literal escape, which is
 * invisible in a diff and easy to break silently.
 */
const ANSI = new RegExp(String.fromCharCode(27) + '\[[0-9;?]*[ -/]*[@-~]', 'g')

/** The last line of stderr that says something, or undefined. */
function lastStderrLine(stderr: string | undefined): string | undefined {
  if (stderr === undefined) return undefined
  const lines = stderr
    .replace(ANSI, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  return lines.at(-1)
}

/**
 * What to put on a failure card.
 *
 * The host's own sentence names the SHAPE of the failure ("Codex invocation
 * did not complete successfully", "Cursor Agent ended without a terminal
 * result record") and never its cause. The cause is in the process's stderr,
 * which the ledger has been recording all along and the card was throwing
 * away: two runs Colin lost on 2026-09-03 were a folder Codex would not run
 * in and a Cursor account out of capacity, and both read on screen as the
 * same shrug. So the runtime's own last word is always shown, and the one
 * condition whose wording is pure jargon is said in English instead.
 */
export function failureMessage(payload: {
  readonly message: string
  readonly process?: { readonly stderr?: string; readonly exitCode?: number | null }
}): string {
  const said = lastStderrLine(payload.process?.stderr)
  if (said === undefined) return payload.message
  if (EXHAUSTION_PATTERNS.some((pattern) => pattern.test(said))) {
    return `${payload.message} The runtime reported that it is out of capacity right now — its own limit, not this machine's: ${said}`
  }
  if (isLockedRuntimeConfig(said)) {
    return `${payload.message} It could not save its own settings file, which another run of the same runtime had open — that file is the runtime's own, in your home folder, and nothing in this workspace was denied to it. Starting the run again usually works.`
  }
  return `${payload.message} The runtime's own last word was: ${said}`
}

/**
 * Two messages that say the same thing, allowing for the trim and the
 * trailing period one channel adds and another does not.
 */
export function sameSentence(a: string, b: string): boolean {
  const norm = (text: string): string => text.trim().replace(/\.\s*$/, '').toLowerCase()
  const left = norm(a)
  const right = norm(b)
  return left.length > 0 && (left === right || left.includes(right) || right.includes(left))
}

/**
 * Whether the run-level error card would only repeat a limit card already in
 * the thread. The run's error is the runtime's own last word wrapped in the
 * host's sentence, and for a quota failure that word is the limit message --
 * so the bottom card was the third rendering of one fact (user session 1,
 * 2026-09-05). Only a limit that ENDS the run counts: a slow-down warning is
 * not why a run failed, and its presence must not hide the real reason.
 */
export function errorAlreadyShown(items: readonly ThreadItem[], error: string): boolean {
  return items.some(
    (item) => item.type === 'limit' && item.kind === 'quota-exhausted' && sameSentence(error, item.message)
  )
}

export function resumableSessionOf(
  events: readonly NormalizedRuntimeEvent[]
): string | undefined {
  for (const event of events) {
    const held = (event as { readonly runtimeThreadId?: unknown }).runtimeThreadId
    if (typeof held === 'string' && held.length > 0) return held
  }
  return undefined
}

/**
 * The words a PERSON typed for this turn.
 *
 * A mission's own prompt is not always something anybody wrote. A route
 * switch starts a new mission whose prompt is the host's briefing, so for
 * that one the typed words are the previous mission's. A follow-up is the
 * opposite: its prompt IS what the person just typed, and reaching past it to
 * the start of the conversation shows them the wrong sentence -- the reply
 * they actually sent appears nowhere, and the opening line appears twice.
 *
 * So this walks back through route switches only, and stops at the first
 * mission whose prompt was written by a person.
 */
/**
 * The person's own next words inside a handoff briefing, if it carries any.
 *
 * A route switch is usually a rescue -- nobody typed anything, and the walk
 * back below is what finds the words that started the conversation. But a
 * handoff can also be a REPLY, and `main/handoff.ts` puts those words in a
 * section of their own, last, under this exact sentence. Walking past it
 * showed the person the task they opened with and never the instruction the
 * run was actually started for (0.35.0 targeted QA).
 *
 * Matched on the host's own string, which this app writes and owns -- not on
 * something a runtime said. It is still a seam: the honest home for this is a
 * field on `continuesFrom`, which needs a ledger version, and until that
 * exists a mission recorded before it would have nothing to read anyway.
 */
export const HANDOFF_INSTRUCTION_MARKER = 'The person now asks:'

/**
 * The host writes the marker as a section of its own: a blank line, the
 * sentence, then a blank line, then the words. Matching the bare sentence
 * anywhere in any prompt found it inside a person's OWN typing -- someone
 * working on this very file typed `Rename the string "The person now asks:"
 * in handoff.ts` and the mission was titled `" in handoff.ts`, and a rescue
 * briefing that QUOTES the original task matched inside the quote and showed
 * the briefing as the person's words (QA, 2026-09-06).
 *
 * So the anchor is the section shape, not the sentence, and it is only ever
 * looked for in a continuation the host actually wrote.
 */
const HANDOFF_INSTRUCTION_SECTION = `\n\n${HANDOFF_INSTRUCTION_MARKER}\n\n`

export function handoffInstruction(prompt: string): string | undefined {
  const at = prompt.lastIndexOf(HANDOFF_INSTRUCTION_SECTION)
  if (at === -1) return undefined
  const asked = prompt.slice(at + HANDOFF_INSTRUCTION_SECTION.length).trim()
  return asked.length === 0 ? undefined : asked
}

export function typedPrompt(
  mission: PublicRecoveredMission,
  byId: ReadonlyMap<string, PublicRecoveredMission>
): string {
  let current = mission
  for (let hops = 0; hops < 32; hops += 1) {
    const relayed = relayedTitle(current)
    if (relayed !== undefined) return relayed
    // Only where the host wrote the prompt. A mission a PERSON typed is their
    // words already, whatever sentences it happens to contain.
    if (current.continuesFrom?.reason !== 'route-switch') return current.prompt
    const asked = handoffInstruction(current.prompt)
    if (asked !== undefined) return asked
    const prior = byId.get(current.continuesFrom.missionId)
    if (prior === undefined) return current.prompt
    current = prior
  }
  return current.prompt
}

/**
 * What to call a run the host started for one teammate to answer another.
 *
 * Its `prompt` is a briefing written to a runtime -- *"Wren (Code & Migrations)
 * sent you a message; it is quoted below... end with one <locust-share>
 * block"* -- and that sentence was appearing as the NAME of a mission in the
 * list, beside conversations a person had actually started. Colin, 2026-09-04:
 * *"missions are like projects or whole new conversations."*
 *
 * The message that caused the run is the readable thing, and the ledger holds
 * it, so the title says who wrote and what they said. Undefined when a person
 * started the run, and undefined when the host started one but the workroom no
 * longer holds the message -- because inventing a title is worse than showing
 * the briefing, which is at least true.
 */
/**
 * The line drawn above a turn's work, or nothing.
 *
 * The thread's own rule, written when handoffs were built: a run the HOST
 * briefed must never be drawn as a person's bubble, because that attributes
 * to them something they never said. A relayed run broke that rule --
 * Colin, 2026-09-05, screenshot: the whole machine briefing ("...end with one
 * <locust-share to="Wren"> block... Do not use a <locust-ask> block here...")
 * sat in the thread as the most prominent text on screen, in the place a
 * person's message goes.
 *
 * A person's words are drawn as they were typed. A host-briefed turn is drawn
 * by the message that caused it, when the record still holds that message,
 * and otherwise not at all -- the peer card beside it already says who wrote
 * to whom, so silence here loses nothing and inventing a sentence would.
 */
/**
 * The run a peer message was DELIVERED into, so a person reading one side of
 * an exchange can open the other.
 *
 * Colin's third point on 2026-09-04, the one still unbuilt: a teammate's
 * relayed run is filed under that teammate with a readable title, but the
 * thread that asked has no way to reach it -- you go looking in the sidebar.
 * The link is already in the record: the same `messageId` appears as
 * `posted` on the run that wrote it and as `received` on the run it was
 * quoted into.
 *
 * Undefined when nothing received it, which is a real state and not an
 * error: the message may still be waiting for that teammate's next run.
 */
export function peerRunFor(
  messageId: string,
  missions: readonly PublicRecoveredMission[]
): PublicRecoveredMission | undefined {
  if (messageId.length === 0) return undefined
  return missions.find((mission) =>
    mission.peerMessages.some((message) => message.messageId === messageId && message.direction === 'received')
  )
}

/**
 * Who started a run, as the window knows it: the ledger's own kinds plus a
 * person's post to a room, which the ledger does not record (a room post's
 * missions are ordinary missions of their teammates; the room remembers
 * which).
 */
export type LiveStarter =
  | PublicRecoveredMission['startedBy']
  | { readonly kind: 'room'; readonly roomId: string; readonly postId: string }

export function turnPromptLine(turn: {
  readonly prompt: string
  readonly startedBy?: LiveStarter
  readonly peerMessages?: readonly PublicPeerMessage[]
}): string | undefined {
  // Attached files are named for the RUNTIME, in a line the host writes above
  // the message. It was reaching the person too -- their own bubble opened
  // "Read this file in the workspace before you answer: - NOTES.md", words
  // they never typed, in the style that says they said them. The files are
  // still shown, as rows under the bubble; this is only about whose voice
  // the sentence is in.
  if (turn.startedBy === undefined) return splitAttachments(turn.prompt).text
  // A routine step is the person's own words, saved from a conversation they
  // had; it is theirs to see, even though the host pressed go. A room post
  // is the person's own words too, said to several at once.
  if (turn.startedBy.kind === 'routine' || turn.startedBy.kind === 'room') {
    return splitAttachments(turn.prompt).text
  }
  // A relayed turn's prompt IS the message that started it, and the thread
  // already draws that message as a peer card, in time, before the work. The
  // bubble therefore repeated a teammate's words verbatim -- and drew them in
  // the person's own bubble style, which reads as the person having said it
  // (Colin, 2026-09-06). The card is the better of the two: it names who sent
  // it and opens their run. So the bubble stands down whenever the card is
  // there, and only speaks when it would otherwise be the sole account of what
  // started the turn.
  const relayed = relayedTitle({ startedBy: turn.startedBy, peerMessages: turn.peerMessages ?? [] })
  const drawnAsACard = (turn.peerMessages ?? []).some((message) => message.direction === 'received')
  return drawnAsACard ? undefined : relayed
}

/**
 * The files a turn was sent with, recovered from its prompt.
 *
 * Only for a turn the person started: a relayed or handed-off turn's prompt is
 * machine-written and nothing attached files to it.
 */
/**
 * How many lines of command output a row draws before it elides the middle.
 *
 * Eight and eight. It was 200 in a box 320px tall that scrolled inside a
 * thread that also scrolls, which put a 300px black rectangle showing "1"
 * through "19" above the two lines the teammate actually said -- stdout drawn
 * louder than the person's collaborator talking (design, 2026-09-08).
 *
 * Eight each end is "enough to see a command worked, and enough to see how it
 * failed": a vitest failure puts the assertion, the file and the counts in its
 * last six lines. Anything more is asked for, and asking for it prints ALL of
 * it rather than more of a bounded window.
 */
export const SHELL_OUTPUT_HEAD_LINES = 8
export const SHELL_OUTPUT_TAIL_LINES = 8
export const MAX_SHELL_OUTPUT_LINES = SHELL_OUTPUT_HEAD_LINES + SHELL_OUTPUT_TAIL_LINES

/**
 * Command output split for the screen, keeping BOTH ends.
 *
 * The same rule `boundedMessageText` follows and for the same reason: the
 * interesting part of a long output is as often the last line as the first --
 * an error, an exit summary, the answer -- and a head-only cut throws exactly
 * that away. `seq 1 1200` is the cheerful case; `npm install` ending in a
 * permission error is the one that matters.
 *
 * Head and tail are returned SEPARATELY rather than joined around a sentence,
 * because the elision is a control now: a button between the halves that
 * prints everything, the same pattern the diff's folded context already uses.
 * A sentence in the middle of a `pre` cannot be pressed.
 */
export function boundedShellOutput(output: string): {
  readonly head: string
  readonly tail: string
  readonly omitted: number
  readonly total: number
  /** Kept for callers that want one block: head, a marker line, tail. */
  readonly text: string
} {
  // Trailing whitespace goes first. Almost every command ends with a newline,
  // and keeping it made the last visible line BLANK -- which quietly undercuts
  // the one promise this function makes. Driven on a real `seq 1 300`: the
  // tail read as an empty line rather than `300`.
  const trimmed = output.replace(/\s+$/, '')
  const lines = trimmed.split('\n')
  if (lines.length <= MAX_SHELL_OUTPUT_LINES) {
    return { head: trimmed, tail: '', omitted: 0, total: lines.length, text: trimmed }
  }
  const omitted = lines.length - SHELL_OUTPUT_HEAD_LINES - SHELL_OUTPUT_TAIL_LINES
  const head = lines.slice(0, SHELL_OUTPUT_HEAD_LINES).join('\n')
  const tail = lines.slice(-SHELL_OUTPUT_TAIL_LINES).join('\n')
  return {
    head,
    tail,
    omitted,
    total: lines.length,
    text: `${head}\n… ${String(omitted)} more lines …\n${tail}`
  }
}

export function turnAttachments(turn: {
  readonly prompt: string
  readonly startedBy?: LiveStarter
}): readonly string[] {
  if (turn.startedBy !== undefined && turn.startedBy.kind !== 'routine' && turn.startedBy.kind !== 'room') {
    return []
  }
  return splitAttachments(turn.prompt).attachments
}

export function relayedTitle(mission: {
  readonly startedBy?: LiveStarter
  readonly peerMessages: PublicRecoveredMission['peerMessages']
}): string | undefined {
  if (mission.startedBy?.kind !== 'relay') return undefined
  const asked = mission.peerMessages.find((message) => message.direction === 'received')
  if (asked === undefined || asked.text === null) return undefined
  const said = asked.text.replace(/\s+/gu, ' ').trim()
  if (said.length === 0) return undefined
  return `${asked.from.name} asked: ${said}`
}

/**
 * The routes this person has actually run, newest first, as `runtime:model`.
 *
 * The picker puts these at the top. It is a claim the app can back -- these
 * missions are in the ledger -- where "popular" or "recommended" would be a
 * judgement nothing here measured. A model whose id encodes an effort is
 * counted under the id that ran, which is the one they would pick again.
 */
export function recentlyUsedRoutes(
  missions: readonly PublicRecoveredMission[]
): readonly string[] {
  const seen = new Map<string, number>()
  for (const mission of missions) {
    const key = `${mission.runtime}:${mission.model}`
    const at = Date.parse(mission.lastUpdatedAt)
    const stamp = Number.isFinite(at) ? at : 0
    const held = seen.get(key)
    if (held === undefined || stamp > held) seen.set(key, stamp)
  }
  return [...seen.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([key]) => key)
}

/**
 * The files a mission produced, for the Inspector's Artifacts tab.
 *
 * That tab has said "artifacts appear once a run can write" since it was
 * built, and then showed nothing on runs that wrote plenty -- a promise the
 * app never kept, found by dogfooding (Colin, 2026-09-07, and again in his own
 * report: "No file listing, download trigger, or artifact delivery logic is
 * attached to this tab yet"). What was missing was not the idea, it was this
 * list.
 *
 * The rows are derived from the SAME entries the activity fold counts, through
 * the same `relativePath` key, so the tab and the fold cannot report different
 * files for one run -- the failure mode that produced `2 files` over a one-line
 * change and is worth not repeating in a second place.
 *
 * Failed edits are left out. A tool that reported a failure did not produce an
 * artifact, and a list that offered to show someone a file that was never
 * written would be worse than an empty tab.
 */
export function producedFiles(
  details: readonly ActivityDetail[],
  workspacePath: string | undefined
): readonly { readonly path: string; readonly shown: string; readonly status: string | undefined }[] {
  const entries = activityEntries(details, workspacePath)
  const key = (path: string): string =>
    // No separator normalising here: `relativePath` already collapsed both
    // kinds to `/`. This step used to repeat it, with the same one-backslash
    // -short class as the flattener above -- which cost nothing, because
    // there was nothing left for it to do. Removed rather than fixed.
    relativePath(path, workspacePath).replace(/^\.\//, '').toLowerCase()
  const seen = new Set<string>()
  const rows: { path: string; shown: string; status: string | undefined }[] = []
  for (const entry of entries) {
    const path = entry.kind === 'file' ? entry.file.path : entry.kind === 'unreported' && entry.failed !== true ? entry.name : undefined
    if (path === undefined) continue
    const id = key(path)
    if (seen.has(id)) continue
    seen.add(id)
    rows.push({
      path,
      shown: relativePath(path, workspacePath),
      status: entry.kind === 'file' ? entry.file.status : undefined
    })
  }
  return rows
}

/**
 * When a mission last DID something, rather than when it started.
 *
 * grok-build keeps `last_progress_at` and documents it as the dashboard's
 * sort key. Sorting by start time puts a conversation that has been working
 * for an hour below one that opened five minutes ago and has been idle since
 * -- the list claims to show what is happening and shows what began most
 * recently instead.
 *
 * The last event's own timestamp, falling back to when the mission was made
 * for one that has no events yet. Never the clock: a list that reorders
 * itself because time passed would move under the reader.
 */
export function lastActivityAt(mission: {
  readonly createdAt: string
  readonly events: readonly NormalizedRuntimeEvent[]
}): string {
  const last = mission.events.at(-1)?.occurredAt
  return last !== undefined && last > mission.createdAt ? last : mission.createdAt
}

/**
 * Whether this run died before its runtime did anything at all.
 *
 * The precondition for offering to run it again. A run that never emitted
 * `run.started` never opened a session, never called a tool and never
 * touched the workspace -- so starting it again cannot repeat anything,
 * because there is nothing to repeat. Any run that DID start is excluded,
 * however early it failed: at that point the honest answer is the person's,
 * not the app's, because only they know whether the half it did matters.
 *
 * Measured 2026-09-14: `cursor-agent` rewrites its own config on startup and
 * on Windows that rename fails with EPERM while a second copy of it holds
 * the file. The mission ledger for one of these holds exactly two records --
 * `mission.created` and `run.failed` -- and nothing else. That is the shape
 * this recognises. Colin hit it, and the only way forward was to retype the
 * message, which is a chore the app can spare him without guessing.
 */
export function runtimeNeverStarted(events: readonly NormalizedRuntimeEvent[]): boolean {
  return !events.some((event) => event.type === 'run.started')
}
