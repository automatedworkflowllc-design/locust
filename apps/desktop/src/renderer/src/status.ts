import { faceLabel, teammateActivity } from './faceState.js'
import type { FaceActivity, LiveActivity } from './faceState.js'
import type { MissionMode, PublicRecoveredMission, PublicRuntimeStatus } from '../../shared/ipc.js'
import type { MissionRuntimeId } from '@teammate/runtime-adapters'

/**
 * Every status word the shell shows, derived from discovery and mission state
 * and from nothing else.
 *
 * This module exists because the product's whole claim is that you can always
 * tell which runtime and model are really in play. A label that can drift from
 * what discovery proved -- a hard-coded `LIVE`, an optimistic default, a chip
 * that survives a failed probe -- turns that claim into decoration. So the
 * labels are pure functions with tests, and the tests are mutation-checked.
 *
 * The load-bearing invariant, stated once: **nothing renders as LIVE or READY
 * unless discovery reported the runtime ready.** Everything else here is
 * presentation.
 */

/** Route-picker and settings status tags, in the design's vocabulary. */
export type RouteTag =
  | 'ACTIVE'
  | 'READY'
  | 'PREVIEW'
  | 'SIGN IN'
  | 'UNAVAILABLE'
  | 'API'
  | 'LOCAL'
  | 'PLANNED'
  | 'EXPERIMENTAL'

/** How far a runtime's integration actually goes in this build. */
export type IntegrationLevel =
  /** Can own a live mission end to end today. */
  | 'live'
  /** Discovered and selectable, but the adapter is not finished. */
  | 'preview'
  /**
   * Runs a mission end to end, but through a reverse-engineered surface
   * that its vendor did not publish and may change without notice. Said on
   * the row, so nobody mistakes it for a supported route.
   */
  | 'experimental'
  /** Drawn in the design, not implemented at all. */
  | 'planned'

/**
 * How far each integration actually goes, in ONE place.
 *
 * This lived in three files -- the route picker, Settings and the first-launch
 * panel -- and drifted the moment a runtime was added. On 2026-09-02 the same
 * screen showed Cursor Agent as READY in Settings and PLANNED in the welcome
 * panel, which is precisely the "you can always tell what is really in play"
 * claim failing at the only moment a newcomer looks. A new runtime is now one
 * edit, not three.
 */
export const RUNTIME_INTEGRATION: Readonly<Record<string, IntegrationLevel>> = {
  codex: 'live',
  claude: 'live',
  cursor: 'live',
  opencode: 'live',
  copilot: 'live',
  antigravity: 'experimental',
  gemini: 'planned',
  omniroute: 'planned'
}

/** What a runtime this build does not know should be treated as. */
export function integrationOf(runtimeId: string): IntegrationLevel {
  return RUNTIME_INTEGRATION[runtimeId] ?? 'planned'
}

export interface RouteRowStatus {
  readonly tag: RouteTag
  /** Whether the row may be chosen as the active route right now. */
  readonly selectable: boolean
  /** Sentence shown under the row. Always says why, never just what. */
  readonly detail: string
}

/**
 * The one function that may say a runtime is usable. `ready` comes from a
 * probe that actually ran; `status` distinguishes why a runtime is not.
 */
export function runtimeIsUsable(runtime: PublicRuntimeStatus): boolean {
  return runtime.ready && runtime.status === 'ready'
}

/**
 * The tag a route row wears, given what discovery proved and whether this is
 * the row the composer is set to.
 *
 * ACTIVE is drawn in the same lime as READY and reads as a stronger claim, so
 * it may only sit on a row that could actually run. A fresh install defaults
 * the route to Codex; before this, that row wore a lime ACTIVE tag directly
 * above the sentence "Codex CLI was not found on this machine."
 */
export function routeRowTag(status: RouteRowStatus, isActive: boolean): RouteTag {
  return isActive && status.selectable ? 'ACTIVE' : status.tag
}

