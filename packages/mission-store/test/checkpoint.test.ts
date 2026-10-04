import { createCodexEventNormalizer } from '@teammate/runtime-adapters'
import type { NormalizedRuntimeEvent, RuntimeProcessCompletion } from '@teammate/runtime-adapters'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createFileMissionLedger, parsedCheckpoint, reconcileMission } from '../src/index.js'
import type { MissionLedgerMetadata, ReconciledCheckpoint } from '../src/index.js'

const NOW = '2026-08-31T16:00:00.000Z'
const CHECKPOINT_AT = '2026-08-31T16:05:00.000Z'
const roots: string[] = []

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'teammate-checkpoint-'))
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
    recordCount: 4,
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

function normalizer() {
  return createCodexEventNormalizer({
    runId: 'run_1',
    missionId: 'mission_1',
    requestedRouteId: 'codex',
    resolvedRouteId: 'codex-account:default',
    cliVersion: '0.151.0-alpha.7.2',
    now: () => new Date(NOW)
  })
}

/** A tool call that starts and reports an outcome: nothing is in doubt. */
function settledToolEvents(): readonly NormalizedRuntimeEvent[] {
  const codex = normalizer()
  return [
    ...codex.accept({ sequence: 1, raw: JSON.stringify({ type: 'thread.started', thread_id: 'thread_1' }) }),
    ...codex.accept({
      sequence: 2,
      raw: JSON.stringify({
        type: 'item.started',
        item: { id: 'call_1', type: 'command_execution', command: 'ls' }
      })
    }),
    ...codex.accept({
      sequence: 3,
      raw: JSON.stringify({
        type: 'item.completed',
        item: { id: 'call_1', type: 'command_execution', command: 'ls', exit_code: 0 }
      })
    }),
    ...codex.accept({
      sequence: 4,
      raw: JSON.stringify({
        type: 'item.completed',
        item: { id: 'answer', type: 'agent_message', text: 'Durable result' }
      })
    })
  ]
}

/** A tool call that starts and never reports: the case the checkpoint exists for. */
function unsettledToolEvents(): readonly NormalizedRuntimeEvent[] {
  const codex = normalizer()
  return [
    ...codex.accept({ sequence: 1, raw: JSON.stringify({ type: 'thread.started', thread_id: 'thread_1' }) }),
    ...codex.accept({
      sequence: 2,
      raw: JSON.stringify({
        type: 'item.started',
        item: { id: 'call_1', type: 'command_execution', command: 'send-invoice' }
      })
    })
  ]
}

/**
 * A minimal event for digest tests only. The digest reads sequence, id and
 * type; building these by hand is what lets two transcripts differ in exactly
 * one of those fields.
 */
function stubEvent(sequence: number, id: string, type = 'step.started'): NormalizedRuntimeEvent {
  return {
    id,
    runId: 'run_1',
    missionId: 'mission_1',
    sequence,
    occurredAt: NOW,
    sourceAdapter: 'codex',
    type,
    payload: { stepKind: 'turn', evidence: {} }
  } as unknown as NormalizedRuntimeEvent
}

async function seed(
  events: readonly NormalizedRuntimeEvent[],
  now: () => Date = () => new Date(CHECKPOINT_AT)
) {
  const root = await temporaryRoot()
  const ledger = createFileMissionLedger({ rootDirectory: root, now })
  await ledger.createMission(metadata())
  if (events.length > 0) await ledger.appendEvents('mission_1', events)
  return { root, ledger }
}

