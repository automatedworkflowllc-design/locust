import { createHash } from 'node:crypto'

import { workspaceIdFor } from './workspace.js'
import { joinMessageFragments } from '../shared/messageFragments.js'
import { monthOf, moneyOfRun, sumSpend } from '../shared/spend.js'
import type { RunMoney, Spend } from '../shared/spend.js'
import type { MissionLedger, RecoveredMission, Workroom, WorkroomMessage } from '@teammate/mission-store'
import type { MissionReadResponse,
  MissionDeleteResponse,
  MissionHistoryResponse,
  PublicPeerMessage,
  PublicRecoveredMission
} from '../shared/ipc.js'

const MAX_HISTORY_MISSIONS = 20
/**
 * How many conversations the sidebar may LIST, as opposed to carry transcript
 * for.
 *
 * THE BUG THIS EXISTS FOR. 0.216 stopped a paging boundary changing what a
 * conversation IS, by fetching absent ancestors. It did not stop a whole
 * conversation falling off the page: `listMissions` returns the 20
 * most-recently-touched missions, and a conversation whose own newest turn is
 * older than those twenty is simply not in the response. No row, no group
 * entry, nothing -- Colin, 2026-09-20, on the same conversation for the
 * second time: *"my research convo disappeared again"*.
 *
 * Twenty was never a statement about how many conversations a person may
 * have. It is a budget on TRANSCRIPT: a mission carries up to 500 events and
 * some of those are megabytes, which is what `MAX_HISTORY_BYTES` guards. A
 * row in the list needs none of that -- an id, a prompt, a phase and a clock,
 * a few hundred bytes -- so the two limits had no business being one number.
 *
 * They are now two. The newest `MAX_HISTORY_MISSIONS` come with their events;
 * everything up to here comes with `events: []`. One ledger read either way.
 */
const MAX_LISTED_MISSIONS = 300
const MAX_HISTORY_EVENTS = 500
const MAX_HISTORY_CHECKPOINTS = 25
/**
 * Ceiling on one IPC response. The per-mission event window bounds COUNT, not
 * SIZE: a mission of large tool outputs can carry megabytes inside 500 events,
 * and twenty such missions would hand the renderer an unbounded payload to
 * structured-clone in one go. Missions are dropped from the tail -- they are
 * already ordered newest first, so what is lost is the oldest.
 */
const MAX_HISTORY_BYTES = 4 * 1024 * 1024

/**
 * Join a mission's peer links with the workroom's messages. The ledger holds
 * only ids, so the text comes from the channel; a link whose message is gone
 * is kept with `text: null` rather than dropped, because "this mission was
 * shown a message that can no longer be read" is itself worth knowing.
 */
export function publicPeerMessages(
  mission: RecoveredMission,
  workroomMessages: ReadonlyMap<string, WorkroomMessage>
): readonly PublicPeerMessage[] {
  return mission.peerLinks.map((link) => {
    const message = workroomMessages.get(link.messageId)
    if (message === undefined) {
      const unknown = { teammateId: link.peerTeammateId, name: 'a teammate' }
      return {
        messageId: link.messageId,
        direction: link.direction,
        from: link.direction === 'received' ? unknown : { teammateId: '', name: '' },
        to: link.direction === 'received' ? { teammateId: '', name: '' } : unknown,
        text: null,
        at: link.occurredAt
      }
    }
    return {
      messageId: message.messageId,
      direction: link.direction,
      from: { teammateId: message.from.teammateId, name: message.from.name },
      to: { teammateId: message.to.teammateId, name: message.to.name },
      text: message.text,
      at: message.postedAt
    }
  })
}

/**
 * Which runtimes are still, as far as the record knows, at their limit.
 *
 * Per runtime, the latest event in time across all missions decides: a
 * `route.limit_detected` of kind `quota-exhausted` puts it at its limit, a
 * later `run.completed` on the same runtime takes it off. Same rule the
 * window applies live, applied to the ledger at boot so a reload does not
 * amount to a lie about the account.
 */
