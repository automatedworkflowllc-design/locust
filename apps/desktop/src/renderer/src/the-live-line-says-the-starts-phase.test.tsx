import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Thread } from './components/Thread.js'

/**
 * THE LIVE LINE SAYS THE START'S PHASE (0.602).
 *
 * The line's headline is the register word, swept ("Starting…"), and the
 * thread builder's label was only ever an aside beside it -- one that is
 * dropped when it is the register said twice. So the phase the host sent
 * ("Reading the folder") reached the builder, was put in the label, and
 * never drew: the dev drive of 2026-10-04 watched "Starting…" for the whole
 * 8.9 s wait while the window held the phase all along. The phase is the
 * register said more exactly, so it takes the word's place.
 */
const live = (startingLabel: string | undefined): string =>
  renderToStaticMarkup(
    <Thread
      prompt="Reply with one word"
      onOpenPeerRun={() => undefined}
      earlierTurns={[]}
      events={[]}
      running
      startedAtIso="2026-10-04T20:00:00.000Z"
      {...(startingLabel === undefined ? {} : { startingLabel })}
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

const sweep = (markup: string): string | undefined => /class="lc-sweep" data-text="([^"]*)"/.exec(markup)?.[1]

describe('the live line while a run starts', () => {
  it('leads with the phase, swept, in the place of the word "starting"', () => {
    const markup = live('Reading the folder')
    expect(sweep(markup)).toBe('Reading the folder…')
    expect(markup).not.toContain('Starting…')
    // The phase is the headline (data-text + text) and the label's title for
    // hover when the row ellipsizes — not an aside that repeats it beside the clock.
    expect(markup.split('Reading the folder').length - 1).toBe(3)
    expect(markup).toMatch(/lc-livestep__label" title="Reading the folder…"/)
  })

  it("names the runtime in the runtime's phase", () => {
    expect(sweep(live('Starting OpenCode'))).toBe('Starting OpenCode…')
  })

  it('still says "Starting…" when no phase has been sent', () => {
    expect(sweep(live(undefined))).toBe('Starting…')
  })
})
