import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFileMissionLedger } from '@teammate/mission-store'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import type { CodexMissionUpdate } from '../shared/ipc.js'
import { persistEventUpdates } from './durable-event-updates.js'
import { createStreamedEventBatcher, STREAM_BATCH_MS } from './streamed-event-batches.js'

const AT = '2026-10-05T12:00:00.000Z'
const delta = (sequence: number, text = 'word '): NormalizedRuntimeEvent => ({
  id: `run_stream:${String(sequence)}`, runId: 'run_stream', missionId: 'mission_stream',
  sequence, occurredAt: AT, sourceAdapter: 'codex', type: 'message.delta',
  payload: { itemId: 'answer', operation: 'append', text, final: false, evidence: { redacted: true } }
})
const ended = (sequence: number): NormalizedRuntimeEvent => ({
  ...delta(sequence), type: 'run.completed', payload: { process: { exitCode: 0, signal: null,
    forcedTerminationAttempted: false, terminationUnconfirmed: false, outputLimitExceeded: false,
    oversizedRecordsDropped: 0, inputDeliveryFailed: false, stderrTruncated: false, stderr: '',
    recordCount: sequence, startedAt: AT, finishedAt: AT } }
})
const sequences = (updates: readonly CodexMissionUpdate[]): number[] => updates.flatMap((update) =>
  update.kind === 'message-deltas' ? update.events.map((event) => event.sequence)
    : update.kind === 'event' ? [update.event.sequence] : [])
afterEach(() => vi.useRealTimers())

