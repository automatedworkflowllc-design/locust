import { describe, expect, it } from 'vitest'

import { createClaudeEventNormalizer } from '@teammate/runtime-adapters'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { helperResult } from './components/ActivityCard.js'
import { activityEntries, buildThread, stepsLine } from './missionView.js'

/**
 * A HELPER SENT TO THE BACKGROUND SAYS IT IS STILL WORKING (0.492,
 * DISPLAY-COVERAGE gap 7). Claude Code's Agent can run a helper in the
 * background: the call returns at once with only a launch receipt, and the
 * helper's life arrives afterwards as `task_started` / `task_progress` /
 * `task_notification` with `is_backgrounded`. The row read "reported back"
 * the moment it launched, its progress was never shown, and the summary it
 * came back with was dropped. Driven through the real adapter, in both orders
 * Claude Code may send the launch and the notice.
 */
let line = 0
const record = (value: unknown) => {
  line += 1
  return { sequence: line, raw: JSON.stringify(value) }
}
const agentCall = [
  { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_agent', name: 'Agent' } } },
  { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_agent', name: 'Agent', input: { description: 'Survey the test files', prompt: 'List every test file', subagent_type: 'Explore', run_in_background: true } }] } }
]
const launched = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_agent', content: 'Async agent launched successfully.' }] } }
const started = { type: 'system', subtype: 'task_started', task_id: 't1', tool_use_id: 'toolu_agent', is_backgrounded: true, subagent_type: 'Explore', description: 'Survey the test files' }
const progress = { type: 'system', subtype: 'task_progress', task_id: 't1', tool_use_id: 'toolu_agent', is_backgrounded: true, description: 'Reading src/app.test.ts', last_tool_name: 'Read' }
const done = { type: 'system', subtype: 'task_notification', task_id: 't1', tool_use_id: 'toolu_agent', status: 'completed', summary: '14 test files, all under src/' }

function events(records: readonly unknown[]): NormalizedRuntimeEvent[] {
  const claude = createClaudeEventNormalizer({ runId: 'run_1', now: () => new Date('2026-09-30T06:00:00.000Z') })
  return records.flatMap((value) => [...claude.accept(record(value))])
}
function helper(records: readonly unknown[], running: boolean) {
  const thread = buildThread(events(records), { running })
  const foot = thread.find((item) => item.type === 'activity')
  const entry = activityEntries(foot?.type === 'activity' ? foot.details : []).find((one) => one.kind === 'helper')
  if (entry?.kind !== 'helper') throw new Error('no helper row')
  const steps = thread.find((item) => item.type === 'steps')
  return { entry, said: helperResult(entry, !running), line: steps?.type === 'steps' ? stepsLine(steps.details, !running).segments.map((one) => one.text).join(' · ') : '' }
}

describe('a helper in the background', () => {
  for (const [order, first] of [['launch first', [launched, started]], ['notice first', [started, launched]]] as const) {
    it(`works in the background, saying what it is doing, until it reports (${order})`, () => {
      const going = helper([...agentCall, ...first, progress], true)
      expect(going.said).toBe('working in the background · Reading src/app.test.ts · last tool Read')
      expect(going.entry.subagentType).toBe('Explore')
      expect(going.line).toContain('1 working in the background')
      const back = helper([...agentCall, ...first, progress, done], true)
      expect(back.said).toBe('reported back · 14 test files, all under src/')
      expect(back.line).not.toContain('working in the background')
    })
  }

  it('says it did not report when the turn ended with it still out', () => {
    expect(helper([...agentCall, launched, started], false).said).toBe('did not report')
  })
})