export function limitedRuntimesFrom(missions: readonly RecoveredMission[]): Record<string, string> {
  const latest = new Map<string, { readonly at: string; readonly said: string | undefined }>()
  for (const mission of missions) {
    for (const event of mission.events) {
      let said: string | undefined
      let relevant = false
      if (event.type === 'route.limit_detected' && event.payload.kind === 'quota-exhausted') {
        relevant = true
        said = event.payload.message
      } else if (event.type === 'run.completed') {
        relevant = true
      }
      if (!relevant) continue
      const runtime = event.sourceAdapter
      const current = latest.get(runtime)
      if (current === undefined || event.occurredAt > current.at) latest.set(runtime, { at: event.occurredAt, said })
    }
  }
  const limited: Record<string, string> = {}
  for (const [runtime, entry] of latest) {
    if (entry.said !== undefined) limited[runtime] = entry.said
  }
  return limited
}

/**
 * The latest still-allowed rate-limit reading per runtime, from the ledger,
 * so a reload does not forget what the route chip said. A limit that hit
 * (`route.limit_detected`) is the other map; this one is the number before it.
 */
export function usageWindowsFrom(missions: readonly RecoveredMission[]): Record<string, string> {
  const latest = new Map<string, { readonly at: string; readonly said: string }>()
  for (const mission of missions) {
    for (const event of mission.events) {
      if (event.type !== 'adapter.diagnostic' || !/\.usage_window$/.test(event.payload.code)) continue
      const runtime = event.sourceAdapter
      const current = latest.get(runtime)
      if (current === undefined || event.occurredAt > current.at) latest.set(runtime, { at: event.occurredAt, said: event.payload.message })
    }
  }
  const windows: Record<string, string> = {}
  // 0.406: with WHEN it was seen. A reading is only what the last run in
  // Locust reported; shown bare, last night's 20% read as now (Colin,
  // 2026-09-27: "my claude code usage hasnt seem to have updated").
  for (const [runtime, entry] of latest) windows[runtime] = `${entry.said} · from a run at ${entry.at}`
  return windows
}

/** A run's money as a row carries it: the amounts, not the moment. */
function amountsOf(money: RunMoney | undefined): Spend | undefined {
  if (money === undefined) return undefined
  return {
    ...(money.usd === undefined ? {} : { usd: money.usd }),
    ...(money.premiumRequests === undefined ? {} : { premiumRequests: money.premiumRequests })
  }
}

