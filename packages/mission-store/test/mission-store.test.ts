import {
  createCodexEventNormalizer
} from '@teammate/runtime-adapters'
import type {
  NormalizedRuntimeEvent,
  RuntimeProcessCompletion
} from '@teammate/runtime-adapters'
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createFileMissionLedger,
  MISSION_LEDGER_SCHEMA_VERSION
} from '../src/index.js'
import type { MissionLedgerMetadata } from '../src/index.js'

const NOW = '2026-08-31T16:00:00.000Z'
const roots: string[] = []

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'teammate-mission-ledger-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function metadata(overrides: Partial<MissionLedgerMetadata> = {}): MissionLedgerMetadata {
  return {
    missionId: 'mission_1',
    runId: 'run_1',
    prompt: 'Inspect the workspace without changing it.',
    runtime: 'codex',
    model: 'account-default',
    requestedRouteId: 'codex',
    resolvedRouteId: 'codex-account:default',
    cliVersion: '0.151.0-alpha.7.2',
    workspaceId: 'ws_test',
    sandbox: 'read-only',
    executionPolicyVersion: 1,
    createdAt: NOW,
    ...overrides
  }
}

function completion(overrides: Partial<RuntimeProcessCompletion> = {}): RuntimeProcessCompletion {
  return {
    exitCode: 0,
    signal: null,
    stderr: '',
    stderrTruncated: false,
    recordCount: 3,
    cancelled: false,
    forcedTerminationAttempted: false,
    terminationUnconfirmed: false,
    inputDeliveryFailed: false,
    outputLimitExceeded: false,
    startedAt: NOW,
    finishedAt: NOW,
    ...overrides
  }
}

function successfulEvents(): readonly NormalizedRuntimeEvent[] {
  const normalizer = createCodexEventNormalizer({
    runId: 'run_1',
    missionId: 'mission_1',
    requestedRouteId: 'codex',
    resolvedRouteId: 'codex-account:default',
    cliVersion: '0.151.0-alpha.7.2',
    now: () => new Date(NOW)
  })
  const events = [
    ...normalizer.accept({ sequence: 1, raw: JSON.stringify({ type: 'thread.started', thread_id: 'thread_1' }) }),
    ...normalizer.accept({
      sequence: 2,
      raw: JSON.stringify({
        type: 'item.completed',
        item: { id: 'answer', type: 'agent_message', text: 'Durable result' }
      })
    }),
    ...normalizer.accept({ sequence: 3, raw: JSON.stringify({ type: 'turn.completed' }) }),
    ...normalizer.finish(completion())
  ]
  return events
}

