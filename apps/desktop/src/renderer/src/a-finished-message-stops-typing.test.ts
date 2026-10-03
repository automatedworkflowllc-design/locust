import { describe, expect, it } from 'vitest'

import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { buildThread, stepsLine } from './missionView.js'

/**
 * A FINISHED MESSAGE STOPS TYPING (0.570).
 *
 * Colin, 2026-10-03, on an Antigravity (Claude Sonnet 5.5) run: "antigravity
 * has the _ typing animation after finished messages". Its ledger, read: each
 * message is one `append` delta, never marked final, so the caret stayed on
 * "The matrix run is in progress..." through every step after it. The shape
 * below is that ledger's.
 */
let sequence = 0
const event = (type: string, payload: Record<string, unknown>): NormalizedRuntimeEvent => {
  sequence += 1
  return {
    id: `e${String(sequence)}`, runId: 'r', missionId: 'm', sequence, occurredAt: new Date(Date.UTC(2026, 9, 3, 20, 0, sequence)).toISOString(),
    sourceAdapter: 'antigravity', type, payload: { evidence: { redacted: true }, ...payload }
  } as unknown as NormalizedRuntimeEvent
}
const said = (itemId: string, text: string) => event('message.delta', { itemId, operation: 'append', text, final: false })
const tool = (itemId: string, name: string, command?: string) => event('tool.started', { itemId, toolKind: name, name, ...(command === undefined ? {} : { command }), phase: 'started' })
const streamingOf = (events: readonly NormalizedRuntimeEvent[]) =>
  buildThread(events, { running: true }).flatMap((item) => (item.type === 'agent-message' ? [[item.text.trim(), item.streaming] as const] : []))

describe('a message never marked final', () => {
  it('stops typing once a call starts after it', () => {
    const events = [event('run.started', {}), said('msg_76', 'The matrix run is in progress.'), tool('tool_77', 'run_command', 'node _tools/matrix.mjs')]
    expect(streamingOf(events)).toEqual([['The matrix run is in progress.', false]])
  })

  it('stops typing once another message begins, and the newest still types', () => {
    const events = [event('run.started', {}), said('msg_76', 'The matrix run is in progress.'), said('msg_84', 'Meanwhile I will view the frames.')]
    expect(streamingOf(events)).toEqual([['The matrix run is in progress.', false], ['Meanwhile I will view the frames.', true]])
  })

  it('types again if its own text resumes after a call', () => {
    const events = [event('run.started', {}), said('msg_1', 'Reading.'), tool('tool_2', 'view_file', 'a.txt'), said('msg_1', ' Still reading.')]
    expect(streamingOf(events)).toEqual([['Reading. Still reading.', true]])
  })

  it('says its check-back timer as a wait, not "used schedule"', () => {
    const line = stepsLine([{ kind: 'tool', name: 'schedule', tool: 'schedule', settled: true }] as never, true)
    expect(JSON.stringify(line)).not.toMatch(/used schedule/i)
    expect(JSON.stringify(line)).toMatch(/waited/i)
  })
})