export function routeRowStatus(
  runtime: PublicRuntimeStatus,
  integration: IntegrationLevel,
  isActive: boolean
): RouteRowStatus {
  if (integration === 'planned') {
    return {
      tag: 'PLANNED',
      selectable: false,
      detail: 'Not built yet. Shown so the roadmap is visible, not because it works.'
    }
  }
  if (!runtime.installed) {
    return {
      tag: 'UNAVAILABLE',
      selectable: false,
      detail: `${runtime.displayName} was not found on this machine.`
    }
  }
  if (runtime.status === 'auth-required' || runtime.auth === 'unauthenticated') {
    return {
      tag: 'SIGN IN',
      selectable: false,
      detail: `Installed, but ${runtime.displayName} is not signed in.`
    }
  }
  if (!runtimeIsUsable(runtime)) {
    const reason =
      runtime.status === 'offline'
        ? 'could not be reached'
        : runtime.status === 'probe-failed'
          ? 'did not answer its version probe'
          : 'is not ready'
    return {
      tag: 'UNAVAILABLE',
      selectable: false,
      detail: `${runtime.displayName} ${reason}.`
    }
  }
  // Ready, and real, but on a surface nobody promised: selectable, and said.
  if (integration === 'experimental') {
    return {
      tag: 'EXPERIMENTAL',
      selectable: true,
      detail: `${runtime.displayName} is driven through an unpublished interface of the running app. It works today and may break with an update.`
    }
  }
  // Ready, and the adapter is only partly built: selectable, never called live.
  if (integration === 'preview') {
    return {
      tag: 'PREVIEW',
      selectable: true,
      detail: `Signed in and detected. The ${runtime.displayName} adapter is not finished, so runs are not durable yet.`
    }
  }
  return {
    tag: isActive ? 'ACTIVE' : 'READY',
    selectable: true,
    detail: 'Signed in on this machine, using your own account.'
  }
}

/**
 * Count for the sidebar's "N connected" line.
 *
 * TWO truths have to agree before a runtime may be counted. `runtimeIsUsable`
 * says discovery found the CLI installed and signed in. `integrationOf` says
 * how far THIS build's support for it goes. A runtime can satisfy the first
 * and not the second -- Gemini CLI probes at 0.58.0 and reports itself signed
 * in, while the same screen says "Not built yet. Shown so the roadmap is
 * visible, not because it works."
 *
 * **This is a guard, not a repair, and the difference is worth recording.** It
 * was written on 2026-09-05 while chasing what looked like a miscount -- the
 * footer said 6 where a probe counted 5 -- and the app turned out to be right:
 * the sixth was Antigravity, whose adapter is EXPERIMENTAL and does complete
 * missions, and the probe had been counting the literal word READY. No
 * miscount has ever been observed. What remains true is that nothing here
 * previously stopped a discovered-but-unbuilt runtime from being counted, and
 * `integrationOf` is the one place that knows the difference.
 *
 * Counted through `integrationOf` rather than a second list, for the reason
 * that map exists: a runtime this build does not know is `planned`, so a new
 * one cannot start being counted before anybody has written its adapter.
 */
export function connectedRuntimeCount(runtimes: readonly PublicRuntimeStatus[]): number {
  return runtimes.filter((runtime) => runtimeIsUsable(runtime) && integrationOf(runtime.id) !== 'planned')
    .length
}

/** Sidebar / roster status vocabulary from the design. */
export type TeammateStatus = 'working' | 'approval-needed' | 'idle' | 'blocked'

export interface TeammateStatusView {
  readonly status: TeammateStatus
  /** What their face does, decided here so every surface draws the same thing. */
  readonly activity: FaceActivity
  readonly label: string
  /** Semantic token name, never a literal color. */
  readonly tone: 'lime' | 'amber' | 'muted' | 'red'
  readonly pulse: boolean
}

