import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { EARLIER_ROWS_SHOWN, Thread, firstEarlierTurnShown } from './components/Thread.js'

/*
 * A LONG CONVERSATION OPENS ON ITS NEWEST TURNS (0.573).
 *
 * Colin, 10/03: "hitching/lagging when clicking between two working
 * sessions". His Codex conversation is 1,538 messages and 1,032 step lines --
 * 23,635 elements built and laid out on every click into it, 0.6-0.8 s of a
 * frozen window each time (_tools/profile-real-switch.mjs on a copy of his
 * ledger). It now opens on its newest turns, up to EARLIER_ROWS_SHOWN rows,
 * and the older ones go on the page as the person scrolls up to them.
 */

const turnOf = (n: number, rows: number) => ({
  missionId: `mission_${String(n)}`,
  prompt: `Question number ${String(n)}.`,
  events: Array.from({ length: rows }, (_, at) => ({ type: 'message.delta', payload: { itemId: `m_${String(n)}_${String(at)}`, text: `Answer ${String(n)}.${String(at)}`, final: true } })) as never
})
const thread = (earlierTurns: readonly ReturnType<typeof turnOf>[]): string =>
  renderToStaticMarkup(
    <Thread
      prompt="The question now."
      onOpenPeerRun={() => undefined}
      earlierTurns={earlierTurns as never}
      events={[{ type: 'message.delta', payload: { itemId: 'now', text: 'The answer now.', final: true } }] as never}
      running={false}
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
      shownMissionId="mission_now"
      peers={{ self: undefined, teammates: [], messages: [], notices: [] }}
    />
  )

describe('which earlier turns go on the page', () => {
  it('the newest turns whose rows fit, oldest first index', () => {
    expect(firstEarlierTurnShown([])).toBe(0)
    expect(firstEarlierTurnShown([10, 10, 10])).toBe(0)
    expect(firstEarlierTurnShown([100, 100, 100, 100, 100], 400)).toBe(1)
    expect(firstEarlierTurnShown([300, 300], 400)).toBe(1)
  })

  it('the newest earlier turn always, however long', () => {
    expect(firstEarlierTurnShown([5, 900], 400)).toBe(1)
    expect(firstEarlierTurnShown([900], 400)).toBe(0)
  })

  it('each "show earlier" adds a budget', () => {
    const sizes = Array.from({ length: 20 }, () => 60)
    expect(firstEarlierTurnShown(sizes, EARLIER_ROWS_SHOWN)).toBe(14)
    expect(firstEarlierTurnShown(sizes, EARLIER_ROWS_SHOWN * 2)).toBe(7)
    expect(firstEarlierTurnShown(sizes, EARLIER_ROWS_SHOWN * 4)).toBe(0)
  })
})

describe('a conversation on screen', () => {
  it('a long one opens on its newest turns, with the older ones a press (or a scroll) away', () => {
    const html = thread(Array.from({ length: 20 }, (_, n) => turnOf(n, 60)))
    expect(html).toContain('Show 14 earlier turns')
    expect(html).not.toContain('Question number 13.')
    expect(html).not.toContain('Answer 0.0')
    expect(html).toContain('Question number 14.')
    expect(html).toContain('Question number 19.')
    // The turn in progress is never held back.
    expect(html).toContain('The answer now.')
  })

  it('a short one is whole, with nothing to press', () => {
    const html = thread(Array.from({ length: 3 }, (_, n) => turnOf(n, 5)))
    expect(html).not.toContain('earlier turn')
    expect(html).toContain('Question number 0.')
  })
})