describe('checkpoint reconciliation', () => {
  it('reports a settled mission as safe to resume elsewhere', async () => {
    const { ledger } = await seed(settledToolEvents())

    const checkpoint = await ledger.createCheckpoint('mission_1', 'route-limit')

    expect(checkpoint).toMatchObject({
      missionId: 'mission_1',
      runId: 'run_1',
      epoch: 1,
      reason: 'route-limit',
      resumeSafety: 'safe',
      settledActions: ['call_1'],
      unsettledActions: [],
      assistantSummary: 'Durable result',
      runtimeThreadId: 'thread_1',
      createdAt: CHECKPOINT_AT
    })
    expect(checkpoint.reconciledThroughSequence).toBe(settledToolEvents().length)
    expect(checkpoint.transcriptDigest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('refuses to call a mission safe while an action never reported an outcome', async () => {
    const { ledger } = await seed(unsettledToolEvents())

    const checkpoint = await ledger.createCheckpoint('mission_1', 'route-limit')

    expect(checkpoint.resumeSafety).toBe('approval-required')
    expect(checkpoint.settledActions).toEqual([])
    expect(checkpoint.unsettledActions).toEqual([
      {
        itemId: 'call_1',
        toolKind: 'command_execution',
        name: 'shell',
        startedAt: NOW,
        startedAtSequence: 2
      }
    ])
    // The reason a human reads must name the actual cause, not a status word.
    expect(checkpoint.safetyReason).toContain('never reported an outcome')
  })

  it('is durable: a checkpoint survives a fresh reader and keeps its epoch order', async () => {
    const stamps = ['2026-08-31T16:05:00.000Z', '2026-08-31T16:06:00.000Z']
    let index = 0
    const { root, ledger } = await seed(settledToolEvents(), () => new Date(stamps[index++] ?? NOW))

    await ledger.createCheckpoint('mission_1', 'route-limit')
    await ledger.createCheckpoint('mission_1', 'manual')

    const reopened = createFileMissionLedger({ rootDirectory: root })
    const recovered = await reopened.getMission('mission_1')

    expect(recovered?.issues).toEqual([])
    expect(recovered?.phase).toBe('interrupted')
    expect(recovered?.checkpoints.map((entry) => [entry.epoch, entry.reason])).toEqual([
      [1, 'route-limit'],
      [2, 'manual']
    ])
    // Checkpoints occupy the ledger sequence but not the event sequence, so the
    // transcript is unchanged by having been checkpointed.
    expect(recovered?.events).toHaveLength(settledToolEvents().length)
  })

  it('describes what survived on disk after an interrupted write, not what was believed', async () => {
    const { root } = await seed(settledToolEvents())
    // Truncate the durable record the way a crash mid-write leaves it, then
    // checkpoint from a NEW ledger instance -- a restart. The completion of
    // call_1 is gone, so a checkpoint that reported four events would be
    // describing the process's memory rather than the file.
    const lines = (await readFile(join(root, 'mission_1.jsonl'), 'utf8')).split('\n').filter(Boolean)
    await writeFile(join(root, 'mission_1.jsonl'), `${lines.slice(0, 3).join('\n')}\n`, 'utf8')

    const restarted = createFileMissionLedger({
      rootDirectory: root,
      now: () => new Date(CHECKPOINT_AT)
    })
    const checkpoint = await restarted.createCheckpoint('mission_1', 'route-limit')

    expect(checkpoint.reconciledThroughSequence).toBe(2)
    // Event 2 opened a tool call whose outcome is no longer on disk.
    expect(checkpoint.resumeSafety).toBe('approval-required')
    expect(checkpoint.unsettledActions.map((entry) => entry.itemId)).toEqual(['call_1'])
  })

  it('reports an unreadable ledger as unsafe, and refuses to write past the break', async () => {
    const { root } = await seed(settledToolEvents())
    const text = await readFile(join(root, 'mission_1.jsonl'), 'utf8')
    // A record the reader refuses stops recovery there, so the events are a
    // prefix of what happened. Resuming from a prefix redoes real work.
    await writeFile(join(root, 'mission_1.jsonl'), `${text}{"not":"a record"}\n`, 'utf8')
    const before = await readFile(join(root, 'mission_1.jsonl'), 'utf8')

    const restarted = createFileMissionLedger({
      rootDirectory: root,
      now: () => new Date(CHECKPOINT_AT)
    })
    const checkpoint = await restarted.createCheckpoint('mission_1', 'route-limit')

    expect(checkpoint.resumeSafety).toBe('unsafe')
    expect(checkpoint.safetyReason).toContain('incomplete')
    // Nothing was appended: a record written after the break is unreachable to
    // recovery, which is the defect this ledger exists to prevent.
    expect(await readFile(join(root, 'mission_1.jsonl'), 'utf8')).toBe(before)
  })

  it('rebuilds an appended message rather than keeping only its last fragment', () => {
    const codex = normalizer()
    const events = [
      ...codex.accept({ sequence: 1, raw: JSON.stringify({ type: 'thread.started', thread_id: 'thread_1' }) }),
      ...codex.accept({
        sequence: 2,
        raw: JSON.stringify({ type: 'item.updated', item: { id: 'answer', type: 'agent_message', text: 'Part one. ' } })
      }),
      ...codex.accept({
        sequence: 3,
        raw: JSON.stringify({
          type: 'item.completed',
          item: { id: 'answer', type: 'agent_message', text: 'Part one. Part two.' }
        })
      })
    ]

    const checkpoint = reconcileMission(
      { metadata: metadata(), events, issues: [] },
      { reason: 'manual', epoch: 1, createdAt: CHECKPOINT_AT }
    )

    expect(checkpoint.assistantSummary).toBe('Part one. Part two.')
  })

  it('gives different transcripts different digests', () => {
    const digest = (events: readonly NormalizedRuntimeEvent[]): string =>
      reconcileMission(
        { metadata: metadata(), events, issues: [] },
        { reason: 'manual', epoch: 1, createdAt: CHECKPOINT_AT }
      ).transcriptDigest

    // Same LENGTH, different content. Comparing a transcript against a shorter
    // one only proves the digest counts events: a digest that hashed a constant
    // per event would pass that, and did, which is how this test was found to
    // be checking nothing.
    const a = [stubEvent(1, 'call_1'), stubEvent(2, 'call_2')]
    const differentIds = [stubEvent(1, 'call_1'), stubEvent(2, 'call_9')]
    const differentTypes = [stubEvent(1, 'call_1'), stubEvent(2, 'call_2', 'step.completed')]

    expect(digest(a)).not.toBe(digest(differentIds))
    expect(digest(a)).not.toBe(digest(differentTypes))
    expect(digest(a)).toBe(digest([...a]))

    // The delimiter, pinned directly: without it these two hash the same bytes
    // ("12a..." either way), so a transcript at sequence 1 carrying id "2a"
    // would be indistinguishable from one at sequence 12 carrying id "a".
    expect(digest([stubEvent(1, '2a')])).not.toBe(digest([stubEvent(12, 'a')]))
  })
})

describe('checkpoint reader parity', () => {
  function sample(overrides: Partial<ReconciledCheckpoint> = {}): unknown {
    return {
      schemaVersion: 1,
      missionId: 'mission_1',
      runId: 'run_1',
      epoch: 1,
      reason: 'route-limit',
      reconciledThroughSequence: 2,
      settledActions: [],
      unsettledActions: [],
      resumeSafety: 'safe',
      safetyReason: 'Every recorded action reported an outcome.',
      transcriptDigest: 'a'.repeat(64),
      assistantSummary: '',
      createdAt: CHECKPOINT_AT,
      ...overrides
    }
  }

  it('accepts a well-formed checkpoint', () => {
    expect(parsedCheckpoint(sample(), metadata())).toBeDefined()
  })

  it('refuses a checkpoint that claims safety while listing an unknown action', () => {
    // This is the single lie that would defeat the mechanism: a record that
    // parses, reads as reassuring, and contradicts itself in the same object.
    const lying = sample({
      resumeSafety: 'safe',
      unsettledActions: [
        {
          itemId: 'call_1',
          toolKind: 'command_execution',
          name: 'shell',
          startedAt: NOW,
          startedAtSequence: 2
        }
      ]
    })
    expect(parsedCheckpoint(lying, metadata())).toBeUndefined()
  })

  it('refuses checkpoints belonging to another mission or run', () => {
    expect(parsedCheckpoint(sample({ missionId: 'mission_2' }), metadata())).toBeUndefined()
    expect(parsedCheckpoint(sample({ runId: 'run_2' }), metadata())).toBeUndefined()
  })

  it('refuses a malformed digest, epoch, reason, or safety value', () => {
    expect(parsedCheckpoint(sample({ transcriptDigest: 'nope' }), metadata())).toBeUndefined()
    expect(parsedCheckpoint(sample({ epoch: 0 }), metadata())).toBeUndefined()
    expect(parsedCheckpoint(sample({ reason: 'whenever' as never }), metadata())).toBeUndefined()
    expect(parsedCheckpoint(sample({ resumeSafety: 'fine' as never }), metadata())).toBeUndefined()
  })

  it('stops recovery at a checkpoint whose epoch is out of order', async () => {
    const { root, ledger } = await seed(settledToolEvents())
    await ledger.createCheckpoint('mission_1', 'route-limit')

    const lines = (await readFile(join(root, 'mission_1.jsonl'), 'utf8')).split('\n').filter(Boolean)
    const last = JSON.parse(lines[lines.length - 1] ?? '{}')
    last.checkpoint.epoch = 7
    lines[lines.length - 1] = JSON.stringify(last)
    await writeFile(join(root, 'mission_1.jsonl'), `${lines.join('\n')}\n`, 'utf8')

    const recovered = await createFileMissionLedger({ rootDirectory: root }).getMission('mission_1')

    expect(recovered?.checkpoints).toEqual([])
    expect(recovered?.issues.map((issue) => issue.code)).toContain('invalid-record')
  })
})