describe('file mission ledger', () => {
  it('persists a versioned append-only mission and recovers its terminal phase', async () => {
    const root = await temporaryRoot()
    const ledger = createFileMissionLedger({ rootDirectory: root })
    const events = successfulEvents()

    await ledger.createMission(metadata())
    await ledger.appendEvents('mission_1', events.slice(0, 2))
    await ledger.appendEvents('mission_1', events.slice(2))
    const snapshot = await ledger.listMissions()

    expect(snapshot.issues).toEqual([])
    expect(snapshot.missions).toHaveLength(1)
    expect(snapshot.missions[0]).toMatchObject({
      metadata: metadata(),
      phase: 'completed',
      ledgerSequence: events.length + 1,
      events
    })
    const lines = (await readFile(join(root, 'mission_1.jsonl'), 'utf8')).trimEnd().split('\n')
    expect(lines).toHaveLength(events.length + 1)
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      schemaVersion: MISSION_LEDGER_SCHEMA_VERSION,
      recordType: 'mission.created',
      ledgerSequence: 1
    })
    expect(lines.map((line) => JSON.parse(line).ledgerSequence)).toEqual(
      Array.from({ length: events.length + 1 }, (_, index) => index + 1)
    )
  })

  it('serializes concurrent appends without losing ledger or event order', async () => {
    const root = await temporaryRoot()
    const ledger = createFileMissionLedger({ rootDirectory: root })
    const events = successfulEvents()
    await ledger.createMission(metadata())

    await Promise.all([
      ledger.appendEvents('mission_1', events.slice(0, 2)),
      ledger.appendEvents('mission_1', events.slice(2))
    ])

    const recoveredLedger = createFileMissionLedger({ rootDirectory: root })
    const recovered = await recoveredLedger.getMission('mission_1')
    expect(recovered?.events.map((event) => event.sequence)).toEqual([1, 2, 3, 4])
    expect(recovered?.phase).toBe('completed')
  })

  it('rejects a mismatched or noncontiguous event before writing it', async () => {
    const root = await temporaryRoot()
    const ledger = createFileMissionLedger({ rootDirectory: root })
    const [first, second] = successfulEvents()
    await ledger.createMission(metadata())
    if (first === undefined || second === undefined) throw new Error('Fixture events missing')

    await expect(ledger.appendEvents('mission_1', [{ ...second, sequence: 2 }])).rejects.toThrow(
      'Mission event sequence is invalid'
    )
    await expect(ledger.appendEvents('mission_1', [{ ...first, missionId: 'mission_other' }])).rejects.toThrow(
      'Mission event correlation is invalid'
    )
    expect((await ledger.getMission('mission_1'))?.events).toEqual([])
  })

  it('ignores an incomplete crash tail and reports the recovered prefix', async () => {
    const root = await temporaryRoot()
    const ledger = createFileMissionLedger({ rootDirectory: root })
    const events = successfulEvents()
    await ledger.createMission(metadata())
    await ledger.appendEvents('mission_1', events.slice(0, 2))
    await appendFile(join(root, 'mission_1.jsonl'), '{"schemaVersion":1,"recordType":"mission.event"', 'utf8')

    const recoveredLedger = createFileMissionLedger({ rootDirectory: root })
    const recovered = await recoveredLedger.getMission('mission_1')
    expect(recovered?.events).toHaveLength(2)
    expect(recovered?.phase).toBe('interrupted')
    expect(recovered?.issues).toContainEqual(expect.objectContaining({ code: 'truncated-tail' }))
    await expect(recoveredLedger.appendEvents('mission_1', events.slice(2))).rejects.toThrow(
      'Mission ledger is unavailable'
    )
  })

  it('records a generic host launch failure as a failed recovered mission', async () => {
    const root = await temporaryRoot()
    const ledger = createFileMissionLedger({ rootDirectory: root })
    await ledger.createMission(metadata())
    await ledger.appendHostFailure('mission_1', {
      code: 'runtime-start-failed',
      message: 'The Codex process could not be started safely.',
      occurredAt: NOW
    })

    const recovered = await ledger.getMission('mission_1')
    expect(recovered?.phase).toBe('failed')
    expect(recovered?.hostFailures).toEqual([{
      code: 'runtime-start-failed',
      message: 'The Codex process could not be started safely.',
      occurredAt: NOW
    }])
  })

  it('does not trust unsupported or malformed ledger files', async () => {
    const root = await temporaryRoot()
    await writeFile(join(root, 'mission_future.jsonl'), `${JSON.stringify({
      schemaVersion: 99,
      recordType: 'mission.created',
      ledgerSequence: 1,
      metadata: metadata({ missionId: 'mission_future', runId: 'run_future' })
    })}\n`, 'utf8')
    await writeFile(join(root, 'mission_malformed.jsonl'), 'not-json\n', 'utf8')
    const ledger = createFileMissionLedger({ rootDirectory: root })

    const snapshot = await ledger.listMissions()
    expect(snapshot.missions).toEqual([])
    expect(snapshot.issues.map(({ code }) => code).sort()).toEqual([
      'invalid-record',
      'unsupported-schema'
    ])
  })