export function publicRecoveredMission(
  mission: RecoveredMission,
  workroomMessages: ReadonlyMap<string, WorkroomMessage> = new Map()
): PublicRecoveredMission {
  // Joined BEFORE the window, never after: windowing fragments is what lost
  // the front of a reply. See `joinMessageFragments`.
  const whole = joinMessageFragments(mission.events)
  const events = whole.length <= MAX_HISTORY_EVENTS
    ? whole
    : [whole[0], ...whole.slice(-(MAX_HISTORY_EVENTS - 1))]
        .filter((event) => event !== undefined)
  const hostFailureMessage = mission.hostFailures.at(-1)?.message
  const money = amountsOf(moneyOfRun(mission.events))
  return {
    missionId: mission.metadata.missionId,
    runId: mission.metadata.runId,
    // Which folder it ran in, so the shell can open the conversation that
    // belongs to the folder it was launched in.
    workspaceId: mission.metadata.workspaceId,
    prompt: mission.metadata.prompt,
    runtime: mission.metadata.runtime,
    model: mission.metadata.model,
    requestedRouteId: mission.metadata.requestedRouteId,
    resolvedRouteId: mission.metadata.resolvedRouteId,
    cliVersion: mission.metadata.cliVersion,
    sandbox: mission.metadata.sandbox,
    // What was ASKED for, beside what it was allowed. Without it a reopened
    // plan is indistinguishable from an ordinary read-only run -- the ledger
    // gained the field and the projection did not pass it on, which is the
    // half a unit test cannot see and a drive can (2026-09-06).
    ...(mission.metadata.mode === undefined ? {} : { mode: mission.metadata.mode }),
    createdAt: mission.metadata.createdAt,
    lastUpdatedAt: mission.lastUpdatedAt,
    phase: mission.phase,
    events,
    eventCount: mission.events.length,
    // Read from the WHOLE record, here, so a row sent without its events
    // still says what it cost: the window's totals were adding up the
    // newest twenty and calling it everything (2026-09-26).
    ...(money === undefined ? {} : { money }),
    // What the person is told about. Joining fragments loses nothing, so it
    // is not truncation; only the window below it drops anything.
    eventsTruncated: events.length !== whole.length,
    ...(hostFailureMessage === undefined ? {} : { hostFailureMessage }),
    integrityIssueCount: mission.issues.length,
    // Bounded projection: counts and causes, not the digest or the summary.
    checkpoints: mission.checkpoints.slice(-MAX_HISTORY_CHECKPOINTS).map((checkpoint) => ({
      epoch: checkpoint.epoch,
      reason: checkpoint.reason,
      resumeSafety: checkpoint.resumeSafety,
      safetyReason: checkpoint.safetyReason,
      createdAt: checkpoint.createdAt,
      unsettledActions: checkpoint.unsettledActions.map((action) => ({
        itemId: action.itemId,
        name: action.name
      }))
    })),
    peerMessages: publicPeerMessages(mission, workroomMessages),
    // Copied field by field, like everything else that leaves for the window.
    ...(mission.editChecks.at(-1) === undefined
      ? {}
      : {
          editCheck: {
            command: mission.editChecks.at(-1)!.command,
            outcome: mission.editChecks.at(-1)!.outcome,
            newLines: mission.editChecks.at(-1)!.newLines,
            unchanged: mission.editChecks.at(-1)!.unchanged,
            first: mission.editChecks.at(-1)!.first
          }
        }),
    ...(mission.metadata.continuesFrom === undefined
      ? {}
      : {
          continuesFrom: {
            missionId: mission.metadata.continuesFrom.missionId,
            checkpointEpoch: mission.metadata.continuesFrom.checkpointEpoch,
            reason: mission.metadata.continuesFrom.reason
          }
        }),
    // Copied by kind rather than spread: each carries a different counter, and
    // a spread would let a future field ride out to the renderer unreviewed.
    ...(mission.metadata.startedBy === undefined
      ? {}
      : mission.metadata.startedBy.kind === 'relay'
        ? { startedBy: { kind: 'relay' as const, hop: mission.metadata.startedBy.hop } }
        : mission.metadata.startedBy.kind === 'routine'
          ? {
              startedBy: {
                kind: 'routine' as const,
                routineId: mission.metadata.startedBy.routineId,
                step: mission.metadata.startedBy.step
              }
            }
          : mission.metadata.startedBy.kind === 'terminal'
            ? { startedBy: { kind: 'terminal' as const, exchange: mission.metadata.startedBy.exchange } }
            : { startedBy: { kind: 'resume' as const, epoch: mission.metadata.startedBy.epoch } })
  }
}

/*
 * `unreadableFileCount` lived here and is gone.
 *
 * It counted ledger files that raised an issue and yielded no mission, by
 * asking which issue ids were absent from `snapshot.missions`. That is right
 * only if `missions` is every mission the reader recovered -- and it is not:
 * `listMissions` slices it to a page. An older mission that recovered
 * perfectly and simply fell outside the twenty newest therefore had its issue
 * counted as a file that could not be read, and the screen said
 * "20 local - 1 file could not be read" about a ledger with nothing wrong.
 *
 * Found by Astra, 2026-09-09, in the fix I had just shipped for their previous
 * finding. Crying wolf is the same disease as false reassurance pointed the
 * other way, and it is worse here: a damage warning is only worth having if it
 * is rare enough to believe.
 *
 * The count now comes from `MissionLedgerSnapshot.unreadableCount`, computed
 * inside the reader from its parse results before any slicing -- the one place
 * where whether a file produced a mission is actually known.
 */

/**
 * Take missions until the response would exceed its byte budget. The first
 * mission is always included even if it alone is over budget: returning an
 * empty history for one large mission would look like "you have no missions",
 * which is a worse failure than a large payload.
 */
export function withinByteBudget(
  missions: readonly PublicRecoveredMission[],
  budget = MAX_HISTORY_BYTES
): readonly PublicRecoveredMission[] {
  return budgeted(missions, budget).map((entry) => entry.mission)
}

