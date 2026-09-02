import { createCodexEventNormalizer } from '@teammate/runtime-adapters'
import type { NormalizedRuntimeEvent, RuntimeProcessCompletion } from '@teammate/runtime-adapters'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  createFileMissionLedger,
  MISSION_LEDGER_SCHEMA_VERSION,
  SUPPORTED_MISSION_LEDGER_SCHEMA_VERSIONS
} from '../src/index.js'
import type { MissionLedgerMetadata } from '../src/index.js'

const NOW = '2026-08-31T16:00:00.000Z'
const roots: string[] = []

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'teammate-schema-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function v1Metadata(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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

function completion(): RuntimeProcessCompletion {
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
    finishedAt: NOW
  }
}

function codexEvents(): readonly NormalizedRuntimeEvent[] {
  const codex = createCodexEventNormalizer({
    runId: 'run_1',
    missionId: 'mission_1',
    requestedRouteId: 'codex',
    resolvedRouteId: 'codex-account:default',
    cliVersion: '0.151.0-alpha.7.2',
    now: () => new Date(NOW)
  })
  return [
    ...codex.accept({ sequence: 1, raw: JSON.stringify({ type: 'thread.started', thread_id: 'thread_1' }) }),
    ...codex.accept({
      sequence: 2,
      raw: JSON.stringify({
        type: 'item.completed',
        item: { id: 'answer', type: 'agent_message', text: 'Durable result' }
      })
    }),
    ...codex.accept({ sequence: 3, raw: JSON.stringify({ type: 'turn.completed' }) }),
    ...codex.finish(completion())
  ]
}

/** A ledger file exactly as version 1 of this package wrote them. */
async function writeV1Ledger(
  root: string,
  events: readonly NormalizedRuntimeEvent[],
  metadataOverrides: Record<string, unknown> = {}
): Promise<string> {
  const metadata = v1Metadata(metadataOverrides)
  const lines = [
    JSON.stringify({
      schemaVersion: 1,
      recordType: 'mission.created',
      ledgerSequence: 1,
      occurredAt: metadata.createdAt,
      metadata
    }),
    ...events.map((event, index) =>
      JSON.stringify({
        schemaVersion: 1,
        recordType: 'mission.event',
        ledgerSequence: index + 2,
        occurredAt: event.occurredAt,
        event
      })
    )
  ]
  const path = join(root, 'mission_1.jsonl')
  await writeFile(path, `${lines.join('\n')}\n`, 'utf8')
  return path
}

