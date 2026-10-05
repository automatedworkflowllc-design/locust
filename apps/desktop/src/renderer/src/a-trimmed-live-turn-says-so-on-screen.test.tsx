import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { TRIMMED_TURN_LINE } from '../../shared/event-window.js'
import { withLiveEvents } from './liveEvents.js'
import { Thread } from './components/Thread.js'

const event = (sequence: number): NormalizedRuntimeEvent => ({
  id: `e${String(sequence)}`, runId: 'run', missionId: 'mission', sequence,
  occurredAt: '2026-10-05T12:00:00.000Z', sourceAdapter: 'claude',
  type: 'step.completed', payload: { stepKind: 'turn', evidence: { redacted: true } }
})
const shown = (count: number): string => {
  const held = withLiveEvents({ events: [] }, Array.from({ length: count }, (_, index) => event(index + 1)))
  return renderToStaticMarkup(
    <Thread prompt="Read the samples" earlierTurns={[]} {...held} running={true}
      restoredMission={undefined} error={undefined} errorIsPersistence={false} startedAt={undefined}
      approvals={[]} onDecide={() => undefined} onAnswerQuestion={() => undefined}
      decidingIds={[]} cancelled={false} handoff={undefined} onOpenPeerRun={() => undefined}
      peers={{ self: undefined, teammates: [], messages: [], notices: [] }} />
  )
}

describe('a trimmed live turn says so on screen', () => {
  it('shows the omission notice once when a running turn exceeds 3000 events', () => {
    expect(shown(3001).split(TRIMMED_TURN_LINE)).toHaveLength(2)
  })

  it('shows no omission notice below or exactly at 3000 events', () => {
    expect(shown(739)).not.toContain(TRIMMED_TURN_LINE)
    expect(shown(3000)).not.toContain(TRIMMED_TURN_LINE)
  })
})
