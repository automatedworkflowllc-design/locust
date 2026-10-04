import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ActivityCard } from './components/ActivityCard.js'

/** The shape the card takes; imported structurally rather than by name. */
type ActivityDetail = Parameters<typeof ActivityCard>[0]['details'][number]

/**
 * A finished run must not contain rows that claim to be running.
 *
 * Colin, 2026-09-20, on a completed Antigravity turn: *"kind of confused
 * whats happening here"*. The header said **completed**, the reply said *"I
 * am waiting for the test suite (pnpm test) to complete"*, and two rows in
 * the fold read `running` and `still running` — on a turn that had ended
 * minutes earlier.
 *
 * The app knew. That same fold's trace line said `ran 7 commands · 1 did not
 * report`, counted from the same events. Only the ROWS lied, because
 * `shellResult` and the tool row decided their word from `settled` alone and
 * were never handed `finished` — the helper row has taken it since
 * SURFACES-0.22 §2 and has read correctly the whole time.
 *
 * Amber rather than red on purpose: a tool that never reported is not a tool
 * that failed. The command may well have run.
 */

const shell = (settled: boolean): ActivityDetail =>
  ({ kind: 'shell', id: 's1', command: 'pnpm test', title: 'Running pnpm test', settled, failed: false }) as unknown as ActivityDetail

const openTool = (settled: boolean): ActivityDetail =>
  ({ kind: 'tool', id: 't1', name: 'grep_search', tool: 'grep_search', settled, failed: false }) as unknown as ActivityDetail

const drawn = (details: readonly ActivityDetail[], finished: boolean): string =>
  renderToStaticMarkup(
    <ActivityCard
      summary="1m 15s · 28 tool calls"
      details={details}
      runtimeName="Antigravity"
      workspacePath="C:/work"
      finished={finished}
      openByDefault
    />
  )

describe('a finished run has nothing still running in it', () => {
  it('says a command did not report once the turn is over', () => {
    const html = drawn([shell(false)], true)
    expect(html).toContain('did not report')
    expect(html).not.toContain('>running<')
  })

  it('says a tool did not report once the turn is over', () => {
    const html = drawn([openTool(false)], true)
    expect(html).toContain('did not report')
    expect(html).not.toContain('still running')
  })

  it('still says running while the turn is genuinely going', () => {
    // The whole point is the CONTRADICTION, not the word. A live run saying
    // `running` about a live command is the app working.
    expect(drawn([shell(false)], false)).toContain('running')
    expect(drawn([openTool(false)], false)).toContain('still running')
  })

  it('marks it stalled rather than failed', () => {
    // Amber, not red: nothing said it failed, and claiming so would invent an
    // outcome the runtime never reported.
    const html = drawn([shell(false), openTool(false)], true)
    expect(html).toContain('is-stalled')
    expect(html).not.toContain('is-failed')
  })

  it('leaves a settled row alone', () => {
    const html = drawn([shell(true)], true)
    expect(html).not.toContain('did not report')
  })
})
