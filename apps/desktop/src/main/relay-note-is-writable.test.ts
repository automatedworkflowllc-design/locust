import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createFileMissionLedger } from '@teammate/mission-store'
import type { MissionLedger, MissionLedgerMetadata } from '@teammate/mission-store'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

/**
 * The relay's ending notice, against a REAL ledger.
 *
 * The host writes "Stopped after 12 automatic replies" into the mission's own
 * record so it survives being looked away from -- and it writes it through a
 * `.catch(() => undefined)`, because a bookkeeping write must never take a
 * run with it. Which means a malformed event would be **silently dropped**,
 * and the feature would look finished while recording nothing.
 *
 * The ledger validates every field it is given. These pin that the event the
 * host actually constructs passes that validation, that it can be read back,
 * and -- the one that would have been a real regression -- that appending it
 * AFTER a run's terminal event leaves the mission `completed`.
 */

const METADATA: MissionLedgerMetadata = {
  missionId: 'mission_note',
  runId: 'run_note',
  prompt: 'Ask Booty for the word.',
  runtime: 'claude',
  model: 'sonnet',
  requestedRouteId: 'claude:sonnet',
  resolvedRouteId: 'claude:sonnet',
  cliVersion: '2.1.0',
  workspaceId: 'ws_test',
  createdAt: '2026-09-11T06:00:00.000Z',
  sandbox: 'workspace-write',
  executionPolicyVersion: 1
} as MissionLedgerMetadata

const runEvent = (sequence: number, type: 'run.started' | 'run.completed'): NormalizedRuntimeEvent =>
  ({
    id: `run_note:${String(sequence)}`,
    runId: 'run_note',
    missionId: 'mission_note',
    sequence,
    type,
    occurredAt: '2026-09-11T06:00:01.000Z',
    sourceAdapter: 'claude',
    payload:
      type === 'run.started'
        ? { runtimeThreadId: 't', evidence: { redacted: true } }
        : {
            runtimeThreadId: 't',
            // The ledger validates every field of this; a partial object is
            // refused outright, which is the whole point of the exercise.
            process: {
              exitCode: 0,
              signal: null,
              stderr: '',
              stderrTruncated: false,
              recordCount: 2,
              inputDeliveryFailed: false,
              outputLimitExceeded: false,
              forcedTerminationAttempted: false,
              terminationUnconfirmed: false,
              startedAt: '2026-09-11T06:00:00.000Z',
              finishedAt: '2026-09-11T06:00:05.000Z'
            }
          }
  }) as NormalizedRuntimeEvent

/** Exactly what `note` in index.ts builds. */
const noteEvent = (sequence: number, message: string): NormalizedRuntimeEvent =>
  ({
    id: `run_note:relay:${String(sequence)}`,
    runId: 'run_note',
    missionId: 'mission_note',
    sequence,
    type: 'adapter.diagnostic',
    occurredAt: '2026-09-11T06:00:09.000Z',
    sourceAdapter: 'claude',
    payload: {
      level: 'info',
      code: 'host.relay_ended',
      message,
      terminal: false,
      evidence: { redacted: true }
    }
  }) as NormalizedRuntimeEvent

describe('writing a relay ending into a real ledger', () => {
  let root: string
  let ledger: MissionLedger

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'locust-relaynote-'))
    ledger = createFileMissionLedger({ rootDirectory: root })
    await ledger.createMission(METADATA)
    await ledger.appendEvents('mission_note', [runEvent(1, 'run.started'), runEvent(2, 'run.completed')])
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true }).catch(() => undefined)
  })

  it('is accepted by the ledger, not silently dropped', async () => {
    // The write is behind a catch, so a malformed event would leave the
    // feature looking finished and recording nothing.
    await ledger.appendEvents('mission_note', [noteEvent(3, 'Stopped after 12 automatic replies.')])
    const mission = await ledger.getMission('mission_note')
    const kept = mission?.events.filter((event) => event.type === 'adapter.diagnostic') ?? []
    expect(kept).toHaveLength(1)
  })

  it('reads back with the sentence a person needs', async () => {
    await ledger.appendEvents('mission_note', [noteEvent(3, 'Stopped after 12 automatic replies.')])
    const mission = await ledger.getMission('mission_note')
    const note = mission?.events.find((event) => event.type === 'adapter.diagnostic')
    expect(note?.type === 'adapter.diagnostic' ? note.payload.message : '').toContain('Stopped after 12')
    expect(note?.type === 'adapter.diagnostic' ? note.payload.code : '').toBe('host.relay_ended')
  })

  it('LEAVES A COMPLETED MISSION COMPLETED', async () => {
    // The regression this could have been. `phaseFor` scans backwards for any
    // terminal event, so appending after `run.completed` is safe -- checked
    // here rather than reasoned about, because getting it wrong would have
    // turned every finished exchange into an interrupted one.
    const before = await ledger.getMission('mission_note')
    expect(before?.phase).toBe('completed')
    await ledger.appendEvents('mission_note', [noteEvent(3, 'Stopped after 12 automatic replies.')])
    const after = await ledger.getMission('mission_note')
    expect(after?.phase).toBe('completed')
  })

  it('records no integrity issue', async () => {
    // A ledger that accepts the event but flags the file would put an amber
    // "receipt incomplete" on a mission whose only sin was being explained.
    await ledger.appendEvents('mission_note', [noteEvent(3, 'Stopped after 12 automatic replies.')])
    const mission = await ledger.getMission('mission_note')
    expect(mission?.issues ?? []).toHaveLength(0)
  })
})
