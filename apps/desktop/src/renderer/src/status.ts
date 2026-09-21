import { FREE_START_RUNTIME, installSentence } from '../../shared/runtime-install.js'
import { hostCanRunMission, isMissionRuntime } from '../../shared/runtimes.js'
import { faceLabel, teammateActivity } from './faceState.js'
import type { FaceActivity, LiveActivity } from './faceState.js'
import type { MissionMode, PublicModel, PublicRecoveredMission, PublicRuntimeStatus } from '../../shared/ipc.js'
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
  /** Signed in, and the last run on it ended on the account's own usage limit. */
  | 'AT LIMIT'
  | 'PREVIEW'
  | 'SIGN IN'
  | 'NOT INSTALLED'
  | 'UNAVAILABLE'
  /** Installed, but its probe did not answer in time; discovery asks again. */
  | 'CHECKING'
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
/**
 * The route a mission starts on when nobody has chosen one.
 *
 * `codex/account-default` was hard-coded in three places -- the composer's
 * seeded route, a room post for a teammate with no route of its own, and the
 * relay's borrowed route -- and nothing ever moved any of them. So a person
 * who installed the runtime the app told them to install still had a composer
 * pointing at Codex, which was not on their machine: the box read "Install a
 * coding agent and sign in to start a mission…", Enter did nothing, and no
 * part of the screen said why (QA, 2026-09-06, reproduced live). Their first
 * room post would have refused every teammate for the same reason.
 *
 * Preference order, and each part is deliberate:
 *
 * 1. A runtime that can actually run right now. A default naming something
 *    absent is the whole defect.
 * 2. Among those, the one that needs no account -- OpenCode -- because on a
 *    fresh machine it is the only one that is a complete answer, and the
 *    first-run screen already recommends it by name.
 * 3. Failing everything, still OpenCode -- the runtime the first-run screen
 *    is at that moment telling them to install. This used to fall back to
 *    Codex "as a stable answer for a machine mid-probe", and a first outside
 *    tester read the result exactly as it sounds (2026-09-07): a welcome
 *    screen selling OpenCode above a composer claiming `Codex CLI /
 *    account-default`, on a machine with no CLIs at all. A default that names
 *    something absent is the defect this function exists to fix, and naming
 *    the one the app is recommending is at least a claim the next click can
 *    make true.
 *
 * The MODEL is left as `account-default` here on purpose: which model to
 * prefer is the catalogue's business, not discovery's, and the picker is what
 * knows a free one exists.
 */
export function defaultRoute(runtimes: readonly PublicRuntimeStatus[]): {
  readonly runtime: MissionRuntimeId
  readonly model: string
} {
  // `hostCanRunMission` takes a mission runtime; the settings list carries a
  // wider set of ids (omniroute chooses a route rather than being one), so the
  // narrowing happens here rather than at every call site.
  const usable = runtimes.filter(
    (runtime) => runtimeIsUsable(runtime) && isMissionRuntime(runtime.id) && hostCanRunMission(runtime.id)
  )
  const free = usable.find((runtime) => runtime.id === FREE_START_RUNTIME)
  const chosen = free ?? usable[0]
  return {
    runtime: (chosen?.id as MissionRuntimeId | undefined) ?? FREE_START_RUNTIME,
    model: ACCOUNT_DEFAULT_MODEL
  }
}

/**
 * The model a route carries before the catalogue has been read.
 *
 * It is a real thing to run -- "whatever this account gives you" -- but it is
 * not a row in any list, so a route left on it has no ACTIVE row in the
 * picker, and everything the picker hangs on that row (the effort levels,
 * most of all) has nothing to attach to. Measured on a fresh profile
 * 2026-09-07: 0 ACTIVE rows, 0 effort chips.
 */
export const ACCOUNT_DEFAULT_MODEL = 'account-default'


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
/**
 * What a signed-in runtime says about itself. Exported because the welcome
 * screen states it ONCE above the list instead of six times inside it, and a
 * second copy of the sentence would drift from this one (design pass,
 * 2026-09-05).
 */
export const SIGNED_IN_DETAIL = 'Signed in on this machine, using your own account.'

/**
 * What a runtime says when it is ready WITHOUT an account.
 *
 * One runtime is in this state and it is the important one: OpenCode's free
 * model runs with no sign-in, which is the entire on-ramp for a person who
 * has just installed the app. Saying "signed in, using your own account"
 * about it is both false and discouraging in the same breath.
 */