/** `withinByteBudget`, keeping each mission's JSON: the digest is taken from it. */
function budgeted(
  missions: readonly PublicRecoveredMission[],
  budget = MAX_HISTORY_BYTES
): readonly { readonly mission: PublicRecoveredMission; readonly json: string }[] {
  const kept: { readonly mission: PublicRecoveredMission; readonly json: string }[] = []
  let used = 0
  for (const mission of missions) {
    const json = JSON.stringify(mission)
    const size = Buffer.byteLength(json, 'utf8')
    if (kept.length > 0 && used + size > budget) break
    kept.push({ mission, json })
    used += size
  }
  return kept
}

/**
 * THE WINDOW ALREADY HAS MOST OF THIS.
 *
 * The history is read on every run end and every first open of a finished
 * conversation, and each read sent the newest twenty missions whole: 2.69 MB
 * a read on Colin's 138-mission ledger (Batch C, 2026-09-22), almost all of
 * it the same events as the read before. Structured-cloned across the IPC
 * boundary, parsed, and then handed to React as new objects -- so every
 * earlier turn on screen, memoised on its events since 0.262, was built
 * again for nothing.
 *
 * So a whole record carries a digest of itself as sent, the window hands the
 * digests of what it holds back with its next read, and a record whose
 * digest has not moved comes back with `events: []` and `eventsKept`. The
 * window keeps its own copy -- the same object, so nothing built from it is
 * rebuilt. The digest is of the PROJECTION, not the ledger file, because the
 * projection also carries what the workroom said, which changes on its own.
 */
export function missionDigest(json: string): string {
  return createHash('sha1').update(json, 'utf8').digest('hex').slice(0, 24)
}

/** How many held records a window may name in one read -- far past what one read returns. */
const MAX_KNOWN = 1000

/**
 * What the window says it holds, or nothing when it says it in a shape this
 * does not recognise. Anything odd is simply a full read: the only cost of
 * ignoring this is the bytes it would have saved.
 */
export function knownDigests(value: unknown): ReadonlyMap<string, string> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length === 0 || entries.length > MAX_KNOWN) return undefined
  const known = new Map<string, string>()
  for (const [missionId, digest] of entries) {
    if (typeof digest !== 'string' || digest.length === 0 || digest.length > 64 || missionId.length > 200) return undefined
    known.set(missionId, digest)
  }
  return known
}

/** Bound on the extra ledger reads one history call may do to find roots. */
const MAX_ANCESTOR_READS = 200

/**
 * The earlier turns of every conversation on the page, as IDENTITY ONLY.
 *
 * THE BUG THIS EXISTS FOR, and it is the worst kind this app has shipped:
 * a paging boundary was changing what a conversation IS.
 *
 * Colin, 2026-09-20, with a screenshot of an empty group: *"both my stonks
 * and research chats are gone out of the stonks group, probably autorenamed
 * and moved, def need this fixed"*. Nothing was moved and nothing was
 * renamed. His ledger had 58 missions; this call returns the 20 most recently
 * touched; and his stonks conversations began on 14 and 15 September, so
 * their EARLIEST turns fell off the page. The renderer builds a row by
 * walking `continuesFrom` back through the missions it was given, so with
 * those turns absent the walk stopped early and the row's `rootId` became a
 * later turn. Everything hangs off that id:
 *
 *   - the title is the ROOT's first sentence, so the row renamed itself to a
 *     mid-conversation prompt — "looks autorenamed";
 *   - a name he typed is stored against the root, so it stopped matching;
 *   - group membership is stored against the root, so `stonks` matched
 *     nothing and read "Nothing in here yet" — "looks moved".
 *
 * Three symptoms, one cause, and no data involved in any of them: the
 * ledgers and `groups.json` were intact the whole time. Measured against his
 * real files before a line was changed.
 *
 * WHY IDENTITY ONLY. The page is bounded by bytes because a mission carries
 * up to 500 events and some of those are megabytes; raising the count would
 * just move the cliff. But a row needs its ancestors' IDS AND PROMPTS, not
 * their transcripts — a few hundred bytes each — so these are projected with
 * `events` emptied and appended after the budget. They cost nothing and they
 * make the row's identity independent of where the page happened to cut.
 *
 * This is a floor, not the whole answer. The real fix is a compact
 * conversation list that is not the same payload as the thread, so the
 * sidebar stops being a side effect of how much transcript fits in one IPC
 * message. Until then a very old conversation can still be short of turns
 * when opened — but it is in the right group, under its own name.
 */
