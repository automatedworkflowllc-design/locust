import { createOpenCodeEventNormalizer } from '@teammate/runtime-adapters'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { describe, expect, it } from 'vitest'

import { parseShareBlocks } from '../shared/peer-share.js'
import { createTranscriptTracker } from './peer-exchange.js'

/**
 * A6.9: AN OPENCODE COMPACTION IS NOT WHAT THE TEAMMATE SAID.
 *
 * When a conversation outgrows the model's context, OpenCode summarizes it
 * and adds "Continue if you have next steps..." to carry on, and `run` prints
 * both as ordinary text (read in OpenCode's source, 2026-09-24). The summary
 * is the model's notes to itself about the whole conversation, so it quotes
 * what was said before -- blocks included -- and when the run ends right after
 * it, it was the last thing "said": the reply the host reads blocks from, and
 * the answer a relay brings back.
 *
 * Records shaped as OpenCode writes them, through the real normalizer and the
 * tracker the host reads replies with. The thread's half is
 * renderer/src/a-compaction-is-a-line-not-a-reply.test.ts.
 */
const record = (type: string, part: Record<string, unknown>): string => JSON.stringify({ type, sessionID: 'ses_1', part })
const start = record('step_start', { type: 'step-start' })
const finish = (reason: string): string => record('step_finish', { type: 'step-finish', reason, tokens: { input: 10, output: 2 } })
const said = (text: string): string => record('text', { type: 'text', text, time: { start: 1, end: 2 } })
const read = record('tool_use', {
  type: 'tool',
  tool: 'read',
  callID: 'call_1',
  state: { status: 'completed', input: { filePath: 'a.txt' }, output: 'hi' }
})
const note = record('text', {
  type: 'text',
  synthetic: true,
  metadata: { compaction_continue: true },
  text: 'Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed.',
  time: { start: 3, end: 3 }
})
// What a summary of an earlier turn holds: the message that turn sent.
const SUMMARY = '## Work State\nSent Booty the numbers: <locust-share to="Booty">The totals are 51.</locust-share>'

function normalized(lines: readonly string[], exitCode = 0): readonly NormalizedRuntimeEvent[] {
  const opencode = createOpenCodeEventNormalizer({ runId: 'run_1', missionId: 'mission_1' })
  const events: NormalizedRuntimeEvent[] = []
  lines.forEach((raw, index) => events.push(...opencode.accept({ sequence: index + 1, raw })))
  events.push(
    ...opencode.finish({
      exitCode,
      signal: null,
      stderr: '',
      stderrTruncated: false,
      recordCount: lines.length,
      cancelled: false,
      forcedTerminationAttempted: false,
      terminationUnconfirmed: false,
      inputDeliveryFailed: false,
      outputLimitExceeded: false,
      oversizedRecordsDropped: 0,
      startedAt: '2026-09-24T12:00:00.000Z',
      finishedAt: '2026-09-24T12:00:05.000Z'
    })
  )
  return events
}

const turn = [
  start, said('Reading the file first.'), read, finish('tool-calls'),
  start, said(SUMMARY), finish('stop'),
  note,
  start, said('a.txt says hi.'), finish('stop')
]

describe('an OpenCode compaction', () => {
  it('leaves the reply the host reads blocks from as what came after it', () => {
    const tracker = createTranscriptTracker()
    tracker.track(normalized(turn))
    expect(tracker.latestFinal).toBe('a.txt says hi.')
  })

  it('never makes the summary the reply, even when nothing came after it', () => {
    // The run was stopped after the note: the summary was the last text.
    const tracker = createTranscriptTracker()
    tracker.track(normalized(turn.slice(0, 8), 1))
    const reply = tracker.latestFinal ?? ''
    // Before 0.321 this was OpenCode's note to the model; with the note
    // dropped and the summary kept, it would be the summary.
    expect(reply).not.toContain('Continue if you have next steps')
    expect(reply).not.toContain('Work State')
    // So the message an earlier turn sent is not sent again.
    expect(parseShareBlocks(reply)).toHaveLength(0)
  })
})