export function teammateStatusView(input: {
  /**
   * The runtime this teammate's own work is on, when they have any. A
   * teammate with no missions has no runtime of their own, and judging every
   * teammate against one hard-coded runtime told people their teammate needed
   * a sign-in while she was visibly working on another one.
   */
  readonly runtime: PublicRuntimeStatus | undefined
  /** Whether ANY runtime could take work right now. */
  readonly anyRuntimeUsable?: boolean
  readonly hasRunningMission: boolean
  readonly pendingApprovals: number
  readonly roleLabel: string
  /** What their live run is doing right now; `idle` when there is none. */
  readonly liveActivity?: LiveActivity
  readonly recentlyDone?: boolean
  readonly recentlyReceived?: boolean
}): TeammateStatusView {
  const activity = teammateActivity({
    blocked: input.anyRuntimeUsable === false || (input.runtime !== undefined && !runtimeIsUsable(input.runtime)),
    waitingOnYou: input.pendingApprovals > 0,
    live: input.hasRunningMission ? (input.liveActivity ?? 'working') : 'idle',
    recentlyDone: input.recentlyDone === true,
    recentlyReceived: input.recentlyReceived === true
  })
  // Nobody can work when nothing is signed in, whatever this teammate has
  // done before.
  if (input.anyRuntimeUsable === false) {
    return { status: 'blocked', activity, label: 'Runtime sign-in required', tone: 'red', pulse: false }
  }
  // A teammate whose OWN runtime cannot run is blocked, even if a mission
  // looks active in the renderer -- the sign-in wall outranks optimistic
  // local state. One with no runtime of their own is simply idle.
  if (input.runtime !== undefined && !runtimeIsUsable(input.runtime)) {
    return {
      status: 'blocked',
      activity,
      label: 'Runtime sign-in required',
      tone: 'red',
      pulse: false
    }
  }
  if (input.pendingApprovals > 0) {
    return { status: 'approval-needed', activity, label: `${input.roleLabel} · ${faceLabel(activity)}`, tone: 'amber', pulse: false }
  }
  // Copy follows state: the word beside the face is the face's own word.
  if (input.hasRunningMission) {
    return { status: 'working', activity, label: `${input.roleLabel} · ${faceLabel(activity)}`, tone: 'lime', pulse: true }
  }
  return { status: 'idle', activity, label: `${input.roleLabel} · ${faceLabel(activity)}`, tone: 'muted', pulse: false }
}

export interface MissionPhaseView {
  readonly label: string
  readonly tone: 'lime' | 'blue' | 'amber' | 'red' | 'muted'
  /** Uppercase tag for the missions table. */
  readonly tag: string
}

export function missionPhaseView(
  phase: PublicRecoveredMission['phase'] | 'running',
  hasIntegrityIssues = false
): MissionPhaseView {
  if (phase === 'running') return { label: 'Running', tone: 'lime', tag: 'RUNNING' }
  if (phase === 'interrupted') {
    return { label: 'Interrupted', tone: 'red', tag: 'INTERRUPTED' }
  }
  if (phase === 'failed') return { label: 'Failed', tone: 'red', tag: 'FAILED' }
  if (phase === 'cancelled') return { label: 'Cancelled', tone: 'muted', tag: 'CANCELLED' }
  // Completed, but the ledger could not be read to its end: the run finished
  // and its record did not, and the design's receipt card must not print
  // `verified` over that.
  if (hasIntegrityIssues) {
    return { label: 'Completed · receipt incomplete', tone: 'amber', tag: 'COMPLETED' }
  }
  return { label: 'Completed', tone: 'blue', tag: 'COMPLETED' }
}

/**
 * The word the receipt card prints against the ledger path. `verified` is a
 * claim about durability, so it requires zero integrity issues -- not merely
 * that a mission was recovered.
 */
export function ledgerVerificationLabel(integrityIssueCount: number): 'verified' | 'incomplete' {
  return integrityIssueCount === 0 ? 'verified' : 'incomplete'
}

/** Short mission id for mono provenance: real UUID prefix, never a fake counter. */
export function shortMissionId(missionId: string): string {
  const bare = missionId.startsWith('mission_') ? missionId.slice('mission_'.length) : missionId
  return bare.slice(0, 8)
}

/** Checkpoint display id. Epochs are 1-based in the ledger. */
export function checkpointLabel(epoch: number): string {
  return `ck_${epoch}`
}

/**
 * Whether the route control can hand the running mission to another runtime.
 *
 * A handoff is addressed by runId, and there is a real window -- between the
 * user submitting and the host's receipt coming back -- where a mission is
 * visibly running but has no id yet. A control offered in that window looks
 * available and silently does nothing, which is the exact failure this shell
 * refuses everywhere else. So the state is named, and the control says why.
 *
 * `switching` is a handoff already in flight: a second one would race the
 * first, and the first is irreversible.
 */
export type HandoffAvailability = 'idle' | 'starting' | 'available' | 'switching'

