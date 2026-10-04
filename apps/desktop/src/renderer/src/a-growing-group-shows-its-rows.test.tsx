import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ActivityCard } from './components/ActivityCard.js'
import type { ActivityDetail } from './missionView.js'

/**
 * A GROWING GROUP SHOWS ITS ROWS (0.584).
 *
 * The steps line folds consecutive calls into one line with a count (0.491),
 * opened by a press. A model that works without narrating -- Flash, ten
 * minutes, 44 commands -- put its whole turn in that one line, and Colin
 * watched a counter instead of the work: "its stacking on one line". The
 * group still growing is handed `openByDefault` (missionView's `live`), so
 * its rows are on screen as they land, as Claude Code streams each call.
 */

const detail = (command: string): ActivityDetail =>
  ({ kind: 'shell', tool: 'Bash', name: command, settled: true, exitCode: 0 }) as ActivityDetail

const group = (openByDefault: boolean): string =>
  renderToStaticMarkup(
    <ActivityCard
      variant="steps"
      summary=""
      trace={[{ key: 'line', text: 'ran 2 commands' }]}
      finished={false}
      details={[detail('pnpm install'), detail('pnpm test')]}
      runtimeName={undefined}
      workspacePath="C:/work"
      openByDefault={openByDefault}
    />
  )

describe('the steps group still growing', () => {
  it('shows its rows under its line', () => {
    const html = group(true)
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('lc-steps__list')
    expect(html).toContain('pnpm install')
    expect(html).toContain('pnpm test')
  })

  it('a group that is not growing starts folded, as before (control)', () => {
    const html = group(false)
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('lc-steps__list')
    expect(html).toContain('ran 2 commands')
  })
})