async function ancestorsOf(
  shown: readonly PublicRecoveredMission[],
  ledger: MissionLedger,
  workroomMessages: ReadonlyMap<string, WorkroomMessage>
): Promise<readonly PublicRecoveredMission[]> {
  const have = new Set(shown.map((mission) => mission.missionId))
  const wanted = shown.flatMap((mission) =>
    mission.continuesFrom === undefined ? [] : [mission.continuesFrom.missionId])
  const found: PublicRecoveredMission[] = []
  let reads = 0
  while (wanted.length > 0 && reads < MAX_ANCESTOR_READS) {
    const missionId = wanted.shift()
    if (missionId === undefined || have.has(missionId)) continue
    have.add(missionId)
    reads += 1
    let older
    try {
      older = await ledger.getMission(missionId)
    } catch {
      // A torn or missing ancestor ends this branch of the walk where it
      // stands. The row keeps whatever root it can reach, which is exactly
      // the old behaviour rather than a new failure.
      continue
    }
    if (older === undefined) continue
    found.push({ ...publicRecoveredMission(older, workroomMessages), events: [] })
    const next = older.metadata.continuesFrom?.missionId
    if (next !== undefined) wanted.push(next)
  }
  return found
}

/**
 * What one ledger file contributed to the last read, kept by the file's
 * identity so an unchanged file is never parsed twice.
 *
 * The history is asked for on every run end and every first open of a
 * finished conversation, and each ask parsed EVERY ledger file: 490-560 ms
 * on Colin's 138-mission ledger, measured in the app (2026-09-22), with the
 * main process slow to answer anything else meanwhile. Nearly every file is
 * the same as last time.
 *
 * Held LIGHT: a parsed ledger kept whole is 63.6 MB for that same ledger
 * (measured), so everything but the newest few keeps its record with the
 * events dropped, plus the numbers a row needs from them -- including what
 * the run cost, which the monthly totals read (`spendByTeammate`).
 */
interface CachedLedgerFile {
  readonly missionId: string
  readonly stamp: string
  readonly issues: number
  /** The record without its events; absent when the file produced no mission. */
  readonly light?: RecoveredMission
  readonly eventCount: number
  readonly eventsTruncated: boolean
  /** What the run cost in money, and when it ended; absent when it reported none. */
  readonly money?: RunMoney
  /** The whole record, kept only while it is among the newest. */
  full?: RecoveredMission
}

interface HistoryPage {
  /** Newest first: whole records for the first few, light ones after. */
  readonly missions: readonly {
    readonly mission: RecoveredMission
    readonly eventCount?: number
    readonly eventsTruncated?: boolean
    readonly money?: RunMoney
  }[]
  readonly issueCount: number
  readonly unreadableCount: number
}

const ledgerCaches = new WeakMap<MissionLedger, Map<string, CachedLedgerFile>>()

async function eachLimited<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next]
      next += 1
      if (item !== undefined) await work(item)
    }
  })
  await Promise.all(runners)
}

/**
 * Every ledger file's cached entry, brought up to date: a file that changed
 * since the last read is parsed again, one that is gone is forgotten.
 * Undefined for a ledger that cannot list its files (a test's fake).
 */