export function handoffAvailability(
  running: boolean,
  hasRunId: boolean,
  switching: boolean
): HandoffAvailability {
  if (switching) return 'switching'
  if (!running) return 'idle'
  return hasRunId ? 'available' : 'starting'
}

/** What the route control says about itself. `undefined` where a title adds nothing. */
export function handoffTitle(availability: HandoffAvailability): string | undefined {
  if (availability === 'available') return 'Hand this mission to another runtime'
  if (availability === 'starting') return 'Waiting for the mission to start before it can be handed over'
  if (availability === 'switching') return 'Handing this mission over'
  return undefined
}

/**
 * A face moves only while its teammate is doing something. Everything else --
 * idle, waiting on an approval, blocked -- is still, and says so through the
 * presence dot and the label instead.
 */
export function facePresenceFor(status: TeammateStatus): 'working' | 'approval' | 'blocked' | 'none' {
  if (status === 'working') return 'working'
  if (status === 'approval-needed') return 'approval'
  if (status === 'blocked') return 'blocked'
  return 'none'
}

/**
 * How many rows of one runtime's models the picker shows before it stops and
 * says how many more there are.
 *
 * A route group is usually a handful of rows. One runtime here lists 217, and
 * an unannounced wall of them buries every other runtime below it -- the list
 * scrolls, so the rows underneath are not visibly there at all. The cap is a
 * presentation choice and must never read as "this is all there is", so what
 * it holds back is COUNTED and stated, and typing in the picker's search
 * lifts it entirely.
 */
export const ROUTE_GROUP_LIMIT = 6

export interface CappedRouteRows<TRow> {
  readonly rows: readonly TRow[]
  /** Rows held back per group, by group name. A group at the cap is absent. */
  readonly hiddenByGroup: ReadonlyMap<string, number>
}

/**
 * Cap each group to `limit` rows, keeping the order they arrived in.
 *
 * Two rules make the cap safe to show:
 * - The ACTIVE row is always kept, even when it sits below the cut. A picker
 *   that hides the route you are on cannot be read as a picker at all.
 * - Nothing is dropped silently: every group over the cap reports how many
 *   rows it is not showing, and the caller must say so.
 *
 * While a search is running there is no cap: the person has narrowed the list
 * themselves, and a second, invisible narrowing on top of theirs would make
 * the result a lie about what matched.
 */
export function capRouteRows<TRow extends { readonly group: string; readonly tag: RouteTag }>(
  rows: readonly TRow[],
  limit: number,
  searching: boolean
): CappedRouteRows<TRow> {
  if (searching) return { rows, hiddenByGroup: new Map() }
  const counts = new Map<string, number>()
  const kept: TRow[] = []
  const hidden = new Map<string, number>()
  for (const row of rows) {
    const seen = counts.get(row.group) ?? 0
    counts.set(row.group, seen + 1)
    if (seen < limit) {
      kept.push(row)
      continue
    }
    // Below the cut. The active row displaces the last kept row of its group
    // rather than being hidden, so the count shown stays exactly `limit`.
    if (row.tag === 'ACTIVE') {
      const last = kept.map((entry) => entry.group).lastIndexOf(row.group)
      if (last >= 0) {
        kept.splice(last, 1, row)
        hidden.set(row.group, (hidden.get(row.group) ?? 0) + 1)
        continue
      }
    }
    hidden.set(row.group, (hidden.get(row.group) ?? 0) + 1)
  }
  return { rows: kept, hiddenByGroup: hidden }
}

/** Bytes, in the largest unit that keeps the number readable. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unknown'
  if (bytes < 1024) return `${String(Math.round(bytes))} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value < 10 ? value.toFixed(1) : String(Math.round(value))} ${units[unit]}`
}

/**
 * What a prune preview says out loud, before anyone agrees to it.
 *
 * The count of what would go is never the whole story: some old missions are
 * kept because a conversation being kept continues from them, and some
 * because they are running. A preview that mentioned only the deletions would
 * read as though the rest had been missed.
 */