export const NO_ACCOUNT_DETAIL = 'Ready. Its free model needs no account.'

export function routeRowTag(status: RouteRowStatus, isActive: boolean): RouteTag {
  // AT LIMIT outranks ACTIVE: the active route being the one that just
  // refused to run is exactly what a person needs to see.
  if (status.tag === 'AT LIMIT') return status.tag
  return isActive && status.selectable ? 'ACTIVE' : status.tag
}

/**
 * @param limited  The runtime's own words the last time a run on it ended on
 *   the account's usage limit, while nothing on it has completed since.
 *   READY means "signed in"; it had been saying so beside a runtime that had
 *   just refused two missions in a row (user session 1, 2026-09-05), and the
 *   picker offered every model of it as READY. The row stays selectable --
 *   the limit is the account's and may lift on the provider's clock -- but
 *   the tag and the sentence say what happened.
 */
export function routeRowStatus(
  runtime: PublicRuntimeStatus,
  integration: IntegrationLevel,
  isActive: boolean,
  limited?: string
): RouteRowStatus {
  const status = baseRouteRowStatus(runtime, integration, isActive)
  if (limited === undefined || !status.selectable) return status
  return {
    tag: 'AT LIMIT',
    selectable: true,
    detail: `Signed in, but the last run on it ended on your account's usage limit: ${limited}`
  }
}

