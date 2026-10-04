import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Thread } from './components/Thread.js'

/**
 * THE NEWEST GROUP STAYS FOLDED, AS CLAUDE CODE'S DOES (0.610).
 *
 * Since 0.584 the group still growing showed its rows as they landed, so the
 * newest stretch of a live turn was a long open list while every earlier one
 * was a line. Colin, 2026-10-05, beside Claude Code's app: "because that
 * recent row stays open, it give it, its own look ... wont be familiar to
 * claude users and myself." Claude Code folds every group until it is
 * pressed, the one still running included; so does Locust now.
 */
let sequence = 0
const event = (type: string, payload: Record<string, unknown>): NormalizedRuntimeEvent => {
  sequence += 1
  return {
    id: `e${String(sequence)}`, runId: 'r', missionId: 'm', sequence, occurredAt: '2026-10-05T09:00:00.000Z',
    sourceAdapter: 'claude', type, payload: { evidence: { redacted: true }, ...payload }
  } as unknown as NormalizedRuntimeEvent
}

const live = (): string =>
  renderToStaticMarkup(
    <Thread
      prompt="Run the tests"
      onOpenPeerRun={() => undefined}
      earlierTurns={[]}
      events={[
        event('run.started', {}),
        event('tool.started', { itemId: 't1', toolKind: 'tool_use', name: 'Bash', command: 'npm test', title: 'Run the tests', phase: 'started' }),
        event('tool.completed', { itemId: 't1', toolKind: 'tool_use', name: 'Bash', command: 'npm test', title: 'Run the tests', status: 'completed', exitCode: 0, phase: 'completed' }),
        event('tool.started', { itemId: 't2', toolKind: 'tool_use', name: 'Bash', command: 'npm run build', title: 'Build it', phase: 'started' })
      ]}
      running
      startedAtIso="2026-10-05T09:00:00.000Z"
      restoredMission={undefined}
      error={undefined}
      errorIsPersistence={false}
      startedAt={undefined}
      approvals={[]}
      onDecide={() => undefined}
      onAnswerQuestion={() => undefined}
      decidingIds={[]}
      cancelled={false}
      handoff={undefined}
      peers={{ self: undefined, teammates: [], messages: [], notices: [] }}
    />
  )

describe('the newest group of a live turn', () => {
  it('is a line, folded until pressed, as Claude Code draws it', () => {
    const markup = live()
    expect(markup).toContain('lc-steps__line')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).not.toContain('lc-steps__list')
  })
})