export function prunePreviewSummary(preview: {
  readonly deleted: readonly string[]
  readonly keptForContinuity: readonly string[]
  readonly keptAsRunning: readonly string[]
}): string {
  const missions = (count: number): string => `${String(count)} mission${count === 1 ? '' : 's'}`
  if (preview.deleted.length === 0) {
    const because: string[] = []
    if (preview.keptForContinuity.length > 0) {
      because.push(`${missions(preview.keptForContinuity.length)} still part of a conversation you are keeping`)
    }
    if (preview.keptAsRunning.length > 0) because.push(`${missions(preview.keptAsRunning.length)} running right now`)
    return because.length === 0
      ? 'Nothing is old enough to delete.'
      : `Nothing would be deleted: ${because.join(', and ')}.`
  }
  const kept: string[] = []
  if (preview.keptForContinuity.length > 0) {
    kept.push(`${missions(preview.keptForContinuity.length)} kept as part of a conversation you are keeping`)
  }
  if (preview.keptAsRunning.length > 0) kept.push(`${missions(preview.keptAsRunning.length)} kept because they are running`)
  return `Delete ${missions(preview.deleted.length)} for good${kept.length === 0 ? '' : `, with ${kept.join(' and ')}`}.`
}

/**
 * Whether a permission mode can actually run on a runtime.
 *
 * Per-action approvals need a runtime that can stop and ask, which today is
 * the Codex app-server alone. Offering the mode anyway meant a person could
 * sit in it with another route selected and have every message refused before
 * it started -- which is exactly what happened to the first person to try it.
 * A control that cannot do its job says so instead.
 */
export function modeRunsOn(
  mode: MissionMode,
  runtime: MissionRuntimeId,
  platform?: string
): boolean {
  if (mode === 'approve-each') return runtime === 'codex'
  // Antigravity's agent runs its own tools under its own policy; the host
  // has no handle that holds it read-only, so only the mode that says so is
  // offered.
  if (mode === 'ask' && runtime === 'antigravity') return false
  // Claude Code was briefly Ask-only here, on the reading that it could not
  // edit. It can: `--permission-mode acceptEdits` with the editing tools
  // named. The contradiction that prompted it -- "Accept edits" in the
  // composer beside "read-only" in the header -- was fixed properly by making
  // the mode decide the argv, in `createClaudePrintCommand`. Removing the
  // capability had been the wrong repair for the right complaint.
  // Cursor's read-only mode is only real where its sandbox can run. On
  // Windows the host refuses such a mission rather than record a containment
  // it cannot keep -- so offering the mode here would be offering a refusal,
  // and every message sent under it came back as an error.
  if (mode === 'ask' && runtime === 'cursor' && platform === 'win32') return false
  return true
}

/** The modes a route can actually run, in the order they are offered. */
/**
 * A mission mode in the words the composer uses for it.
 *
 * The roster card printed the literal string `read-only` for every teammate,
 * whatever mode they had actually run in -- a fact the card never had. Once a
 * runtime could edit, that line was simply false. MEASURED 2026-09-03 while
 * reading the Teammates screen.
 */
export function modeLabel(mode: MissionMode | undefined): string {
  if (mode === 'accept-edits') return 'accept edits'
  if (mode === 'approve-each') return 'approve each action'
  if (mode === 'ask') return 'ask · read-only'
  return 'not set yet'
}

export function modesFor(runtime: MissionRuntimeId, platform?: string): readonly MissionMode[] {
  return (['ask', 'accept-edits', 'approve-each'] as const).filter((mode) =>
    modeRunsOn(mode, runtime, platform)
  )
}

/** Why a mode is unavailable here, for the menu to say out loud. */
export function modeUnavailableReason(
  mode: MissionMode,
  runtime: MissionRuntimeId,
  platform?: string
): string | undefined {
  if (modeRunsOn(mode, runtime, platform)) return undefined
  if (mode === 'approve-each') return `Codex CLI only. ${runtimeLabel(runtime)} cannot stop and ask yet.`
  if (runtime === 'antigravity') return "Antigravity runs its own agent with its own permissions; Locust cannot hold it read-only."
  return 'Cursor Agent cannot be held read-only on Windows: its sandbox needs macOS or Linux, and plan mode alone does not stop it editing files.'
}

function runtimeLabel(runtime: MissionRuntimeId): string {
  if (runtime === 'claude') return 'Claude Code'
  if (runtime === 'cursor') return 'Cursor Agent'
  if (runtime === 'opencode') return 'OpenCode'
  if (runtime === 'copilot') return 'Copilot CLI'
  if (runtime === 'antigravity') return 'Antigravity'
  if (runtime === 'gemini') return 'Gemini CLI'
  return 'Codex CLI'
}

