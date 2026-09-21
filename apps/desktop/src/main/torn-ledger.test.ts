import { mkdtemp, open, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createElement } from 'react'
import type { ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFileMissionLedger, MISSION_LEDGER_SCHEMA_VERSION } from '@teammate/mission-store'
import type { MissionLedgerIssueCode, MissionLedgerMetadata } from '@teammate/mission-store'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { readMissionHistory } from './mission-history.js'
import { MISSION_HISTORY_CHANNEL } from '../shared/ipc.js'
import type { DesktopApi, MissionHistoryResponse, PublicRecoveredMission } from '../shared/ipc.js'

const transport = vi.hoisted(() => ({ invoke: vi.fn(), expose: vi.fn() }))
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: transport.expose },
  ipcRenderer: { invoke: transport.invoke, send: vi.fn(), on: vi.fn(), removeListener: vi.fn() } }))

const NOW = '2026-09-08T12:00:00.000Z'
const ID = 'mission_torn'
const roots: string[] = []
afterEach(async () => {
  transport.invoke.mockReset()
  // Only directories allocated by this file's mkdtemp, never a user profile.
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
const metadata: MissionLedgerMetadata = {
  missionId: ID, runId: 'run_torn', prompt: 'Read the scratch file.', runtime: 'codex', model: 'account-default',
  requestedRouteId: 'codex', resolvedRouteId: 'codex-account:default', cliVersion: 'test',
  workspaceId: 'ws_test', sandbox: 'read-only', executionPolicyVersion: 1, createdAt: NOW
}
// Hand-written wire records, not the ledger writer or normalizer: using the
// production writer here could make writer/reader bugs cancel each other out.
const events: readonly NormalizedRuntimeEvent[] = [1, 2, 3].map((sequence) => ({
  id: `event_${sequence}`, runId: 'run_torn', missionId: ID, sequence, occurredAt: NOW, sourceAdapter: 'codex',
  type: 'message.delta', payload: { itemId: `answer_${sequence}`, operation: 'append', text: `record ${sequence}`,
    final: false, evidence: { redacted: true } }
}))
const header = { schemaVersion: MISSION_LEDGER_SCHEMA_VERSION, recordType: 'mission.created', ledgerSequence: 1, occurredAt: NOW, metadata }
const records = events.map((event, index) => ({ schemaVersion: MISSION_LEDGER_SCHEMA_VERSION,
  recordType: 'mission.event', ledgerSequence: index + 2, occurredAt: NOW, event }))
const line = (value: unknown): string => JSON.stringify(value) + '\n'
const clean = line(header) + records.map(line).join('')
const prefix = line(header) + line(records[0])

interface Damage {
  readonly name: string
  readonly text: string
  readonly codes: readonly MissionLedgerIssueCode[]
  readonly surviving: number | null
  readonly oversized?: true
}
const shapes: readonly Damage[] = [
  { name: 'truncated final JSON', text: prefix + '{"recordType":"mission.event","event":', codes: ['truncated-tail'], surviving: 1 },
  { name: 'well-formed JSON with invalid record type', text: prefix + line({ ...records[1], recordType: 'not.a.record' }) + line(records[2]), codes: ['invalid-record'], surviving: 1 },
  { name: 'noncontiguous ledgerSequence', text: prefix + line({ ...records[1], ledgerSequence: 4 }) + line(records[2]), codes: ['invalid-record'], surviving: 1 },
  { name: 'malformed body followed by otherwise valid tail', text: prefix + '{broken\n' + line(records[1]) + line(records[2]), codes: ['invalid-record'], surviving: 1 },
  { name: 'malformed header', text: '{broken\n' + records.map(line).join(''), codes: ['invalid-record'], surviving: null },
  { name: 'over MAX_LEDGER_BYTES', text: clean, codes: ['file-too-large'], surviving: null, oversized: true },
  { name: 'well-formed invalid header', text: line({ ...header, ledgerSequence: 2 }) + records.map(line).join(''), codes: ['invalid-record'], surviving: null },
  { name: 'truncated header', text: '{"schemaVersion":', codes: ['truncated-tail', 'invalid-record'], surviving: null }
]

async function file(text: string, oversized = false) {
  const root = await mkdtemp(join(tmpdir(), 'locust-torn-proof-'))
  roots.push(root)
  const path = join(root, `${ID}.jsonl`)
  await writeFile(path, text, 'utf8')
  if (oversized) {
    const handle = await open(path, 'r+')
    try { await handle.truncate(64 * 1024 * 1024 + 1) } finally { await handle.close() }
    expect((await stat(path)).size).toBe(64 * 1024 * 1024 + 1)
  } else expect(await readFile(path, 'utf8')).toBe(text)
  return { root, path, ledger: createFileMissionLedger({ rootDirectory: root }) }
}

describe('physical torn ledger: reader contract', () => {
  it('clean control: all records survive with zero snapshot AND mission issues', async () => {
    const { ledger } = await file(clean)
    const snapshot = await ledger.listMissions()
    expect(snapshot.issues).toEqual([])
    expect(snapshot.missions).toHaveLength(1)
    expect(snapshot.missions[0]?.issues).toEqual([])
    expect(snapshot.missions[0]?.metadata).toEqual(metadata)
    expect(snapshot.missions[0]?.events).toEqual(events)
    expect(snapshot.missions[0]?.ledgerSequence).toBe(4)
  })

  it.each(shapes)('$name: exact prefix and exact issue codes, including rejected tail', async (shape) => {
    const { ledger } = await file(shape.text, shape.oversized)
    const snapshot = await ledger.listMissions()
    expect(snapshot.issues.map((issue) => issue.code)).toEqual(shape.codes)
    expect(snapshot.issues.map((issue) => issue.missionId)).toEqual(shape.codes.map(() => ID))
    if (shape.surviving === null) {
      expect(snapshot.missions).toEqual([])
      expect(await ledger.getMission(ID)).toBeUndefined()
    } else {
      expect(snapshot.missions).toHaveLength(1)
      const mission = snapshot.missions[0]!
      expect(mission.events).toEqual(events.slice(0, shape.surviving))
      expect(mission.ledgerSequence).toBe(shape.surviving + 1)
      expect(mission.issues).toEqual(snapshot.issues)
      expect(mission.hostFailures).toEqual([])
      expect(mission.checkpoints).toEqual([])
      expect(mission.peerLinks).toEqual([])
    }
  })
})

// Node-side integration test imports the actual TSX component at runtime.
// Paths come from this file, so root/package test invocations mean the same
// thing. No JSX compiler configuration or production component is changed.
interface ScreenProps {
  readonly missions: readonly PublicRecoveredMission[]
  readonly workspaceId: string | undefined
  readonly teammates: readonly []
  readonly missionOwners: Readonly<Record<string, string>>
  readonly runningMissionIds: ReadonlySet<string>
  readonly titleOf: (mission: PublicRecoveredMission) => string
  readonly onOpen: (id: string) => void
  readonly unreadableLedgers: number
  readonly ledgerUnreadable: boolean
}
const screenModule = await import(new URL('../renderer/src/components/Screens.tsx', import.meta.url).href) as { MissionsScreen: ComponentType<ScreenProps> }
await import('../preload/index.js')
const bridge = transport.expose.mock.calls[0]?.[1] as DesktopApi

async function throughPreload(response: MissionHistoryResponse) {
  transport.invoke.mockImplementationOnce(async (channel: string) => {
    expect(channel).toBe(MISSION_HISTORY_CHANNEL)
    // Simulate serialization, not actual Electron transport or sender validation.
    return structuredClone(response)
  })
  const received = await bridge.getMissionHistory()
  expect(received).toEqual(response)
  return received
}

function renderHistory(received: MissionHistoryResponse): string {
  // Mirror App's initial history response mapping, including its distinct
  // directory-failure flag. This is not an App mount: the real component is
  // rendered, while App's mapping is separately source-inspected in the report.
  return renderToStaticMarkup(createElement(screenModule.MissionsScreen, {
    missions: received.ok ? received.data.missions : [],
    workspaceId: received.ok ? received.data.currentWorkspaceId : undefined,
    unreadableLedgers: received.ok ? received.data.unreadableCount : 0,
    ledgerUnreadable: !received.ok,
    teammates: [], missionOwners: {}, runningMissionIds: new Set<string>(),
    titleOf: (mission) => mission.prompt, onOpen: () => undefined
  }))
}

async function displayed(text: string, oversized = false, cleanNeighbor = false) {
  const { ledger, root } = await file(text, oversized)
  if (cleanNeighbor) {
    // Separate physical file: a corrupt neighbor must not taint clean receipts.
    await writeFile(join(root, 'mission_clean.jsonl'), clean.replaceAll(ID, 'mission_clean'), 'utf8')
  }
  const snapshot = await ledger.listMissions()
  const response = await readMissionHistory(ledger, undefined, root)
  expect(response.ok).toBe(true)
  if (!response.ok) throw new Error('History failed instead of returning recoverable evidence')
  const received = await throughPreload(response)
  if (!received.ok) throw new Error('Preload dropped successful response')
  expect(received.data.issueCount).toBe(snapshot.issues.length)
  const html = renderHistory(received)
  return { html, snapshot, data: received.data }
}

describe('physical torn ledger: reader → history → preload → rendered Missions screen', () => {
  it('invalid header beside a clean ledger: clean receipt survives and unreadable file is visible', async () => {
    const result = await displayed('{broken\n', false, true)
    expect(result.snapshot.issues.map((issue) => issue.code)).toEqual(['invalid-record'])
    expect(result.data.issueCount).toBe(1)
    expect(result.data.unreadableCount).toBe(1)
    expect(result.snapshot.missions).toHaveLength(1)
    expect(result.snapshot.missions[0]?.issues).toEqual([])
    expect(result.data.missions.map((mission) => mission.missionId)).toEqual(['mission_clean'])
    expect(result.data.missions.map((mission) => mission.integrityIssueCount)).toEqual([0])
    expect(result.html).toContain('1 local, 0 in this folder · 1 file could not be read')
    expect(result.html).not.toContain('ledger verified')
    expect(result.html).not.toContain('with an incomplete receipt')
  })

  it('clean control: zero issues across the boundary and ledger verified on screen', async () => {
    const result = await displayed(clean)
    expect(result.snapshot.issues).toEqual([])
    expect(result.data.issueCount).toBe(0)
    expect(result.data.unreadableCount).toBe(0)
    expect(result.data.missions.map((mission) => mission.integrityIssueCount)).toEqual([0])
    expect(result.html).toContain('1 local, 0 in this folder · ledger verified')
    expect(result.html).not.toContain('with an incomplete receipt')
    expect(result.html).not.toContain('could not be read')
  })

  it.each(shapes.filter((shape) => shape.surviving !== null))('$name: issue becomes incomplete receipt wording', async (shape) => {
    const result = await displayed(shape.text)
    expect(result.snapshot.issues.map((issue) => issue.code)).toEqual(shape.codes)
    expect(result.data.issueCount).toBe(shape.codes.length)
    expect(result.data.unreadableCount).toBe(0)
    expect(result.data.missions.map((mission) => mission.integrityIssueCount)).toEqual([shape.codes.length])
    expect(result.data.missions[0]?.events).toEqual(events.slice(0, shape.surviving!))
    expect(result.html).toContain('1 local, 0 in this folder · 1 with an incomplete receipt')
    expect(result.html).not.toContain('ledger verified')
  })

  // Former KNOWN DEFECT cases now require the fixed contract. A truncated
  // header raises two issues but is ONE unreadable file, not two missing files.
  it.each(shapes.filter((shape) => shape.surviving === null))('$name: unreadable file count reaches the visible warning', async (shape) => {
    const result = await displayed(shape.text, shape.oversized)
    expect(result.snapshot.issues.map((issue) => issue.code)).toEqual(shape.codes)
    expect(result.data.issueCount).toBe(shape.codes.length)
    expect(result.data.unreadableCount).toBe(1)
    expect(result.data.missions).toEqual([])
    expect(result.html).toContain('0 local · 1 file could not be read')
    expect(result.html).not.toContain('ledger verified')
    expect(result.html).not.toContain('with an incomplete receipt')
  })

  it('directory failure: real file at mission-ledger path renders unavailable, not verified', async () => {
    const root = await mkdtemp(join(tmpdir(), 'locust-ledger-directory-proof-'))
    roots.push(root)
    const ledgerPath = join(root, 'mission-ledger')
    await writeFile(ledgerPath, 'blocking file, not a directory', 'utf8')
    const ledger = createFileMissionLedger({ rootDirectory: ledgerPath })
    // A real failed syscall, not a mock that invents HISTORY_UNAVAILABLE.
    await expect(ledger.listMissions()).rejects.toThrow()
    const response = await throughPreload(await readMissionHistory(ledger, undefined, root))
    expect(response).toEqual({ ok: false, error: {
      code: 'HISTORY_UNAVAILABLE', message: 'Local mission history could not be read.'
    } })
    const html = renderHistory(response)
    expect(html).toContain('0 local · the ledger could not be read')
    expect(html).not.toContain('ledger verified')
    expect(html).not.toContain('with an incomplete receipt')
    expect((await stat(ledgerPath)).isFile()).toBe(true)
    expect(await readFile(ledgerPath, 'utf8')).toBe('blocking file, not a directory')
  })

  it('mixed damage: two recovered incomplete receipts and one unreadable file remain separate', async () => {
    const { ledger, root } = await file(prefix + '{broken\n')
    await writeFile(join(root, 'mission_second.jsonl'), (prefix + '{broken\n').replaceAll(ID, 'mission_second'), 'utf8')
    await writeFile(join(root, 'mission_header.jsonl'), '{"schemaVersion":', 'utf8')
    const snapshot = await ledger.listMissions()
    expect(snapshot.missions).toHaveLength(2)
    expect(snapshot.issues.map((issue) => issue.code).sort()).toEqual([
      'invalid-record', 'invalid-record', 'invalid-record', 'truncated-tail'
    ])
    const response = await throughPreload(await readMissionHistory(ledger, undefined, root))
    expect(response.ok).toBe(true)
    if (!response.ok) throw new Error('Mixed history unexpectedly unavailable')
    expect(response.data.issueCount).toBe(4)
    expect(response.data.unreadableCount).toBe(1)
    expect(response.data.missions.map((mission) => mission.integrityIssueCount)).toEqual([1, 1])
    const html = renderHistory(response)
    expect(html).toContain('2 with an incomplete receipt · 1 file could not be read')
    expect(html).not.toContain('ledger verified')
  })

  /*
   * FIXED. This was Astra's KNOWN DEFECT and it is now the regression test.
   *
   * Absence from the limited page is not failure to recover. The count used to
   * ask which issue ids were missing from `snapshot.missions`, which is right
   * only if that list is every mission the reader recovered -- and it is a
   * PAGE. So an older mission that recovered its safe prefix perfectly and
   * merely fell outside the twenty newest was reported as a file that could
   * not be read: `20 local · 1 file could not be read`, over a ledger with
   * nothing wrong in it.
   *
   * The count now comes from `MissionLedgerSnapshot.unreadableCount`, computed
   * inside the reader from its parse results BEFORE any slicing -- the one
   * place where whether a file produced a mission is actually known.
   *
   * Their harness caught this on my fix for their previous finding, and the
   * expectations below are flipped exactly as their report said a future fix
   * should flip them.
   */
  it('does not call an older recoverable receipt unreadable when it falls off the page', async () => {
    const { ledger, root } = await file(prefix + '{broken\n')
    // The older damaged BODY is readable. Twenty newer clean missions put it
    // outside readMissionHistory's returned page, not outside recovery itself.
    for (let index = 0; index < 20; index += 1) {
      const id = `mission_new_${index}`
      await writeFile(join(root, `${id}.jsonl`), clean.replaceAll(ID, id)
        .replaceAll(NOW, '2026-09-09T12:00:00.000Z'), 'utf8')
    }
    const full = await ledger.listMissions({ limit: 30 })
    expect(full.missions).toHaveLength(21)
    expect(full.issues.map((issue) => issue.code)).toEqual(['invalid-record'])
    const older = await ledger.getMission(ID)
    expect(older?.events).toEqual(events.slice(0, 1))
    const response = await throughPreload(await readMissionHistory(ledger, undefined, root))
    expect(response.ok).toBe(true)
    if (!response.ok) throw new Error('Paged history unexpectedly unavailable')
    /*
     * TWENTY-ONE, and that is the fix rather than a slip.
     *
     * This asserted 20 because history used to return exactly one page, so
     * the older mission was absent -- which is the very thing that made
     * Colin's conversations vanish twice. Since `MAX_LISTED_MISSIONS` the
     * newest twenty come with their transcripts and everything else comes as
     * a ROW: present, named, groupable, no events.
     *
     * The claim this test is actually about is untouched: an older receipt
     * that recovered fine is not called unreadable.
     */
    expect(response.data.missions).toHaveLength(21)
    const rows = response.data.missions
    expect(rows.at(-1)?.missionId).toBe(ID)
    expect(rows.at(-1)?.events).toEqual([])
    // The twenty clean ones are clean. The older one is the torn file, and
    // its one bad record is a fact about it -- saying so on its row is the
    // opposite of the defect this test is named for, which was calling a
    // mission that RECOVERED unreadable.
    expect(rows.slice(0, 20).every((mission) => mission.integrityIssueCount === 0)).toBe(true)
    // Nothing failed to recover, so nothing is unreadable -- the assertion
    // Astra's report named as the one a fix should make true.
    expect(response.data.unreadableCount).toBe(0)
    const said = renderHistory(response)
    /*
     * "could not be read" is still WRONG and still absent -- the mission
     * recovered, which is the whole point of this test.
     *
     * But "ledger verified" is no longer right, and it only ever passed
     * because the torn mission was off the page. The file does carry one bad
     * record; now that the mission is listed, the header says so. A header
     * that reassures about a file it is not showing is the same class of
     * defect this test was written for, pointed the other way.
     */
    expect(said).not.toContain('could not be read')
    expect(said).not.toContain('ledger verified')
    expect(said).toContain('with an incomplete receipt')
  })
})