describe('a streamed batch is written before it is shown', () => {
  it('starts a new text deadline after an approval flush waited on an in-flight write', async () => {
    vi.useFakeTimers()
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const writes: number[][] = []
    const batcher = createStreamedEventBatcher(async (events) => {
      writes.push(events.map((event) => event.sequence))
      if (writes.length === 1) await blocked
    }, () => undefined)
    batcher.push([ended(1)])
    await vi.advanceTimersByTimeAsync(0)
    const flushing = batcher.flush()
    release()
    await flushing
    batcher.push([delta(2)])
    await vi.advanceTimersByTimeAsync(STREAM_BATCH_MS)
    expect(writes).toEqual([[1], [2]])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('measures frame to fifty millisecond windows on the same paced answer and keeps its first-fragment deadline', async () => {
    vi.useFakeTimers()
    const measurements: Array<{ window: number; appends: number; sends: number; maxDelay: number }> = []
    const answer = Array.from({ length: 1_000 }, (_, index) => delta(index + 1, `word${String(index)} `))
    for (const window of [16, 33, STREAM_BATCH_MS]) {
      let appends = 0
      let sends = 0
      let maxDelay = 0
      const arrivals = new Map<number, number>()
      const kept: NormalizedRuntimeEvent[] = []
      const batcher = createStreamedEventBatcher((events) => persistEventUpdates({
        appendEvents: async (_id, batch) => { appends += 1; kept.push(...batch) }
      }, 'run_stream', 'mission_stream', events, () => undefined, (update) => {
        sends += 1
        for (const sequence of sequences([update])) maxDelay = Math.max(maxDelay, Date.now() - arrivals.get(sequence)!)
      }), () => undefined, window)
      for (const event of answer) {
        arrivals.set(event.sequence, Date.now())
        batcher.push([event])
        await vi.advanceTimersByTimeAsync(2)
      }
      await batcher.flush()
      expect(kept).toEqual(answer)
      expect(maxDelay).toBeLessThanOrEqual(window)
      measurements.push({ window, appends, sends, maxDelay })
    }
    console.log(`STREAM WINDOWS: ${JSON.stringify(measurements)}`)
    expect(measurements.find((row) => row.window === STREAM_BATCH_MS)?.appends).toBeLessThanOrEqual(answer.length / 10)
    expect(measurements.find((row) => row.window === STREAM_BATCH_MS)?.sends).toBeLessThanOrEqual(answer.length / 10)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reads the entire batch from disk at send time and recovers it after a crash before send', async () => {
    const root = await mkdtemp(join(tmpdir(), 'locust-streamed-batch-'))
    const ledger = createFileMissionLedger({ rootDirectory: root })
    try {
      await ledger.createMission({ missionId: 'mission_stream', runId: 'run_stream',
        prompt: 'Say a few words.', runtime: 'codex', model: 'account-default',
        requestedRouteId: 'codex', resolvedRouteId: 'codex-account:default', cliVersion: '0.151.0',
        workspaceId: 'ws_test', sandbox: 'read-only', executionPolicyVersion: 1, createdAt: AT })
      const sent: number[][] = []
      await persistEventUpdates(ledger, 'run_stream', 'mission_stream', [delta(1), delta(2)], () => undefined, (update) => {
        sent.push(sequences([update]))
      })
      expect(sent).toEqual([[1, 2]])
      expect((await ledger.getMission('mission_stream'))?.events.map((event) => event.sequence)).toEqual([1, 2])
      // A fresh synchronous disk read IN the send hook proves the boundary,
      // not merely that the disk caught up by the time the assertion ran.
      const { readFileSync } = await import('node:fs')
      let atSend = ''
      await persistEventUpdates(ledger, 'run_stream', 'mission_stream', [delta(3), delta(4)], () => undefined, () => {
        atSend = readFileSync(join(root, 'mission_stream.jsonl'), 'utf8')
      })
      expect(atSend).toContain('run_stream:4')
      await expect(persistEventUpdates(ledger, 'run_stream', 'mission_stream', [delta(5), delta(6)], () => {
        throw new Error('crash after write, before send')
      }, () => { throw new Error('send must not run') })).rejects.toThrow('crash after write, before send')
      const recovered = await createFileMissionLedger({ rootDirectory: root }).getMission('mission_stream')
      expect(recovered?.events.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6])
      expect(recovered?.issues).toEqual([])
      expect((await readFile(join(root, 'mission_stream.jsonl'), 'utf8')).split('\n').filter(Boolean)).toHaveLength(7)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('sends nothing when the durable append fails', async () => {
    const emit = vi.fn()
    const track = vi.fn()
    await expect(persistEventUpdates({ appendEvents: async () => { throw new Error('disk full') } },
      'run_stream', 'mission_stream', [delta(1)], track, emit)).rejects.toThrow('disk full')
    expect(emit).not.toHaveBeenCalled()
    expect(track).not.toHaveBeenCalled()
  })

  it('flushes text ahead of activity immediately and preserves order across both batches', async () => {
    vi.useFakeTimers()
    const writes: number[][] = []
    const batcher = createStreamedEventBatcher(async (events) => { writes.push(events.map((event) => event.sequence)) }, () => undefined)
    batcher.push([delta(1), delta(2)])
    await vi.advanceTimersByTimeAsync(STREAM_BATCH_MS - 1)
    expect(writes).toEqual([])
    batcher.push([{ ...delta(3), type: 'step.started', payload: { itemId: 'tool', stepKind: 'item', evidence: { redacted: true } } }])
    await vi.advanceTimersByTimeAsync(0)
    expect(writes).toEqual([[1, 2, 3]])
    batcher.push([delta(4)])
    await batcher.flush()
    expect(writes).toEqual([[1, 2, 3], [4]])
  })

  it('delivers a lone delta at the deadline without another record or a run ending', async () => {
    vi.useFakeTimers()
    const writes: number[][] = []
    const batcher = createStreamedEventBatcher(async (events) => { writes.push(events.map((event) => event.sequence)) }, () => undefined)
    batcher.push([delta(1)])
    await vi.advanceTimersByTimeAsync(STREAM_BATCH_MS - 1)
    expect(writes).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(writes).toEqual([[1]])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('writes pending text before a run ending and drains the last fragment on process exit', async () => {
    vi.useFakeTimers()
    const sent: CodexMissionUpdate[] = []
    const writes: number[][] = []
    const batcher = createStreamedEventBatcher((events) => persistEventUpdates({
      appendEvents: async (_id, batch) => { writes.push(batch.map((event) => event.sequence)) }
    }, 'run_stream', 'mission_stream', events, () => undefined, (update) => { sent.push(update) }), () => undefined)
    batcher.push([delta(1), delta(2)])
    batcher.push([ended(3)])
    await batcher.flush()
    expect(writes).toEqual([[1, 2, 3]])
    expect(sent.map((update) => update.kind)).toEqual(['message-deltas', 'event'])
    expect(sequences(sent)).toEqual([1, 2, 3])
    batcher.push([delta(4)])
    await batcher.flush()
    expect(writes).toEqual([[1, 2, 3], [4]])
    expect(sequences(sent)).toEqual([1, 2, 3, 4])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps one write in flight, awaits backpressure, and stops after a timer write fails', async () => {
    vi.useFakeTimers()
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const writes: number[][] = []
    const fail = vi.fn()
    const batcher = createStreamedEventBatcher(async (events) => {
      writes.push(events.map((event) => event.sequence))
      if (writes.length === 1) await blocked
      else throw new Error('disk full')
    }, fail)
    batcher.push([ended(1)])
    await vi.advanceTimersByTimeAsync(0)
    batcher.push([delta(2), delta(3)])
    await vi.advanceTimersByTimeAsync(STREAM_BATCH_MS)
    expect(writes).toEqual([[1]])
    expect(batcher.pendingCount).toBe(2)
    let drained = false
    const flush = batcher.flush().then(() => { drained = true })
    expect(drained).toBe(false)
    release()
    await flush
    expect(writes).toEqual([[1], [2, 3]])
    expect(fail).toHaveBeenCalledWith(expect.objectContaining({ message: 'disk full' }))
    batcher.push([delta(4)])
    await batcher.flush()
    expect(writes).toHaveLength(2)
    expect(vi.getTimerCount()).toBe(0)
  })
})
