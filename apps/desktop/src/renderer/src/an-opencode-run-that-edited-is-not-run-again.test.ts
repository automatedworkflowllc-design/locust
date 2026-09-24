import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createOpenCodeEventNormalizer } from '@teammate/runtime-adapters'
import { describe, expect, it } from 'vitest'

import { runtimeNeverStarted } from './missionView.js'

/**
 * H4, reproduced the review's way: a real OpenCode write-mode run, recorded
 * (read a file, write notes.txt), fed through the real normalizer with its
 * stop step dropped and the process exiting 1 -- a run that did work and then
 * failed. OpenCode never emits `run.started`, so this was offered "Run it
 * again" under "Nothing had started, so running this again cannot repeat
 * anything"; pressing it would write the file again.
 */
const FIXTURE = fileURLToPath(new URL('../../../../../packages/runtime-adapters/test/fixtures/opencode/write-mode-read-and-write.jsonl', import.meta.url))

describe('an OpenCode run that wrote a file and then failed', () => {
  it('is not taken for one that never started', () => {
    const normalizer = createOpenCodeEventNormalizer({ runId: 'run_1', missionId: 'mission_1', cliVersion: '1.18.27', now: () => new Date('2026-09-24T12:00:00.000Z') })
    const lines = readFileSync(FIXTURE, 'utf8').split('\n').filter((line) => line.trim().length > 0 && !line.includes('"step_finish"'))
    const events = [
      ...lines.flatMap((raw, index) => normalizer.accept({ sequence: index + 1, raw })),
      ...normalizer.finish({
        exitCode: 1, signal: null, stderr: '', stderrTruncated: false, recordCount: lines.length, cancelled: false,
        forcedTerminationAttempted: false, terminationUnconfirmed: false, inputDeliveryFailed: false, outputLimitExceeded: false,
        oversizedRecordsDropped: 0, startedAt: '2026-09-24T12:00:00.000Z', finishedAt: '2026-09-24T12:00:05.000Z'
      })
    ]
    // The shape the review measured: tools ran, the run failed, no run.started.
    expect(events.some((event) => event.type === 'tool.completed')).toBe(true)
    expect(events.at(-1)?.type).toBe('run.failed')
    expect(events.some((event) => event.type === 'run.started')).toBe(false)
    expect(runtimeNeverStarted(events)).toBe(false)
  })
})
