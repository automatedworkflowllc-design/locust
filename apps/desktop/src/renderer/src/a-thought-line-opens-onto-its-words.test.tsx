import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ActivityCard } from './components/ActivityCard.js'

/**
 * A LINE THAT IS ONE THOUGHT OPENS ONTO ITS WORDS (0.493). Colin's frame,
 * 2026-09-30: "Considering fallback options" opened onto a row reading
 * "Thought for 7s · Considering fallback options", which opened onto the
 * headline a third time and then the paragraph. As Claude Code's thinking
 * does, the line opens straight onto what was thought, headline not repeated.
 */
const THOUGHT = '**Considering fallback options**\n\nMaybe the accessibility tree can be read instead.'

describe('a thought on its own line', () => {
  it('opens straight onto its words, without saying the headline again', () => {
    const html = renderToStaticMarkup(
      <ActivityCard
        variant="steps"
        summary=""
        trace={[{ key: 'what', text: 'Considering fallback options' }]}
        finished
        openByDefault
        details={[{ kind: 'reasoning', name: 'thought', settled: true, output: THOUGHT, durationMs: 7_000 }]}
        runtimeName={undefined}
        workspacePath={undefined}
      />
    )
    expect(html).toContain('lc-steps__thought')
    expect(html).toContain('Maybe the accessibility tree can be read instead.')
    expect(html).not.toContain('Thought for 7s')
    // Once, on the line.
    expect(html.split('Considering fallback options')).toHaveLength(2)
  })

  it('and a thought beside other steps reads the same way (0.515)', () => {
    // Colin, 2026-10-01: a thought and two reads opened onto "Thought for 3s · <headline>",
    // then the headline again -- "i think the first is cleaner, wanna stick with that?"
    const html = renderToStaticMarkup(
      <ActivityCard
        variant="steps"
        summary=""
        trace={[{ key: 'what', text: 'Considering fallback options' }]}
        finished
        openByDefault
        details={[
          { kind: 'reasoning', name: 'thought', settled: true, output: THOUGHT, durationMs: 3_000 },
          { kind: 'tool', id: 't1', name: 'grep_search', tool: 'grep_search', settled: true, failed: false }
        ] as never}
        runtimeName={undefined}
        workspacePath={undefined}
      />
    )
    expect(html).toContain('lc-steps__thought')
    expect(html).toContain('Maybe the accessibility tree can be read instead.')
    expect(html).not.toContain('Thought for 3s')
    expect(html).not.toContain('lc-filerow--thought')
    expect(html.split('Considering fallback options')).toHaveLength(2)
  })
})