/**
 * The model families worth surfacing first when nothing else distinguishes
 * them.
 *
 * This is a CURATED JUDGEMENT, not a measurement: nothing in this app counts
 * how often a model is used anywhere but on this machine. It exists because a
 * runtime that lists seventy models alphabetically buries the ones most
 * people came for. It only ever affects ORDER -- no row is hidden, nothing is
 * labelled "best", and a model absent from this list is offered exactly as
 * readily as one on it.
 */
const FLAGSHIP_MODELS: readonly RegExp[] = [
  /^auto$/i,
  /grok-4\.6/i,
  /composer-2/i,
  /opus-5/i,
  /fable/i,
  /sonnet-5/i,
  /gpt-5\.3-codex/i,
  /gemini-3/i,
  /gpt-5\.6/i
]

/** Where a model sits in the curated list, or nowhere. */
export function flagshipRank(modelId: string): number | undefined {
  const index = FLAGSHIP_MODELS.findIndex((pattern) => pattern.test(modelId))
  return index === -1 ? undefined : index
}

/**
 * Order the picker's rows within each runtime: what this person has actually
 * run, newest first; then the flagship families; then everything else, in the
 * order the runtime listed them.
 *
 * The first rule comes from their own ledger and is a claim the app can back.
 * The second is a judgement, and is second for that reason.
 */
/** How many routes the Recent group offers before it is a list of its own. */
export const RECENT_ROUTE_LIMIT = 4

/**
 * The routes this person actually moves between, lifted to the top.
 *
 * Recency already sorts rows WITHIN a runtime, which helps when you stay on
 * one. It does nothing for the move this product exists for -- putting two
 * models on the same work -- because the other runtime's group sits below
 * six rows of the one you are on, and the list shows less than half its
 * height at a time. MEASURED 2026-09-03: 27 rows across 7 groups, scrolling
 * at 330px of 751.
 *
 * Only routes that are still offered appear, so a model a runtime has stopped
 * advertising cannot be resurrected here. Three cases withhold it entirely,
 * all of them the same rule: a shortcut has to shorten something.
 *
 * - Fewer than two recents. One recent route is the one you are already on.
 * - A list short enough to see at once. The justification for the group was
 *   27 rows scrolling at 330px; below that there is nothing to skip past.
 * - Recents that are half the list or more. With two routes total, a Recent
 *   group duplicates the entire picker and explains nothing.
 *
 * The last two came from the design pass pushing back on the feature rather
 * than styling around it, which was the right call.
 */
export function recentRouteRows<TRow extends { readonly key: string; readonly group: string }>(
  rows: readonly TRow[],
  recent: readonly string[],
  limit: number = RECENT_ROUTE_LIMIT
): readonly TRow[] {
  const byKey = new Map(rows.map((row) => [row.key, row]))
  const picked: TRow[] = []
  for (const key of recent) {
    const row = byKey.get(key)
    if (row === undefined) continue
    picked.push({ ...row, group: 'Recent', key: `recent:${key}` })
    if (picked.length >= limit) break
  }
  if (picked.length < 2) return []
  // Short enough to take in at once, or so much of the list that the shortcut
  // is a second copy of it.
  if (rows.length <= ROUTE_GROUP_LIMIT + 2) return []
  if (picked.length * 2 >= rows.length) return []
  return picked
}

export function orderRouteRows<TRow extends { readonly key: string; readonly group: string; readonly model?: string }>(
  rows: readonly TRow[],
  recent: readonly string[]
): readonly TRow[] {
  const rank = new Map(recent.map((key, index) => [key, index]))
  const groups: string[] = []
  for (const row of rows) if (!groups.includes(row.group)) groups.push(row.group)
  const score = (row: TRow): number => {
    const used = rank.get(row.key)
    if (used !== undefined) return used
    const flagship = flagshipRank(row.model ?? row.key)
    // Everything used sorts above everything merely notable, which sorts
    // above the rest; the offsets keep those three bands apart whatever the
    // counts are.
    return flagship === undefined ? 2_000_000 : 1_000_000 + flagship
  }
  return [...rows].sort((left, right) => {
    // Groups keep the order discovery gave them; only rows move.
    const byGroup = groups.indexOf(left.group) - groups.indexOf(right.group)
    if (byGroup !== 0) return byGroup
    return score(left) - score(right)
  })
}