describe('ledger schema versions', () => {
  it('writes new missions at the current version', async () => {
    const root = await temporaryRoot()
    const ledger = createFileMissionLedger({ rootDirectory: root })
    await ledger.createMission({
      ...v1Metadata()
    } as unknown as MissionLedgerMetadata)

    const header = JSON.parse((await readFile(join(root, 'mission_1.jsonl'), 'utf8')).split('\n')[0] ?? '{}')

    expect(MISSION_LEDGER_SCHEMA_VERSION).toBe(6)
    expect(header.schemaVersion).toBe(6)
    expect(SUPPORTED_MISSION_LEDGER_SCHEMA_VERSIONS).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('still recovers a mission recorded before the version bump', async () => {
    const root = await temporaryRoot()
    const events = codexEvents()
    await writeV1Ledger(root, events)

    const recovered = await createFileMissionLedger({ rootDirectory: root }).getMission('mission_1')

    // The whole point of the compatibility list: a version bump must not read
    // to a user as their history disappearing.
    expect(recovered?.issues).toEqual([])
    expect(recovered?.phase).toBe('completed')
    expect(recovered?.events).toHaveLength(events.length)
    expect(recovered?.metadata.runtime).toBe('codex')
  })

  it('appends to a version-1 mission in version 1, keeping the file walkable', async () => {
    const root = await temporaryRoot()
    const events = codexEvents()
    await writeV1Ledger(root, events.slice(0, 2))

    const ledger = createFileMissionLedger({ rootDirectory: root })
    await ledger.appendEvents('mission_1', events.slice(2))

    const lines = (await readFile(join(root, 'mission_1.jsonl'), 'utf8')).trimEnd().split('\n')
    // A v2 record inside a v1 file would stop recovery at the first one, so the
    // appended half of the mission would vanish on the next launch.
    expect(lines.map((line) => JSON.parse(line).schemaVersion)).toEqual(lines.map(() => 1))

    const recovered = await createFileMissionLedger({ rootDirectory: root }).getMission('mission_1')
    expect(recovered?.issues).toEqual([])
    expect(recovered?.events).toHaveLength(events.length)
    expect(recovered?.phase).toBe('completed')
  })

  it('stops recovery when a record disagrees with its file version', async () => {
    const root = await temporaryRoot()
    const events = codexEvents()
    await writeV1Ledger(root, events)
    const lines = (await readFile(join(root, 'mission_1.jsonl'), 'utf8')).trimEnd().split('\n')
    const third = JSON.parse(lines[2] ?? '{}')
    third.schemaVersion = 2
    lines[2] = JSON.stringify(third)
    await writeFile(join(root, 'mission_1.jsonl'), `${lines.join('\n')}\n`, 'utf8')

    const recovered = await createFileMissionLedger({ rootDirectory: root }).getMission('mission_1')

    expect(recovered?.events).toHaveLength(1)
    expect(recovered?.issues.map((issue) => issue.code)).toContain('invalid-record')
  })

  it('refuses a version-1 file describing a runtime version 1 could not write', async () => {
    const root = await temporaryRoot()
    await writeV1Ledger(root, [], { runtime: 'claude' })

    const recovered = await createFileMissionLedger({ rootDirectory: root }).getMission('mission_1')

    expect(recovered).toBeUndefined()
  })

  it('refuses a pre-v4 file claiming to continue another mission', async () => {
    const root = await temporaryRoot()
    // No writer before v4 could produce a continuation, so a v1 file carrying
    // one was hand-edited. Reading it would let an invented link decide which
    // missions the UI stitches together as one piece of work.
    await writeV1Ledger(root, [], {
      continuesFrom: { missionId: 'mission_other', checkpointEpoch: 1, reason: 'route-switch' }
    })

    const recovered = await createFileMissionLedger({ rootDirectory: root }).getMission('mission_1')

    expect(recovered).toBeUndefined()
  })

  it('round-trips a continuation through the durable record', async () => {
    const root = await temporaryRoot()
    const ledger = createFileMissionLedger({ rootDirectory: root })
    await ledger.createMission({
      ...v1Metadata({
        continuesFrom: { missionId: 'mission_before', checkpointEpoch: 2, reason: 'route-switch' }
      })
    } as unknown as MissionLedgerMetadata)

    const recovered = await createFileMissionLedger({ rootDirectory: root }).getMission('mission_1')

    expect(recovered?.issues).toEqual([])
    expect(recovered?.metadata.continuesFrom).toEqual({
      missionId: 'mission_before',
      checkpointEpoch: 2,
      reason: 'route-switch'
    })
  })

  it('refuses a continuation that names an unsafe mission id', async () => {
    const root = await temporaryRoot()
    const ledger = createFileMissionLedger({ rootDirectory: root })

    // A path-traversing id in a continuation is the same hazard as one in a
    // mission id: it decides which file a reader is pointed at.
    await expect(ledger.createMission({
      ...v1Metadata({
        continuesFrom: { missionId: '../escape', checkpointEpoch: 1, reason: 'route-switch' }
      })
    } as unknown as MissionLedgerMetadata)).rejects.toThrow()
  })

  it('refuses a continuation with an impossible checkpoint epoch', async () => {
    const root = await temporaryRoot()
    const ledger = createFileMissionLedger({ rootDirectory: root })

    // Epochs start at 1. A zero would point at a checkpoint that never existed.
    await expect(ledger.createMission({
      ...v1Metadata({
        continuesFrom: { missionId: 'mission_before', checkpointEpoch: 0, reason: 'route-switch' }
      })
    } as unknown as MissionLedgerMetadata)).rejects.toThrow()
  })

  it('round-trips a peer link through the durable record', async () => {
    const root = await temporaryRoot()
    const ledger = createFileMissionLedger({ rootDirectory: root })
    await ledger.createMission({ ...v1Metadata() } as unknown as MissionLedgerMetadata)
    await ledger.appendPeerLinks('mission_1', [
      { direction: 'received', messageId: 'wm_1', peerTeammateId: 'tm_atlas', occurredAt: NOW },
      { direction: 'posted', messageId: 'wm_2', peerTeammateId: 'tm_atlas', occurredAt: NOW }
    ])

    const recovered = await createFileMissionLedger({ rootDirectory: root }).getMission('mission_1')

    expect(recovered?.issues).toEqual([])
    expect(recovered?.peerLinks).toEqual([
      { direction: 'received', messageId: 'wm_1', peerTeammateId: 'tm_atlas', occurredAt: NOW },
      { direction: 'posted', messageId: 'wm_2', peerTeammateId: 'tm_atlas', occurredAt: NOW }
    ])
    expect(recovered?.ledgerSequence).toBe(3)
  })

  it('refuses a peer link in a file written before version 5', async () => {
    const root = await temporaryRoot()
    // No writer before v5 could produce one. A v1 file carrying a peer link
    // was hand-edited, and reading it would let an invented cross-reference
    // decide which workroom message a mission is shown as having received.
    await writeV1Ledger(root, [])
    await writeFile(
      join(root, 'mission_1.jsonl'),
      `${JSON.stringify({
        schemaVersion: 1,
        recordType: 'mission.peer',
        ledgerSequence: 2,
        occurredAt: NOW,
        link: { direction: 'received', messageId: 'wm_1', peerTeammateId: 'tm_atlas', occurredAt: NOW }
      })}\n`,
      { flag: 'a' }
    )

    const recovered = await createFileMissionLedger({ rootDirectory: root }).getMission('mission_1')

    expect(recovered?.peerLinks).toEqual([])
    expect(recovered?.issues.map((issue) => issue.code)).toEqual(['invalid-record'])
  })

  it('refuses to append a peer link to a mission written before version 5', async () => {
    const root = await temporaryRoot()
    await writeV1Ledger(root, [])
    const ledger = createFileMissionLedger({ rootDirectory: root })

    // The file's version is fixed by its header; a record its own readers stop
    // at must not be written into it.
    await expect(ledger.appendPeerLinks('mission_1', [
      { direction: 'received', messageId: 'wm_1', peerTeammateId: 'tm_atlas', occurredAt: NOW }
    ])).rejects.toThrow('cannot hold peer links')
  })

  it('refuses a peer link with an unsafe id or an unknown direction', async () => {
    const root = await temporaryRoot()
    const ledger = createFileMissionLedger({ rootDirectory: root })
    await ledger.createMission({ ...v1Metadata() } as unknown as MissionLedgerMetadata)

    await expect(ledger.appendPeerLinks('mission_1', [
      { direction: 'received', messageId: '../escape', peerTeammateId: 'tm_atlas', occurredAt: NOW }
    ])).rejects.toThrow()
    await expect(ledger.appendPeerLinks('mission_1', [
      { direction: 'broadcast' as 'posted', messageId: 'wm_1', peerTeammateId: 'tm_atlas', occurredAt: NOW }
    ])).rejects.toThrow()
  })

  it('round-trips a follow-up continuation, session handle and all', async () => {
    const root = await temporaryRoot()
    const ledger = createFileMissionLedger({ rootDirectory: root })
    await ledger.createMission({
      ...v1Metadata({
        continuesFrom: {
          missionId: 'mission_before',
          checkpointEpoch: 1,
          reason: 'follow-up',
          runtimeThreadId: 'session-abc'
        }
      })
    } as unknown as MissionLedgerMetadata)

    const recovered = await createFileMissionLedger({ rootDirectory: root }).getMission('mission_1')

    expect(recovered?.issues).toEqual([])
    expect(recovered?.metadata.continuesFrom).toEqual({
      missionId: 'mission_before',
      checkpointEpoch: 1,
      reason: 'follow-up',
      runtimeThreadId: 'session-abc'
    })
  })

  it('refuses a follow-up in a file written before version 6', async () => {
    const root = await temporaryRoot()
    // No writer before v6 could call a continuation a follow-up, so a v1 file
    // saying so was hand-edited -- and believing it would draw an ordinary
    // reply as though it continued some other conversation.
    await writeV1Ledger(root, [], {
      continuesFrom: { missionId: 'mission_other', checkpointEpoch: 1, reason: 'follow-up' }
    })

    const recovered = await createFileMissionLedger({ rootDirectory: root }).getMission('mission_1')

    expect(recovered).toBeUndefined()
  })

  it('refuses a continuation reason it does not know', async () => {
    const root = await temporaryRoot()
    const ledger = createFileMissionLedger({ rootDirectory: root })
    await expect(ledger.createMission({
      ...v1Metadata({
        continuesFrom: { missionId: 'mission_before', checkpointEpoch: 1, reason: 'guessed' }
      })
    } as unknown as MissionLedgerMetadata)).rejects.toThrow()
  })

  it('rejects a file whose version this reader does not know', async () => {
    const root = await temporaryRoot()
    const metadata = v1Metadata()
    await writeFile(
      join(root, 'mission_1.jsonl'),
      `${JSON.stringify({
        // One past the newest this reader knows. Bump when the schema does.
        schemaVersion: 7,
        recordType: 'mission.created',
        ledgerSequence: 1,
        occurredAt: metadata.createdAt,
        metadata
      })}\n`,
      'utf8'
    )

    const snapshot = await createFileMissionLedger({ rootDirectory: root }).listMissions()

    expect(snapshot.issues.map((issue) => issue.code)).toContain('unsupported-schema')
    expect(snapshot.missions).toEqual([])
  })
})

describe('runtime agreement', () => {
  it('accepts a Claude mission and its Claude events', async () => {
    const root = await temporaryRoot()
    const ledger = createFileMissionLedger({ rootDirectory: root })
    await ledger.createMission({
      ...v1Metadata({ runtime: 'claude', model: 'claude-sonnet-5', requestedRouteId: 'claude' })
    } as unknown as MissionLedgerMetadata)

    const claudeEvent = {
      ...codexEvents()[0],
      sourceAdapter: 'claude'
    } as unknown as NormalizedRuntimeEvent
    await ledger.appendEvents('mission_1', [claudeEvent])

    const recovered = await createFileMissionLedger({ rootDirectory: root }).getMission('mission_1')
    expect(recovered?.issues).toEqual([])
    expect(recovered?.metadata.runtime).toBe('claude')
    expect(recovered?.metadata.model).toBe('claude-sonnet-5')
    expect(recovered?.events).toHaveLength(1)
  })

  it('refuses an event from a runtime the mission is not running', async () => {
    const root = await temporaryRoot()
    const ledger = createFileMissionLedger({ rootDirectory: root })
    await ledger.createMission({ ...v1Metadata() } as unknown as MissionLedgerMetadata)

    const foreign = {
      ...codexEvents()[0],
      sourceAdapter: 'claude'
    } as unknown as NormalizedRuntimeEvent

    // A Claude event inside a Codex mission means one of the two records is
    // wrong, and a ledger that accepts both can no longer say which.
    await expect(ledger.appendEvents('mission_1', [foreign])).rejects.toThrow(
      /not readable by the ledger reader/
    )
  })
})

describe('sandbox widening (v3)', () => {
  it('records a workspace-write mission at the current version', async () => {
    const root = await temporaryRoot()
    const ledger = createFileMissionLedger({ rootDirectory: root })
    await ledger.createMission({
      ...v1Metadata({ sandbox: 'workspace-write' })
    } as unknown as MissionLedgerMetadata)

    const recovered = await createFileMissionLedger({ rootDirectory: root }).getMission('mission_1')

    expect(recovered?.metadata.sandbox).toBe('workspace-write')
  })

  it('refuses a pre-v3 file claiming a mission was allowed to write', async () => {
    const root = await temporaryRoot()
    // Versions before 3 could only record read-only runs, so this file was
    // hand-edited. Believing it would render a write run's permissions wrongly.
    await writeV1Ledger(root, [], { sandbox: 'workspace-write' })

    expect(await createFileMissionLedger({ rootDirectory: root }).getMission('mission_1')).toBeUndefined()
  })

  it('still reads v1 and v2 read-only missions', async () => {
    const root = await temporaryRoot()
    await writeV1Ledger(root, [])
    const recovered = await createFileMissionLedger({ rootDirectory: root }).getMission('mission_1')
    expect(recovered?.metadata.sandbox).toBe('read-only')
  })
})
