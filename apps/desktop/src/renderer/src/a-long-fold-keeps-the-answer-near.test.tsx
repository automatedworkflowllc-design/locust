import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ActivityCard, FOLD_ROWS_SHOWN } from './components/ActivityCard.js'

/** The shape the card takes; imported structurally rather than by name. */
type ActivityDetail = Parameters<typeof ActivityCard>[0]['details'][number]

/**
 * A LONG FINISHED FOLD KEEPS THE ANSWER NEAR.
 *
 * Folds stay open when a turn finishes (Colin, 2026-09-08: "we want that to
 * stay so they can see after the fact"), and a twelve-file turn opened a
 * twenty-five-row fold 969px tall in an 800px window with the answer off the
 * screen (Yurt's #2 / B3; the 0.271 recheck, 9a). A finished fold shows its
 * first rows and says how many more; a running one shows everything.
 */
const command = (index: number): ActivityDetail =>
  ({ kind: 'shell', name: `echo step-${String(index)}`, settled: true, failed: false, exitCode: 0 }) as unknown as ActivityDetail

const drawn = (count: number, finished: boolean): string =>
  renderToStaticMarkup(
    <ActivityCard
      summary={`${String(count)} commands`}
      details={Array.from({ length: count }, (_, index) => command(index + 1))}
      runtimeName="Claude Code"
      workspacePath="C:/work"
      finished={finished}
      openByDefault
    />
  )

describe('a long fold', () => {
  it('shows its first rows once finished, and says how many more', () => {
    const html = drawn(25, true)
    expect(html).toContain(`echo step-${String(FOLD_ROWS_SHOWN)}<`)
    expect(html).not.toContain(`echo step-${String(FOLD_ROWS_SHOWN + 1)}<`)
    expect(html).toContain(`>Show ${String(25 - FOLD_ROWS_SHOWN)} more</button>`)
  })

  it('shows every row while the run is going', () => {
    const html = drawn(25, false)
    expect(html).toContain('echo step-25<')
    expect(html).not.toContain('lc-activity__more')
  })

  it('leaves a fold that is only a row or two over alone', () => {
    const html = drawn(FOLD_ROWS_SHOWN + 2, true)
    expect(html).toContain(`echo step-${String(FOLD_ROWS_SHOWN + 2)}<`)
    expect(html).not.toContain('lc-activity__more')
  })
})
