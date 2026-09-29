import { describe, expect, it } from 'vitest'

import { activityEntries, buildThread, commandTook } from './missionView.js'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

/**
 * A FINISHED COMMAND SAYS HOW LONG IT TOOK (0.459).
 *
 * Devin's worklog shows each finished shell command's duration; a person
 * watching a build or a test run wants the same glance. From the command's
 * start to its end as the runtime reported them -- and only when that means
 * something: a second or more, waited on, and actually run.
 */
function event(type: string, payload: unknown, secondsIn: number, sequence: number): NormalizedRuntimeEvent {
  return {
    id: `run:${String(sequence)}`,
    runId: 'run',
    sequence,
    occurredAt: new Date(Date.UTC(2026, 8, 29, 12, 0, secondsIn)).toISOString(),
    sourceAdapter: 'claude',
    type,
    payload
  } as unknown as NormalizedRuntimeEvent
}

const bash = (itemId: string, command: string, extra: Record<string, unknown> = {}) => ({ itemId, toolKind: 'tool_use', name: 'Bash', command, ...extra })
const events = [
  event('run.started', {}, 0, 1),
  // A test run: 12 seconds.
  event('tool.started', { ...bash('a', 'pnpm test'), phase: 'started' }, 1, 2),
  event('tool.completed', { ...bash('a', 'pnpm test'), phase: 'completed', exitCode: 0 }, 13, 3),
  // Reported start and end together: no time worth claiming.
  event('tool.started', { ...bash('b', 'ls'), phase: 'started' }, 14, 4),
  event('tool.completed', { ...bash('b', 'ls'), phase: 'completed', exitCode: 0 }, 14, 5),
  // Sent to the background: its "end" is when it was handed off, not when it finished.
  event('tool.started', { ...bash('c', 'npm run dev', { background: true }), phase: 'started' }, 15, 6),
  event('tool.completed', { ...bash('c', 'npm run dev', { background: true }), phase: 'completed' }, 18, 7),
  // Refused before it ran.
  event('tool.started', { ...bash('d', 'rm -rf build'), phase: 'started' }, 19, 8),
  event('tool.failed', { ...bash('d', 'rm -rf build'), phase: 'completed', status: 'refused', output: 'Not allowed' }, 21, 9),
  // Timed by the runtime itself (OpenCode reports start and end together, with the call's own clock).
  event('tool.started', { ...bash('f', 'npm test'), phase: 'started' }, 20, 12),
  event('tool.completed', { ...bash('f', 'npm test'), phase: 'completed', exitCode: 0, durationMs: 4200 }, 20, 13),
  // A long one, in minutes.
  event('tool.started', { ...bash('e', 'cargo build'), phase: 'started' }, 22, 10),
  event('tool.completed', { ...bash('e', 'cargo build'), phase: 'completed', exitCode: 0 }, 22 + 95, 11),
  event('run.completed', {}, 120, 14)
]

describe('a finished command', () => {
  const details = (() => {
    const activity = buildThread(events, { running: false }).find((item) => item.type === 'activity')
    return activity?.type === 'activity' ? activity.details : []
  })()
  const took = activityEntries(details).flatMap((entry) => (entry.kind === 'shell' ? [[entry.command, commandTook(entry)]] : []))

  it('says how long it ran, from its start to its end', () => {
    expect(took).toContainEqual(['pnpm test', '12s'])
    expect(took).toContainEqual(['cargo build', '1m 35s'])
    // The runtime's own clock wins over when the events arrived.
    expect(took).toContainEqual(['npm test', '4s'])
  })

  it('says nothing when there is nothing true to say: instant, backgrounded, or refused', () => {
    expect(took).toContainEqual(['ls', undefined])
    expect(took).toContainEqual(['npm run dev', undefined])
    expect(took).toContainEqual(['rm -rf build', undefined])
  })

  it('says nothing while it is still running', () => {
    expect(commandTook({ durationMs: 5000, settled: false })).toBeUndefined()
  })
})