function baseRouteRowStatus(
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
      tag: 'NOT INSTALLED',
      selectable: false,
      // "Install it and sign in" is true and it is a dead end: it names the
      // problem and leaves the person to go and find the answer, which is the
      // wall anyone opening Locust for the first time hits before they have
      // seen it do anything. This says which package, and what signing in
      // takes -- or that nothing does.
      detail: installSentence(runtime.id, runtime.displayName)
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
    // Installed but not answering is a moment, not a verdict: Claude Code's
    // first version probe can outlast the 5 s window on a cold start, and
    // Colin's launch screen said UNAVAILABLE for a runtime that was fine a
    // minute later (2026-09-05). The shell asks again; the tag says so.
    const reason =
      runtime.status === 'offline'
        ? 'could not be reached'
        : runtime.status === 'probe-failed'
          ? 'did not answer its version probe in time'
          : 'is not ready'
    return {
      tag: 'CHECKING',
      selectable: false,
      detail: `${runtime.displayName} ${reason}. Locust asks again shortly.`
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
    detail: runtime.auth === 'not-applicable' ? NO_ACCOUNT_DETAIL : SIGNED_IN_DETAIL
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
/**
 * DECIDED 2026-09-05 (Colin: "if antigravity works it works"). An
 * EXPERIMENTAL route counts when discovery says it can run right now --
 * Antigravity only answers while its own app is open with this folder, so
 * the count reflects that moment honestly and drops back when it does not.
 * What is NOT counted is a runtime this build cannot drive at all: `planned`
 * is filtered by name, which is why a design pass's report that Gemini was
 * being counted did not hold.
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

/**
 * Which runtime a teammate is judged against, decided in ONE place.
 *
 * Their running mission's, then any past mission's, then the route they are
 * SET to use. That last step is Astra's Finding 1 (2026-09-14) and it was
 * missing from all three surfaces identically, because all three wrote this
 * chain out by hand.
 *
 * What she saw: a brand-new Claude teammate on a profile where Claude is not
 * signed in. Settings said, correctly and in red, "Installed, but Claude Code
 * is not signed in", with `run claude` beside it. The sidebar said
 * "Docs & QA - idle". Idle is the word for a teammate with nothing to do; this
 * one could not do anything, the app knew, and the surface a person looks at
 * first said the wrong word.
 *
 * The cause is that a teammate's runtime was read from its MISSIONS, and a
 * teammate that has never run has none -- so the sign-in check was skipped for
 * exactly the teammates a person is most likely to be looking at, the ones
 * they just made. 0.109.0 made all three surfaces draw the same dot; this is
 * the state behind the dot, which was wrong everywhere equally.
 */
export function runtimeOfTeammate(
  teammate: { readonly route?: { readonly runtime: string } },
  owned: readonly { readonly phase: string; readonly runtime?: string }[]
): string | undefined {
  return (
    owned.find((mission) => mission.phase === 'running')?.runtime ??
    owned.find((mission) => mission.runtime !== undefined)?.runtime ??
    teammate.route?.runtime
  )
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
  /**
   * Whether ANY runtime is on this machine at all -- which is a different
   * question from whether one is usable, and the difference is the whole of
   * Grok's finding 2 (2026-09-15).
   */
  readonly anyRuntimeInstalled?: boolean
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
  /*
   * Nobody can work when nothing is usable, whatever this teammate has done
   * before -- but WHY nothing is usable decides what the row should say.
   *
   * Grok's pass 4, 2026-09-15, driving the case this app is about to meet:
   * a machine with no coding CLI at all. Settings said OpenCode **NOT
   * INSTALLED**; the roster row beside it said **Runtime sign-in required**,
   * in red. "There is nothing to sign in to. The CLI is not there."
   *
   * Two facts wore one sentence, and the wrong one was on the screen a
   * person stares at after naming their first teammate -- while the screen
   * that knew the truth was two clicks away. Telling someone to sign in to
   * software they have not installed is an instruction they cannot follow.
   */
  if (input.anyRuntimeUsable === false) {
    return input.anyRuntimeInstalled === false
      ? { status: 'blocked', activity, label: 'No runtime installed', tone: 'red', pulse: false }
      : { status: 'blocked', activity, label: 'Runtime sign-in required', tone: 'red', pulse: false }
  }
  // A teammate whose OWN runtime cannot run is blocked, even if a mission
  // looks active in the renderer -- the sign-in wall outranks optimistic
  // local state. One with no runtime AND no route is simply idle; see
  // `runtimeOfTeammate` for why "no missions yet" used to mean the same
  // thing and should not have.
  if (input.runtime !== undefined && !runtimeIsUsable(input.runtime)) {
    // Same distinction, for the teammate's OWN runtime: absent is not
    // unsigned. `installed` is the runtime's own answer, so this needs
    // nothing passed in.
    return {
      status: 'blocked',
      activity,
      label: input.runtime.installed ? 'Runtime sign-in required' : 'Runtime not installed',
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
/**
 * What was verified, said on the face of it.
 *
 * This returned a bare `verified`, in green, beside `COMPLETED`. Astra's audit
 * of 0.87.1: "it does not name what was verified on its collapsed face... a
 * completed but incorrect artifact can have an intact record without appearing
 * endorsed as correct work."
 *
 * That is the one claim this app must never make by accident. The receipt is
 * about DURABILITY -- that the record of this mission is whole and recovers --
 * and it says nothing at all about whether the work was any good. A green
 * `verified` under a finished turn invites exactly the other reading.
 *
 * The Missions header has always said `ledger verified` for the same fact
 * (`Screens.tsx`), so this is also two surfaces agreeing on their own words
 * rather than a new phrase.
 */
export function ledgerVerificationLabel(integrityIssueCount: number): 'ledger verified' | 'ledger incomplete' {
  return integrityIssueCount === 0 ? 'ledger verified' : 'ledger incomplete'
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
 * While a search is running the cap is WIDER, not gone. It used to be lifted
 * entirely -- "the person has narrowed the list themselves" -- and one letter
 * then produced 92 rows (0.21.2 QA): a search for `a` narrows nothing, and a
 * wall of matches is the thing the cap exists to prevent. What made the cap
 * honest before still makes it honest here: the rows held back are counted
 * and the picker says so, so a narrowing is visible rather than a lie.
 */
export const ROUTE_SEARCH_GROUP_LIMIT = ROUTE_GROUP_LIMIT * 2

export function capRouteRows<TRow extends { readonly group: string; readonly tag: RouteTag }>(
  rows: readonly TRow[],
  limit: number,
  searching: boolean
): CappedRouteRows<TRow> {
  if (searching) limit = Math.max(limit, ROUTE_SEARCH_GROUP_LIMIT)
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
  // Auto needs a handle on the runtime's own permissions. Antigravity runs
  // its agent under its own policy and Locust holds nothing there, so the
  // one mode it can honestly offer stays the one it already offers.
  if (mode === 'auto') return runtime !== 'antigravity'
  // Plan is available exactly where read-only containment is real. A plan
  // that could edit the workspace is a promise the app cannot keep, and the
  // Cursor/Windows reason below already says so in its last clause.
  if (mode === 'plan') return modeRunsOn('ask', runtime, platform)
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
/**
 * Every mode, and every phrasing of it, in ONE table.
 *
 * There were four, in four files: the composer's `MODES` rows, `modeLabel`
 * here, `modeSentence` in `IdleTeammate.tsx`, `modeSummary` in
 * `NewTeammateDialog.tsx`. Nothing made them agree and they already did not --
 * the same mode was `Ask` in one place and `ask` in another, and only two of
 * the four said Ask is read-only, which is the single most load-bearing fact
 * about it (Grok's audit, 2026-09-13). Four tables is four chances to be wrong
 * about what a run may touch, and this app has been wrong about that before:
 * the histories on `modeSummary` and on the composer's connector sentence are
 * both records of shipping a permission claim that the run did not have.
 *
 * The registers stay different on purpose -- a picker row, a receipt line, a
 * summary card and a second-person sentence are not the same writing. What is
 * shared is the FACTS, and they are these.
 */
export interface ModeFacts {
  readonly mode: MissionMode
  /** Title case, the way a control names it. */
  readonly name: string
  /** The clause a receipt appends to say what it may touch, where one adds anything. */
  readonly scope?: string
  /** A short lowercase clause, for a summary card that leads with the name. */
  readonly short: string
  /** One full third-person sentence, for a picker row that has the room. */
  readonly consequence: string
  /** Said to the person, second person, where they are about to choose. */
  readonly sentence: string
}

/** In the order the composer offers them. */
export const MODE_FACTS: readonly ModeFacts[] = [
  {
    mode: 'ask',
    name: 'Ask',
    scope: 'read-only',
    short: 'reads and explains, every write refused',
    consequence: 'Reads and explains. Every write is refused by the sandbox.',
    sentence: 'In Ask mode nothing is changed: every write is refused.'
  },
  {
    mode: 'accept-edits',
    name: 'Accept edits',
    short: 'may change files in this workspace',
    consequence: 'May edit files inside this workspace folder, and nowhere else.',
    sentence:
      'Accept edits is on, so it may change files here; switch to Ask below to keep it read-only.'
  },
  {
    mode: 'plan',
    name: 'Plan',
    scope: 'read-only',
    short: 'answers with the steps it would take, changes nothing',
    consequence: 'Answers with the steps it would take, and changes nothing.',
    sentence: 'In Plan mode it answers with the steps it would take and changes nothing.'
  },
  {
    mode: 'approve-each',
    name: 'Approve each action',
    short: 'asks before every command or change',
    consequence: 'Stops and asks before every command or file change.',
    sentence: 'Every change waits for your approval before it lands.'
  },
  {
    mode: 'auto',
    name: 'Auto',
    scope: 'whole machine',
    short: 'may edit anything on this machine',
    consequence:
      'Runs without asking and may change files anywhere on this machine, not only this folder.',
    sentence:
      'Auto is on: it runs without asking and may change files anywhere on this machine, not only in this folder.'
  }
]

export function modeFacts(mode: MissionMode): ModeFacts {
  // The union is closed and the table covers it, which `mode-says-one-thing`
  // asserts. The fallback exists so a mode added to the union without a row
  // renders SOMETHING rather than crashing the surface that drew it.
  return MODE_FACTS.find((facts) => facts.mode === mode) ?? MODE_FACTS[0]!
}

/**
 * A mission mode in the words a receipt uses for it.
 *
 * The roster card printed the literal string `read-only` for every teammate,
 * whatever mode they had actually run in -- a fact the card never had. Once a
 * runtime could edit, that line was simply false. MEASURED 2026-09-03 while
 * reading the Teammates screen.
 *
 * Lowercase, because it sits mid-sentence in a receipt; the scope clause is
 * appended only where it adds something the name does not already carry.
 */
export function modeLabel(mode: MissionMode | undefined): string {
  if (mode === undefined) return 'not set yet'
  const facts = modeFacts(mode)
  const name = facts.name.toLowerCase()
  return facts.scope === undefined ? name : `${name} · ${facts.scope}`
}

/** The summary card's line: the name, then what it does. */
export function modeSummary(mode: MissionMode): string {
  const facts = modeFacts(mode)
  return `${facts.name} · ${facts.short}`
}

/** Said to the person on the surface where they are about to choose. */
export function modeSentence(mode: MissionMode): string {
  return modeFacts(mode).sentence
}

/**
 * Auto is absent unless the workspace switched it on, and absent rather than
 * disabled: a greyed-out row invites the question "how do I get that?" on the
 * one control where the answer should be a deliberate trip to Settings.
 * Omitting the option is also what makes this fail closed -- a caller that
 * does not pass the switch cannot offer the mode by forgetting to.
 */
/**
 * What a run was allowed, in the words the header uses. Read from the run's
 * own start receipt, never from the mode the composer happens to show now --
 * and Auto needs its own phrase, because a run that could touch the whole
 * machine rendered as "may edit the workspace" would understate what happened.
 */
export function sandboxPhrase(sandbox: 'read-only' | 'workspace-write' | 'full-access' | undefined): string {
  if (sandbox === 'full-access') return 'may edit anything on this machine'
  if (sandbox === 'workspace-write') return 'may edit the workspace'
  return 'read-only'
}

/**
 * Who the composer should address once a conversation is opened.
 *
 * Opening a mission used to change the thread and leave the selection alone,
 * so clicking a teammate's message in an exchange showed THEIR run under a
 * header with their name while the composer still said "Message Wren..." and
 * Wren's card stayed lit -- three surfaces, two answers, on the one control
 * whose whole job is saying where the next message goes (0.35.0 targeted QA).
 *
 * A mission with no recorded owner keeps the current selection rather than
 * clearing it: an unowned raw conversation is a real state, and blanking the
 * composer would be a second wrong answer instead of the first.
 */
export function ownerToSelect(
  missionId: string,
  owners: Readonly<Record<string, string>>,
  current: string | undefined,
  /**
   * The owner the run itself carries, which is what the HEADER prefers. The
   * two read from different places and agreed everywhere anyone could trace,
   * because every path that sets one writes the other -- except the window
   * where a run has started and the host has not recorded it yet (QA,
   * 2026-09-06, source-reviewed). Taking the same first answer here closes
   * the window instead of relying on the two staying in step.
   */
  fromRun?: string
): string | undefined {
  return fromRun ?? owners[missionId] ?? current
}

/**
 * Every mode a route can run, Auto included.
 *
 * Auto was briefly hidden until the workspace switch was on, so choosing it
 * meant a trip to Settings first. Colin, 2026-09-06: "always allow auto to be
 * chosen from the permission dropdown, we want the user experience to be
 * fluid." So it is always offered, and picking it turns the switch on -- the
 * menu item IS the switch, with its consequence stated beside it in amber.
 * Settings keeps the same switch for seeing the state and taking it back, and
 * the host still asks the switch as each run starts, so nothing here is what
 * finally decides whether a run gets it.
 */
export function modesFor(runtime: MissionRuntimeId, platform?: string): readonly MissionMode[] {
  return (['ask', 'plan', 'accept-edits', 'approve-each', 'auto'] as const).filter((mode) =>
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
  if (mode === 'auto') return `${runtimeLabel(runtime)} runs its own agent under its own permissions; Locust has no handle to widen.`
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
  // A newer family sits above the one it replaces. Added 2026-09-05, the day
  // GPT-6 Astra appeared: the app READS its models from each runtime, so a
  // new one is offered the moment the runtime reports it and needs no code
  // at all -- this list is the single exception, and only decides where a
  // row sits among seventy. Left out, Astra sorted below GPT-5.6.
  /gpt-6/i,
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

export function orderRouteRows<
  TRow extends {
    readonly key: string
    readonly group: string
    readonly model?: string
    readonly tag?: string
  }
>(
  rows: readonly TRow[],
  recent: readonly string[]
): readonly TRow[] {
  const rank = new Map(recent.map((key, index) => [key, index]))
  const groups: string[] = []
  for (const row of rows) if (!groups.includes(row.group)) groups.push(row.group)
  const score = (row: TRow): number => {
    // The route you are ON sorts first in its group. It used to sort by the
    // same rules as everything else, so "account-default" -- not recently
    // used and not a flagship name -- fell into the bottom band, below six
    // models and behind a "1 more model · type to search them" line. The row
    // the composer is pointing at is the last thing that should need finding.
    if (row.tag === 'ACTIVE') return -1
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
/**
 * The effort level a route uses when nobody has chosen one.
 *
 * The control is meant to read as a constant -- Colin, 2026-09-07: "have it
 * be a constant" -- and a control showing nothing was how "we still have no
 * effort control" stayed true even after the levels existed.
 *
 * This is used in TWO places on purpose: the chip's display in Composer.tsx
 * and the value `swarmEffortFor` hands the run. It has to be both, and for
 * one release it was only the first -- the chip stated "medium" while the run
 * was started with no effort argument at all.
 *
 * `medium` when the model offers it, because every runtime here treats it as
 * the ordinary setting. Otherwise the middle of what was reported, which for
 * a two-level model is the higher one -- the same bias as picking `medium`
 * out of five. Undefined only when the model reports no levels at all, and
 * then there is nothing to show.
 */
export function defaultEffort(supportedEfforts: readonly string[]): string | undefined {
  if (supportedEfforts.length === 0) return undefined
  if (supportedEfforts.includes('medium')) return 'medium'
  return supportedEfforts[Math.floor(supportedEfforts.length / 2)]
}

/**
 * The effort to use after a model switch.
 *
 * Carried across when the new model advertises it, so choosing a different
 * model does not silently undo a choice about how hard it should think.
 * Cleared to that model's default otherwise, never to nothing: sending a
 * level a model never advertised is the thing this guards against, and
 * showing an empty control is what it used to do instead.
 */
export function effortAfterRouteChange(
  current: string | undefined,
  supportedEfforts: readonly string[]
): string | undefined {
  if (current !== undefined && supportedEfforts.includes(current)) return current
  return defaultEffort(supportedEfforts)
}

/**
 * A model id as it should read beside the runtime that serves it.
 *
 * OpenCode aggregates providers, so its ids carry one:
 * `anthropic/claude-sonnet-4`, `opencode/ling-3.0-flash-fin-free`. The
 * provider is real information and stays -- EXCEPT when it merely repeats
 * the runtime already named next to it, which is how the composer came to
 * read `OpenCode / opencode/ling-3.0-flash-fin-free` and truncate to
 * `OpenCode / opencode/big-pic...`: the runtime twice, and the part that
 * identifies the model cut off (outside tester, 2026-09-07).
 */
export function modelLabelFor(runtime: string, modelId: string): string {
  const slash = modelId.indexOf('/')
  if (slash <= 0) return modelId
  const provider = modelId.slice(0, slash)
  return provider.toLowerCase() === runtime.toLowerCase() ? modelId.slice(slash + 1) : modelId
}

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

/**
 * The model and effort a mission is actually started with.
 *
 * Some runtimes take an effort as a flag. Cursor encodes it in the model id
 * instead and lists every combination as its own model; the catalog folds
 * those into one row with `variants`, so the chosen effort has to be turned
 * back into the id it names -- and then NOT sent beside it. Sending both put
 * "cursor-grok-4.6-high-fast" and "medium" in front of a builder that refuses
 * any effort for Cursor, and every Cursor run with an effort picked failed
 * with "cannot be started with the options chosen" (Colin, 2026-09-06).
 */
/**
 * Whether this route's effort is already inside its model id.
 *
 * Cursor lists every effort as its own model (`cursor-grok-4.6-high-fast`,
 * `composer-2.5-fast`) and its command builder refuses a separate effort
 * outright. `startRoute` handles that for a mission the person starts. A
 * routine stores its route instead, and storing an effort beside an id that
 * already carries one put both in front of that builder: every routine taught
 * on Cursor threw on replay and never opened a mission (measured 2026-09-07,
 * `routine-smoke`, stored route
 * `{model: "composer-2.5-fast", effort: "fast"}`).
 *
 * Asked of the id rather than of the runtime, because the runtime is not the
 * thing that decides it -- a family that folds variants does, and the next
 * runtime to fold them should not need this file edited.
 */
/**
 * Whether the runtime we tell a new person needs no account STILL has
 * something free to run.
 *
 * `FirstLaunch` promises, unconditionally: *"OpenCode needs no account — one
 * install and you have a working teammate."* Both halves are true today, but
 * they are different KINDS of claim. "Needs no account" is about auth and is
 * a property of the runtime's design. "You have a working teammate" depends
 * on OpenCode continuing to publish a free model -- a decision somebody else
 * makes, about which Colin asked directly (2026-09-21): *"i know its
 * available on opencode but idk how long that will continue for."*
 *
 * Nothing checked it. The app would have gone on promising a free teammate
 * to someone who installs OpenCode and finds nothing they can run -- the
 * worst moment to be wrong, because it is the first one.
 *
 * THREE ANSWERS, and the third is the point:
 *
 * - `yes`   - OpenCode is ready and lists at least one `-free` model.
 * - `no`    - OpenCode is ready, its list was read, and none of it is free.
 * - `unknown` - it is not installed yet, or its list has not been read.
 *
 * **`unknown` must never weaken the promise.** At first launch OpenCode is
 * usually not installed, so `unknown` IS the ordinary path; treating absence
 * of evidence as disproof would quietly retire the onboarding sentence for
 * everybody. The copy changes only on `no`, which is positive evidence.
 */
export function freeStartStillFree(
  runtimes: readonly PublicRuntimeStatus[],
  models: readonly PublicModel[]
): 'yes' | 'no' | 'unknown' {
  const runtime = runtimes.find((entry) => entry.id === FREE_START_RUNTIME)
  if (runtime?.status !== 'ready') return 'unknown'
  const listed = models.filter((model) => model.runtime === FREE_START_RUNTIME)
  // A ready runtime whose list we never read tells us nothing about its
  // prices. That is the same distinction the rest of this file keeps: no
  // answer is not a bad answer.
  if (listed.length === 0) return 'unknown'
  return listed.some((model) => model.id.endsWith('-free')) ? 'yes' : 'no'
}

export function effortIsInModelId(
  models: readonly PublicModel[],
  runtime: MissionRuntimeId,
  modelId: string
): boolean {
  return models.some(
    (model) =>
      model.runtime === runtime &&
      model.variants !== undefined &&
      (model.id === modelId || Object.values(model.variants).includes(modelId))
  )
}

/**
 * The catalogue row a model id belongs to -- by its own id, or by being one of
 * that family's effort variants.
 *
 * Two places needed this and each had written `find(m => m.id === modelId)`,
 * which is wrong for exactly the same reason in both: a Cursor family never
 * listed without an effort takes the FIRST VARIANT SEEN as its id, so the id
 * in hand is routinely a sibling of the family's own. In `startRoute` that
 * sent a loose effort to a runtime that refuses one (Colin, 2026-09-07). In
 * the composer it meant no family matched, `supportedEfforts` came back empty,
 * and the effort chip silently disappeared -- which is why the control count
 * moved between three and four across otherwise identical drives.
 */
export function modelFamily(
  models: readonly PublicModel[],
  runtime: string,
  modelId: string
): PublicModel | undefined {
  return models.find(
    (entry) =>
      entry.runtime === runtime &&
      (entry.id === modelId || Object.values(entry.variants ?? {}).includes(modelId))
  )
}

export function startRoute(
  models: readonly PublicModel[],
  runtime: MissionRuntimeId,
  modelId: string,
  effort: string | undefined
): { readonly model: string; readonly effort?: string } {
  if (effort === undefined) return { model: modelId }
  // Found by id OR by being one of a family's variants.
  //
  // Matching on `id` alone was the whole of this bug (Colin, 2026-09-07:
  // "before that model and effort was working perfectly fine"). A Cursor
  // family that is never listed without an effort takes the FIRST VARIANT SEEN
  // as its id -- `cursorModelsFrom` says so in as many words -- so the id in
  // hand is routinely `cursor-grok-4.6-low` while the person has chosen
  // `medium`. No family matched, the effort fell through as a separate value,
  // and `createCursorPrintCommand` refuses any effort: "Cursor Agent takes no
  // effort level. Nothing was recorded."
  //
  // Looking the family up through its variants as well makes the two paths
  // agree, and re-resolves the id to the variant the effort actually names.
  const model = modelFamily(models, runtime, modelId)
  // A model that advertises NO efforts must never be sent one.
  //
  // Colin, 2026-09-08: choosing OpenCode while an effort was set failed the run
  // outright -- "That runtime cannot be started with the options chosen.
  // OpenCode takes no effort level. Nothing was recorded." The effort was a
  // leftover from the previous route, and every place that changes a route has
  // to remember to clear it: the picker does, adopting a teammate's own route
  // did not. This is the one path EVERY start takes, so it is the honest place
  // to enforce it rather than a fourth caller remembering.
  //
  // Only when the family is actually KNOWN to have none. A model missing from
  // the catalogue (an account default, or a probe that has not answered yet)
  // says nothing about efforts, and dropping one there would quietly downgrade
  // a Claude run that asked for `high`.
  if (model !== undefined && model.supportedEfforts.length === 0) return { model: modelId }
  const variant = model?.variants?.[effort]
  if (variant !== undefined) return { model: variant }
  // A model with variants and no variant for this effort: the effort names
  // nothing this runtime can honour, so it is dropped rather than refused.
  if (model?.variants !== undefined) return { model: modelId }
  return { model: modelId, effort }
}

/**
 * The order runtimes read in on a settings list.
 *
 * `READY` → `EXPERIMENTAL` → `SIGN IN` → `NOT INSTALLED` → `PLANNED`, and
 * alphabetical inside each band so the order is stable between launches.
 *
 * Frame pass, 2026-09-15: the list ran Codex READY, Claude READY, Cursor
 * READY, **Gemini PLANNED**, OpenCode READY, Copilot READY, **OmniRoute
 * PLANNED**, Antigravity EXPERIMENTAL. Two things that do not exist sat in
 * the middle of six that do, so a person scanning for what they can use had
 * to read every tag. The picker already groups connected-first; Settings was
 * the one list not doing it.
 */
const RUNTIME_BAND: Readonly<Record<string, number>> = {
  READY: 0,
  EXPERIMENTAL: 1,
  'SIGN IN': 2,
  'AT LIMIT': 2,
  'NOT INSTALLED': 3,
  PLANNED: 4
}

export function runtimeListOrder(
  runtimes: readonly PublicRuntimeStatus[],
  tagOf: (runtime: PublicRuntimeStatus) => string
): readonly PublicRuntimeStatus[] {
  return [...runtimes].sort((left, right) => {
    const band = (RUNTIME_BAND[tagOf(left)] ?? 3) - (RUNTIME_BAND[tagOf(right)] ?? 3)
    return band !== 0 ? band : left.displayName.localeCompare(right.displayName)
  })
}

/**
 * What we knew, kept until something better is known.
 *
 * Discovery re-runs: fifteen seconds in, again while anything is still
 * checking, and every time the window is focused. Each answer replaced the
 * last wholesale — so a runtime that had reported `ready · 2.1.270` went
 * back to `CHECKING` with no version the moment a re-sweep began, and the
 * welcome grid flickered between three different kinds of thing in one
 * column. Colin, 2026-09-14: *"randomly checking for cursor and claude...
 * some showing ready, some showing version code, and the box just popped up
 * again randomly."*
 *
 * It got worse when probes were staggered, because a sweep now takes long
 * enough to watch — but the bug was always there, and it is the same one
 * this project keeps meeting: **absence of a fresh answer is not evidence
 * that the old one stopped being true.**
 *
 * So a probe that has not come back yet — `probe-failed` and `offline` are
 * the two states that mean "no answer", not "a bad answer" — keeps whatever
 * the last completed sweep established. Every DEFINITE outcome wins
 * immediately, including the bad ones: signed out, not installed and ready
 * all replace what came before, because each of those is an answer.
 */
const NO_ANSWER_YET: ReadonlySet<string> = new Set(['probe-failed', 'offline'])

export function keepWhatWasKnown(
  previous: readonly PublicRuntimeStatus[],
  next: readonly PublicRuntimeStatus[]
): readonly PublicRuntimeStatus[] {
  const before = new Map(previous.map((runtime) => [runtime.id, runtime]))
  return next.map((runtime) => {
    const held = before.get(runtime.id)
    if (held === undefined) return runtime
    // Still out. Keep the last thing this runtime actually said.
    if (NO_ANSWER_YET.has(runtime.status) && !NO_ANSWER_YET.has(held.status)) return held
    // Answered, but without a version it had told us before. A version does
    // not stop being true because one probe did not print it.
    if (runtime.version === null && held.version !== null && runtime.installed && held.installed) {
      return { ...runtime, version: held.version }
    }
    return runtime
  })
}