/**
 * Which missions a search shows.
 *
 * The sidebar's search field was drawn, labelled and completely inert: it
 * held no state and filtered nothing, which is the exact shape this codebase
 * refuses elsewhere -- a control that cannot do its job should say so rather
 * than appear and fail.
 *
 * Matching is on the words a person can see: a mission's title, and its short
 * id, so the id in a receipt can be pasted straight in.
 */
export function missionsMatching<TRow extends { readonly title: string; readonly missionId: string }>(
  rows: readonly TRow[],
  query: string
): readonly TRow[] {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return rows
  return rows.filter((row) =>
    row.title.toLowerCase().includes(needle) || row.missionId.toLowerCase().includes(needle)
  )
}

/**
 * One row per CONVERSATION, not one per turn.
 *
 * A mission is one run: one process, one receipt, one durable record, and a
 * reply is a second run because it is a second process. That is right for the
 * ledger and wrong for the sidebar, which was listing every reply as its own
 * entry while the thread beside it showed them as the single exchange they
 * were. So the chain is collapsed here, for display only -- nothing about how
 * missions are recorded changes.
 *
 * The row a person clicks is the LEAF of the chain: the turn nothing else
 * continues from, which is where the conversation actually is. Its name comes
 * from the ROOT, because that is what they typed to start it. The phase is
 * live if any turn is live, so a conversation whose newest turn is running
 * reads as running.
 */
export interface ConversationRowExtras {
  /** Every mission in the chain, so selecting any turn lights this row. */
  readonly memberIds: readonly string[]
  /** How many turns it holds. 1 means an ordinary single-run mission. */
  readonly turns: number
}

/**
 * What a route row is searched by. Model ids arrive as `muse-spark-1.3` and
 * `gpt-5.6-luna`; a person types "muse spark" or "gpt 5". Punctuation is
 * folded to spaces on both sides so the search matches how names are said,
 * not how a CLI happened to spell them.
 */
export function routeSearchText(text: string): string {
  return text.toLowerCase().replace(/[-_/.:]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Whether a run belongs in the mission list at all.
 *
 * A send the host refused never became a mission: no id was ever assigned to
 * it and it has already settled. Listing one files a permanent row under an
 * internal key, which looks like a mission, answers "Copy mission id" with
 * that key, and can never be reopened -- Codex's QA pass on 0.14 caught it as
 * a prompt that "appeared submitted" but "was never recorded as a mission".
 * A run that is still starting has no id yet either, and that one DOES belong:
 * it is how a teammate reads as working before the first receipt.
 */
export function listedAsMission(run: {
  readonly missionId: string | undefined
  readonly active: boolean
}): boolean {
  return run.missionId !== undefined || run.active
}

export function collapseConversations<
  TRow extends {
    readonly missionId: string
    readonly title: string
    readonly phase: string
    readonly integrityIssueCount: number
    readonly rootId?: string
    readonly parentId?: string
  }
>(rows: readonly TRow[]): readonly (TRow & ConversationRowExtras)[] {
  const order: string[] = []
  const groups = new Map<string, TRow[]>()
  for (const row of rows) {
    const key = row.rootId ?? row.missionId
    const held = groups.get(key)
    if (held === undefined) {
      order.push(key)
      groups.set(key, [row])
    } else {
      held.push(row)
    }
  }
  return order.map((key) => {
    const members = groups.get(key) ?? []
    const continued = new Set(members.map((row) => row.parentId).filter((id): id is string => id !== undefined))
    // The leaf is the turn nothing continues from. A hand-edited ledger could
    // leave none, so the last row read is the fallback rather than a crash.
    const leaf = members.find((row) => !continued.has(row.missionId)) ?? members[members.length - 1]!
    const root = members.find((row) => row.missionId === key) ?? leaf
    const running = members.find((row) => row.phase === 'running')
    return {
      ...leaf,
      title: root.title,
      phase: running === undefined ? leaf.phase : running.phase,
      integrityIssueCount: Math.max(...members.map((row) => row.integrityIssueCount)),
      memberIds: members.map((row) => row.missionId),
      turns: members.length
    }
  })
}