async function refreshedLedger(ledger: MissionLedger): Promise<{
  readonly cache: Map<string, CachedLedgerFile>
  readonly entries: readonly CachedLedgerFile[]
  readonly listingIssues: number
  readonly readMission: NonNullable<MissionLedger['readMission']>
} | undefined> {
  if (ledger.missionFiles === undefined || ledger.readMission === undefined) return undefined
  const readMission = ledger.readMission.bind(ledger)
  const cache = ledgerCaches.get(ledger) ?? new Map<string, CachedLedgerFile>()
  ledgerCaches.set(ledger, cache)
  const listing = await ledger.missionFiles()
  const present = new Set(listing.files.map((file) => file.missionId))
  for (const missionId of [...cache.keys()]) if (!present.has(missionId)) cache.delete(missionId)

  const read = async (missionId: string, stamp: string): Promise<void> => {
    const answer = await readMission(missionId)
    const mission = answer.mission
    if (mission === undefined) {
      cache.set(missionId, { missionId, stamp, issues: answer.issues.length, eventCount: 0, eventsTruncated: false })
      return
    }
    const money = moneyOfRun(mission.events)
    cache.set(missionId, {
      missionId,
      stamp,
      issues: answer.issues.length,
      light: { ...mission, events: [] },
      eventCount: mission.events.length,
      eventsTruncated: joinMessageFragments(mission.events).length > MAX_HISTORY_EVENTS,
      ...(money === undefined ? {} : { money }),
      full: mission
    })
  }
  const stampOf = (file: { readonly modifiedAt: number; readonly size: number }): string => `${String(file.modifiedAt)}:${String(file.size)}`
  const changed = listing.files.filter((file) => cache.get(file.missionId)?.stamp !== stampOf(file))
  await eachLimited(changed, 8, (file) => read(file.missionId, stampOf(file)))

  const entries = listing.files.flatMap((file) => {
    const entry = cache.get(file.missionId)
    return entry === undefined ? [] : [entry]
  })
  return { cache, entries, listingIssues: listing.issues.length, readMission }
}

/**
 * WHAT EACH TEAMMATE HAS SPENT IN ONE CALENDAR MONTH, from every
 * conversation the ledger holds -- not the newest twenty the window is sent.
 *
 * A run counts in the month it ENDED, on this machine's clock, toward the
 * teammate the host recorded it for (`missionOwners`); a run that belongs to
 * nobody counts toward nobody. Read through the same cache as the history,
 * so after the first read it costs a pass over a few hundred small entries.
 * Undefined when the ledger cannot be listed file by file.
 */
export async function spendByTeammate(
  ledger: MissionLedger,
  owners: Readonly<Record<string, string>>,
  month: string
): Promise<ReadonlyMap<string, Spend> | undefined> {
  const refreshed = await refreshedLedger(ledger)
  if (refreshed === undefined) return undefined
  const runs = new Map<string, Spend[]>()
  for (const entry of refreshed.entries) {
    const owner = owners[entry.missionId]
    if (owner === undefined || entry.money === undefined || monthOf(entry.money.at) !== month) continue
    runs.set(owner, [...(runs.get(owner) ?? []), entry.money])
  }
  const totals = new Map<string, Spend>()
  for (const [teammateId, list] of runs) {
    const total = sumSpend(list)
    if (total !== undefined) totals.set(teammateId, total)
  }
  return totals
}

async function cachedHistoryPage(ledger: MissionLedger, limit: number): Promise<HistoryPage | undefined> {
  const refreshed = await refreshedLedger(ledger)
  if (refreshed === undefined) return undefined
  const { entries, readMission } = refreshed
  const readable = entries
    .filter((entry): entry is CachedLedgerFile & { readonly light: RecoveredMission } => entry.light !== undefined)
    .sort((left, right) => Date.parse(right.light.lastUpdatedAt) - Date.parse(left.light.lastUpdatedAt))
    .slice(0, limit)
  // Whole records for the newest, and only for them.
  const newest = new Set(readable.slice(0, MAX_HISTORY_MISSIONS).map((entry) => entry.light.metadata.missionId))
  for (const entry of entries) {
    if (entry.light !== undefined && !newest.has(entry.light.metadata.missionId)) entry.full = undefined
  }
  // One that moved INTO the newest without changing (another was deleted)
  // has no whole record yet: read it again.
  await eachLimited(
    readable.filter((entry) => newest.has(entry.light.metadata.missionId) && entry.full === undefined),
    8,
    async (entry) => {
      const again = await readMission(entry.light.metadata.missionId)
      if (again.mission !== undefined) entry.full = again.mission
    }
  )
  return {
    missions: readable.map((entry) =>
      entry.full !== undefined
        ? { mission: entry.full }
        : {
            mission: entry.light,
            eventCount: entry.eventCount,
            eventsTruncated: entry.eventsTruncated,
            ...(entry.money === undefined ? {} : { money: entry.money })
          }
    ),
    issueCount: refreshed.listingIssues + entries.reduce((total, entry) => total + entry.issues, 0),
    unreadableCount: entries.filter((entry) => entry.light === undefined).length
  }
}