it('stops recovery at a noncontiguous body record and refuses to extend the corrupt ledger', async () => {
    const root = await temporaryRoot()
    const ledger = createFileMissionLedger({ rootDirectory: root })
    const events = successfulEvents()
    await ledger.createMission(metadata())
    await ledger.appendEvents('mission_1', events.slice(0, 2))
    await appendFile(join(root, 'mission_1.jsonl'), `${JSON.stringify({
      schemaVersion: MISSION_LEDGER_SCHEMA_VERSION,
      recordType: 'mission.event',
      ledgerSequence: 5,
      occurredAt: NOW,
      event: events[2]
    })}
`, 'utf8')

    const recoveredLedger = createFileMissionLedger({ rootDirectory: root })
    const recovered = await recoveredLedger.getMission('mission_1')
    expect(recovered?.events).toHaveLength(2)
    expect(recovered?.ledgerSequence).toBe(3)
    expect(recovered?.issues).toContainEqual(expect.objectContaining({ code: 'invalid-record' }))
    await expect(recoveredLedger.appendEvents('mission_1', events.slice(2))).rejects.toThrow(
      'Mission ledger is unavailable'
    )
  })

  it('detects external modification on append and fails closed afterwards', async () => {
    const root = await temporaryRoot()
    const ledger = createFileMissionLedger({ rootDirectory: root })
    const events = successfulEvents()
    await ledger.createMission(metadata())
    await ledger.appendEvents('mission_1', events.slice(0, 2))
    await appendFile(join(root, 'mission_1.jsonl'), `{"intruder":true}
`, 'utf8')

    await expect(ledger.appendEvents('mission_1', events.slice(2, 3))).rejects.toThrow(
      'Mission ledger changed outside the active writer'
    )
    // The failed append dropped its cached offsets, so the retry re-reads the
    // file, sees the foreign record, and still refuses to extend the ledger.
    await expect(ledger.appendEvents('mission_1', events.slice(2, 3))).rejects.toThrow(
      'Mission ledger is unavailable'
    )
    const recovered = await ledger.getMission('mission_1')
    expect(recovered?.events).toHaveLength(2)
    expect(recovered?.issues).toContainEqual(expect.objectContaining({ code: 'invalid-record' }))
  })

  it('orders history by recency and honors the list limit', async () => {
    const root = await temporaryRoot()
    const ledger = createFileMissionLedger({ rootDirectory: root })
    await ledger.createMission(metadata({ missionId: 'mission_a', runId: 'run_a', createdAt: '2026-08-31T10:00:00.000Z' }))
    await ledger.createMission(metadata({ missionId: 'mission_b', runId: 'run_b', createdAt: '2026-08-31T12:00:00.000Z' }))
    await ledger.createMission(metadata({ missionId: 'mission_c', runId: 'run_c', createdAt: '2026-08-31T11:00:00.000Z' }))

    const limited = await ledger.listMissions({ limit: 2 })
    expect(limited.missions.map((mission) => mission.metadata.missionId)).toEqual(['mission_b', 'mission_c'])
    const all = await ledger.listMissions()
    expect(all.missions.map((mission) => mission.metadata.missionId)).toEqual(['mission_b', 'mission_c', 'mission_a'])
  })
  it('refuses an event its own reader would reject, rather than truncating recovery later', async () => {
    const root = await temporaryRoot()
    const ledger = createFileMissionLedger({ rootDirectory: root })
    const events = successfulEvents()
    // A message event is the one the reader constrains hardest: itemId is
    // capped at 512 characters and no persisted string may contain NUL.
    const message = events.find((event) => event.type === 'message.delta')
    if (message === undefined) throw new Error('Fixture message event missing')
    await ledger.createMission(metadata())

    const oversizedIdentity = {
      ...message,
      sequence: 1,
      payload: { ...message.payload, itemId: 'x'.repeat(513) }
    } as typeof message
    const nulBearing = {
      ...message,
      sequence: 1,
      payload: { ...message.payload, text: `answer${String.fromCharCode(0)}` }
    } as typeof message

    await expect(ledger.appendEvents('mission_1', [oversizedIdentity])).rejects.toThrow(
      'Mission event is not readable by the ledger reader'
    )
    await expect(ledger.appendEvents('mission_1', [nulBearing])).rejects.toThrow(
      'Mission event is not readable by the ledger reader'
    )

    // Nothing was written, so the mission is still appendable and still whole.
    expect((await ledger.getMission('mission_1'))?.events).toEqual([])
    await ledger.appendEvents('mission_1', events)
    const recovered = await ledger.getMission('mission_1')
    expect(recovered?.events).toHaveLength(events.length)
    expect(recovered?.phase).toBe('completed')
    expect(recovered?.issues).toEqual([])
  })
})
