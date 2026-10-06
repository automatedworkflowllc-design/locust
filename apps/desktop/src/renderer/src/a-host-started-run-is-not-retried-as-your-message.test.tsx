import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import { Thread } from './components/Thread.js'
import { runAgainOffer, turnPromptLine } from './missionView.js'
import type { LiveStarter } from './missionView.js'

const events = [{ id: 'e', runId: 'r', sequence: 1, type: 'run.failed', sourceAdapter: 'codex', occurredAt: '2026-10-06T12:00:00.000Z', payload: { message: 'The CLI refused its arguments.' } }] as NormalizedRuntimeEvent[]
const prompt = 'Atlas sent you a message; it is quoted below.'
const failed = { prompt, phase: 'failed', events }
const show = (turn: typeof failed & { startedBy?: LiveStarter }, offer: ReturnType<typeof runAgainOffer>) => renderToStaticMarkup(
  <Thread prompt={turn.prompt} startedBy={turn.startedBy} events={turn.events} running={false}
    {...offer} earlierTurns={[]} onOpenPeerRun={() => undefined} restoredMission={undefined} error="The CLI refused its arguments."
    errorIsPersistence={false} startedAt={undefined} approvals={[]} onDecide={() => undefined}
    onAnswerQuestion={() => undefined} decidingIds={[]} cancelled={false} handoff={undefined}
    peers={{ self: undefined, teammates: [], messages: [], notices: [] }} />
)

describe('retrying a never-started run', () => {
  it('withholds Run it again for a relay and never makes its briefing your bubble', () => {
    const turn = { ...failed, startedBy: { kind: 'relay' as const, hop: 1 } }
    const retry = vi.fn()
    const offer = runAgainOffer(turn, false, retry)
    expect(offer.onRunAgain).toBeUndefined()
    expect(offer.runAgainNote).toBe("The message is still waiting. It will be answered on this teammate's next run.")
    const html = show(turn, offer)
    expect(html).not.toContain('Run it again')
    expect(html).toContain('The message is still waiting.')
    expect(html).not.toContain(prompt)
    expect(turnPromptLine(turn)).toBeUndefined()
    expect(retry).not.toHaveBeenCalled()
  })

  it('still offers Run it again for your own never-started run', () => {
    const turn = { ...failed, prompt: 'Check the migration.' }
    const retry = vi.fn()
    const offer = runAgainOffer(turn, false, retry)
    expect(show(turn, offer)).toContain('Run it again')
    expect(offer.runAgainNote).toBeUndefined()
    offer.onRunAgain!()
    expect(retry).toHaveBeenCalledTimes(1)
    expect(turnPromptLine(turn)).toBe('Check the migration.')
  })

  it.each([
    { kind: 'routine', routineId: 'rt_1', step: 1 },
    { kind: 'resume', epoch: 1 },
    { kind: 'room', roomId: 'room_1', postId: 'post_1' },
    { kind: 'side', of: 'mission_1', question: 1 },
    { kind: 'compare', compareId: 'compare_1', slot: 'a' },
    { kind: 'judge', compareId: 'compare_1' }
  ] satisfies LiveStarter[])('keeps a $kind run with its host context', (startedBy) => {
    const offer = runAgainOffer({ ...failed, startedBy }, false, () => undefined)
    expect(offer.onRunAgain).toBeUndefined()
    expect(offer.runAgainNote).toContain('original control')
  })

  it('withholds a composer retry for live and recovered handoffs', () => {
    expect(runAgainOffer({ ...failed, handoff: {} }, false, () => undefined).onRunAgain).toBeUndefined()
    expect(runAgainOffer({ ...failed, restoredMission: { continuesFrom: { reason: 'route-switch' } } }, false, () => undefined).onRunAgain).toBeUndefined()
  })

  it('keeps ordinary follow-ups and person-authored origins retryable', () => {
    const retry = () => undefined
    expect(runAgainOffer({ ...failed, restoredMission: { continuesFrom: { reason: 'follow-up' } } }, false, retry).onRunAgain).toBe(retry)
    expect(runAgainOffer({ ...failed, startedBy: { kind: 'tag' } }, false, retry).onRunAgain).toBe(retry)
    expect(runAgainOffer({ ...failed, startedBy: { kind: 'terminal', exchange: 1 } }, false, retry).onRunAgain).toBe(retry)
  })

  it('keeps the existing failed-only, nonempty and never-started boundaries', () => {
    expect(runAgainOffer(failed, true, () => undefined)).toEqual({})
    expect(runAgainOffer({ ...failed, phase: 'completed' }, false, () => undefined)).toEqual({})
    expect(runAgainOffer({ ...failed, prompt: ' ' }, false, () => undefined)).toEqual({})
    expect(runAgainOffer({ ...failed, events: [{ ...events[0]!, type: 'run.started', payload: { runtimeThreadId: 'thread_1', evidence: { redacted: true } } }] }, false, () => undefined)).toEqual({})
  })

  it('the app uses the origin-aware offer for the current run', () => {
    const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
    expect(app).toContain('{...runAgainOffer(liveRun, running, () => void startMission(liveRun.prompt))}')
  })
})