/**
 * H3: ONE MISSION, WHOLE. History sends the newest missions with their
 * events and every other one as a row, promising that opening it fetches
 * the rest (0.221.0) -- and nothing did, so an older conversation opened
 * with the person's own words and no replies. This is that fetch: the same
 * projection, the same workroom join, the same digest a history read gives.
 */
export async function readOneMission(ledger: MissionLedger, workroom: Workroom | undefined, missionId: unknown): Promise<MissionReadResponse> {
  const unavailable = { ok: false, error: { code: 'MISSION_UNAVAILABLE', message: 'That conversation could not be read from the local ledger.' } } as const
  if (typeof missionId !== 'string' || missionId.length === 0 || missionId.length > 200) return unavailable
  try {
    const recovered = await ledger.getMission(missionId)
    if (recovered === undefined) return unavailable
    const workroomMessages = new Map<string, WorkroomMessage>()
    if (workroom !== undefined) {
      try {
        for (const message of (await workroom.read()).messages) workroomMessages.set(message.messageId, message)
      } catch {
        // Unreadable peer messages show as such; the mission still opens.
      }
    }
    const mission = publicRecoveredMission(recovered, workroomMessages)
    return { ok: true, data: { mission: { ...mission, digest: missionDigest(JSON.stringify(mission)) } } }
  } catch {
    return unavailable
  }
}

/**
 * A conversation's newest turn, from any turn of it (0.391): the turns that
 * continue it, followed forward, the latest-made at each step. Through the
 * history's own cache, so it re-reads only files that changed. The turn named
 * when the ledger cannot be listed file by file.
 */
export async function newestTurnOf(ledger: MissionLedger, missionId: string): Promise<string> {
  const refreshed = await refreshedLedger(ledger)
  if (refreshed === undefined) return missionId
  const next = new Map<string, { readonly missionId: string; readonly createdAt: string }[]>()
  for (const entry of refreshed.entries) {
    const metadata = entry.light?.metadata
    const from = metadata?.continuesFrom?.missionId
    if (metadata === undefined || from === undefined) continue
    next.set(from, [...(next.get(from) ?? []), { missionId: metadata.missionId, createdAt: metadata.createdAt }])
  }
  const seen = new Set([missionId])
  let newest = missionId
  for (;;) {
    const later = (next.get(newest) ?? [])
      .filter((turn) => !seen.has(turn.missionId))
      .reduce<{ readonly missionId: string; readonly createdAt: string } | undefined>((best, turn) => (best === undefined || turn.createdAt > best.createdAt ? turn : best), undefined)
    if (later === undefined) return newest
    seen.add(later.missionId)
    newest = later.missionId
  }
}

