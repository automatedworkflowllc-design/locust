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
import type { DesktopApi, PublicRecoveredMission } from '../shared/ipc.js'

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
}
const screenModule = await import(new URL('../renderer/src/components/Screens.tsx', import.meta.url).href) as { MissionsScreen: ComponentType<ScreenProps> }
await import('../preload/index.js')
const bridge = transport.expose.mock.calls[0]?.[1] as DesktopApi

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
  transport.invoke.mockImplementationOnce(async (channel: string) => {
    expect(channel).toBe(MISSION_HISTORY_CHANNEL)
    // Electron's process boundary is simulated explicitly; counts cannot ride
    // through by object identity or by retaining the private ledger object.
    return structuredClone(response)
  })
  const received = await bridge.getMissionHistory()
  expect(received).toEqual(response)
  if (!received.ok) throw new Error('Preload dropped successful response')
  expect(received.data.issueCount).toBe(snapshot.issues.length)
  const html = renderToStaticMarkup(createElement(screenModule.MissionsScreen, {
    missions: received.data.missions, workspaceId: received.data.currentWorkspaceId,
    teammates: [], missionOwners: {}, runningMissionIds: new Set<string>(), titleOf: (mission) => mission.prompt, onOpen: () => undefined
  }))
  return { html, snapshot, data: received.data }
}

describe('physical torn ledger: reader → history → preload → rendered Missions screen', () => {
  it('KNOWN DEFECT — invalid header beside a clean ledger: clean receipt survives but global warning is invisible', async () => {
    const result = await displayed('{broken\n', false, true)
    expect(result.snapshot.issues.map((issue) => issue.code)).toEqual(['invalid-record'])
    expect(result.data.issueCount).toBe(1)
    expect(result.snapshot.missions).toHaveLength(1)
    expect(result.snapshot.missions[0]?.issues).toEqual([])
    expect(result.data.missions.map((mission) => mission.missionId)).toEqual(['mission_clean'])
    expect(result.data.missions.map((mission) => mission.integrityIssueCount)).toEqual([0])
    expect(result.html).toContain('1 local, 0 in this folder · ledger verified')
    expect(result.html).not.toContain('with an incomplete receipt')
  })

  it('clean control: zero issues across the boundary and ledger verified on screen', async () => {
    const result = await displayed(clean)
    expect(result.snapshot.issues).toEqual([])
    expect(result.data.issueCount).toBe(0)
    expect(result.data.missions.map((mission) => mission.integrityIssueCount)).toEqual([0])
    expect(result.html).toContain('1 local, 0 in this folder · ledger verified')
    expect(result.html).not.toContain('with an incomplete receipt')
  })

  it.each(shapes.filter((shape) => shape.surviving !== null))('$name: issue becomes incomplete receipt wording', async (shape) => {
    const result = await displayed(shape.text)
    expect(result.snapshot.issues.map((issue) => issue.code)).toEqual(shape.codes)
    expect(result.data.issueCount).toBe(shape.codes.length)
    expect(result.data.missions.map((mission) => mission.integrityIssueCount)).toEqual([shape.codes.length])
    expect(result.data.missions[0]?.events).toEqual(events.slice(0, shape.surviving!))
    expect(result.html).toContain('1 local, 0 in this folder · 1 with an incomplete receipt')
    expect(result.html).not.toContain('ledger verified')
  })

  // Characterization, NOT desired behavior. These green checks deliberately
  // pin the observed defect so the report cannot hide it behind reader success.
  it.each(shapes.filter((shape) => shape.surviving === null))('KNOWN DEFECT — $name: global issue survives, but screen says verified', async (shape) => {
    const result = await displayed(shape.text, shape.oversized)
    expect(result.snapshot.issues.map((issue) => issue.code)).toEqual(shape.codes)
    expect(result.data.issueCount).toBe(shape.codes.length)
    expect(result.data.missions).toEqual([])
    expect(result.html).toContain('0 local · ledger verified')
    expect(result.html).not.toContain('with an incomplete receipt')
  })
})
