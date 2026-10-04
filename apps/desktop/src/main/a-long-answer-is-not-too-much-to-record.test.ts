import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createFileMissionLedger } from '@teammate/mission-store'
import type { MissionLedger, MissionLedgerMetadata } from '@teammate/mission-store'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

/**
 * A long answer is not too much to record.
 *
 * Colin, 2026-09-21, on a finished Cursor / Grok 4.6 run that had already
 * printed his whole Roth IRA position table on screen: *"Stopped — the
 * mission ledger could not be written. Too many mission events in one
 * append."* The analysis was right there and the app threw the run away.
 *
 * The cause was ours, not his: `MAX_EVENTS_PER_APPEND` is 100, and a long
 * answer arriving as one burst normalises into more than a hundred events,
 * which the ledger REFUSED rather than split. That number bounds one WRITE
 * -- how much this file is willing to put in a single append -- and it was
 * being enforced as a bound on how much a caller may record, which is not
 * the same thing and is not the caller's business.
 *
 * This is the second time this card has been shown for a ledger that was
 * fine (see `a-busy-file-does-not-end-a-run.test.ts`, 2026-09-15). The card
 * is right for a real failure. The job is to stop manufacturing fake ones.
 */

const METADATA: MissionLedgerMetadata = {
  missionId: 'mission_long',
  runId: 'run_long',
  prompt: 'check robinhood for me, specifically my roth ira, and all associated news',
  runtime: 'cursor',
  model: 'grok-4.6',
  requestedRouteId: 'cursor:grok-4.6',
  resolvedRouteId: 'cursor:grok-4.6',
  cliVersion: '2.1.0',
  workspaceId: 'ws_test',
  createdAt: '2026-09-21T11:11:00.000Z',
  sandbox: 'read-only',
  executionPolicyVersion: 1
} as MissionLedgerMetadata

/** One streamed fragment of the answer, as the normalizer produces them. */
const delta = (sequence: number, text: string): NormalizedRuntimeEvent =>
  ({
    id: `run_long:${String(sequence)}`,
    runId: 'run_long',
    missionId: 'mission_long',
    sequence,
    type: 'message.delta',
    occurredAt: '2026-09-21T11:11:05.000Z',
    sourceAdapter: 'cursor',
    payload: { itemId: 'item_1', operation: 'append', text, final: false, evidence: { redacted: true } }
  }) as NormalizedRuntimeEvent

describe('a long answer is not too much to record', () => {
  let root: string
  let ledger: MissionLedger

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'locust-longanswer-'))
    ledger = createFileMissionLedger({ rootDirectory: root })
    await ledger.createMission(METADATA)
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true }).catch(() => undefined)
  })

  it('accepts a burst of more than a hundred events, which used to be refused', async () => {
    // 250: comfortably past the hundred that stopped Colin's run.
    const burst = Array.from({ length: 250 }, (_, index) => delta(index + 1, `fragment ${String(index)} `))
    await expect(ledger.appendEvents('mission_long', burst)).resolves.toBeUndefined()
    const recovered = await ledger.getMission('mission_long')
    expect(recovered?.events).toHaveLength(250)
    // Read back in the order they were written, with contiguous sequences:
    // the batches must not reorder or drop anything.
    expect(recovered?.events.map((event) => event.sequence)).toEqual(burst.map((event) => event.sequence))
    expect(recovered?.issues ?? []).toEqual([])
  })

  it('writes them as one unbroken run, and the next append continues it', async () => {
    await ledger.appendEvents('mission_long', Array.from({ length: 150 }, (_, index) => delta(index + 1, 'x')))
    await ledger.appendEvents('mission_long', [delta(151, 'and one more')])
    const recovered = await ledger.getMission('mission_long')
    expect(recovered?.events).toHaveLength(151)
    expect(recovered?.events.at(-1)?.sequence).toBe(151)
    // The ledger's own sequence numbering is unbroken across the batches,
    // which is what recovery walks; a gap here reads as a torn file.
    const lines = (await readFile(join(root, 'mission_long.jsonl'), 'utf8')).trim().split('\n')
    const ledgerSequences = lines.map((line) => (JSON.parse(line) as { ledgerSequence: number }).ledgerSequence)
    expect(ledgerSequences).toEqual(Array.from({ length: 152 }, (_, index) => index + 1))
  })

  it('splits on total size too, not only on count', async () => {
    // A delta's text is capped at 16KB, so 200 of them is ~3.2MB -- past the
    // 2MB one append will take, in batches of 100 that count alone would
    // have thought fine.
    const big = Array.from({ length: 200 }, (_, index) => delta(index + 1, 'y'.repeat(16 * 1024)))
    await expect(ledger.appendEvents('mission_long', big)).resolves.toBeUndefined()
    const recovered = await ledger.getMission('mission_long')
    expect(recovered?.events).toHaveLength(200)
  })

  it('still refuses an event it could not read back, before writing any of them', async () => {
    // The batching must not have loosened validation: one bad event in the
    // burst means nothing is written, as before.
    const burst = [
      ...Array.from({ length: 120 }, (_, index) => delta(index + 1, 'ok')),
      { ...delta(121, 'bad'), runId: 'run_somebody_else' } as NormalizedRuntimeEvent
    ]
    await expect(ledger.appendEvents('mission_long', burst)).rejects.toThrow(/correlation|not readable/i)
    const recovered = await ledger.getMission('mission_long')
    expect(recovered?.events ?? []).toHaveLength(0)
  })
})