export async function readMissionHistory(
  ledger: MissionLedger,
  workroom?: Workroom,
  /** The folder this window works in; defaults to the process's own. */
  workspacePath: string = process.cwd(),
  /** What the window already holds, `missionId -> digest` (see `missionDigest`). */
  known?: ReadonlyMap<string, string>
): Promise<MissionHistoryResponse> {
  try {
    // The kept page when the ledger can give one (see CachedLedgerFile);
    // the whole listing otherwise, which is what a test's fake ledger is.
    const page: HistoryPage =
      (await cachedHistoryPage(ledger, MAX_LISTED_MISSIONS)) ??
      (await ledger.listMissions({ limit: MAX_LISTED_MISSIONS }).then((snapshot) => ({
        missions: snapshot.missions.map((mission) => ({ mission })),
        issueCount: snapshot.issues.length,
        unreadableCount: snapshot.unreadableCount
      })))
    // The workroom is joined best-effort: a channel that cannot be read makes
    // every peer message show as unreadable, which is the truthful state, and
    // must not take the mission history down with it.
    const workroomMessages = new Map<string, WorkroomMessage>()
    if (workroom !== undefined) {
      try {
        for (const message of (await workroom.read()).messages) {
          workroomMessages.set(message.messageId, message)
        }
      } catch {
        // Every link then reads as `text: null`, which is what happened.
      }
    }
    /*
     * The newest few come whole, because those are the ones about to be
     * opened. Order is the reader's: most recently touched first.
     */
    const recent = page.missions.slice(0, MAX_HISTORY_MISSIONS).map((entry) => entry.mission)
    const shown = budgeted(recent.map((mission) => publicRecoveredMission(mission, workroomMessages))).map(
      ({ mission, json }): PublicRecoveredMission => {
        const digest = missionDigest(json)
        // Unchanged since the window last had it: the window keeps its own.
        return known?.get(mission.missionId) === digest
          ? { ...mission, events: [], digest, eventsKept: true }
          : { ...mission, digest }
      }
    )
    /*
     * And every OTHER conversation as a row and nothing else.
     *
     * `events: []` is the whole trick -- the same projection the ancestor
     * walk uses, for the same reason. Opening one of these fetches its
     * transcript; until then it costs a few hundred bytes and it EXISTS,
     * which is the difference between a conversation you have not opened in
     * a while and a conversation that is gone.
     *
     * Note the slice is from `shown.length`, not from MAX_HISTORY_MISSIONS:
     * the byte budget can cut the whole page short, and anything it dropped
     * must come back here as a row rather than vanish.
     */
    const listedOnly = page.missions.slice(shown.length).map((entry) => ({
      ...publicRecoveredMission(entry.mission, workroomMessages),
      events: [],
      // A light record has no events to count; the kept numbers say it.
      ...(entry.eventCount === undefined ? {} : { eventCount: entry.eventCount }),
      ...(entry.eventsTruncated === undefined ? {} : { eventsTruncated: entry.eventsTruncated }),
      // Nor to price: the money read when its file was parsed says it.
      ...(amountsOf(entry.money) === undefined ? {} : { money: amountsOf(entry.money)! })
    }))
    const listed = [...shown, ...listedOnly]
    return {
      ok: true,
      data: {
        missions: [...listed, ...(await ancestorsOf(listed, ledger, workroomMessages))],
        currentWorkspaceId: workspaceIdFor(workspacePath),
        issueCount: page.issueCount,
        // Straight from the reader. It used to be derived here by comparing
        // issue ids against the recovered missions, which is wrong the moment
        // that list is a page rather than the whole ledger -- see
        // `unreadableFileCount` for what that cost.
        unreadableCount: page.unreadableCount,
        // These two read EVENTS, so they see the missions that came with
        // events. Widening the list did not widen them: the answer is about
        // recent runs either way, and scanning three hundred transcripts to
        // decide whether a runtime is at its limit would be a new cost for no
        // new fact.
        limitedRuntimes: limitedRuntimesFrom(recent),
        usageWindows: usageWindowsFrom(recent)
      }
    }
  } catch {
    return {
      ok: false,
      error: {
        code: 'HISTORY_UNAVAILABLE',
        message: 'Local mission history could not be read.'
      }
    }
  }
}

/**
 * Delete a mission's record, unless it is still running.
 *
 * Deleting a live mission would orphan a process that keeps writing into a
 * file that no longer exists -- and it would take the person's only stop
 * control with it. So the answer is a refusal that names the remedy. Nothing
 * here touches the workroom: a deleted mission's messages stay, attributed,
 * because the person they were sent to still has a right to see them.
 */
export async function deleteMissionRecord(
  ledger: MissionLedger,
  missionId: unknown,
  isLive: (missionId: string) => boolean
): Promise<MissionDeleteResponse> {
  if (typeof missionId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(missionId)) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'That mission does not exist.' } }
  }
  if (isLive(missionId)) {
    return {
      ok: false,
      error: { code: 'LIVE', message: 'That mission is still running. Stop it first, then delete it.' }
    }
  }
  try {
    const removed = await ledger.deleteMission(missionId)
    return removed
      ? { ok: true }
      : { ok: false, error: { code: 'NOT_FOUND', message: 'That mission does not exist.' } }
  } catch {
    return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'The mission could not be deleted.' } }
  }
}
