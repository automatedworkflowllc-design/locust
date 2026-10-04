// Requested polish: "the compare route chip's full list on hover" and "a styled Ask a judge select" (executor plan, 2026-10-03).
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CompareView, type CompareColumnView } from './components/CompareView.js'
import { Composer, type ComposerProps } from './components/Composer.js'

describe('comparison controls', () => {
  it('uses the full visible comparison label for the route chip hover, including blind labels', () => {
    const props = { runtimes: [], limitedRuntimes: new Map(), discoveryPhase: 'ready', models: [], resolvedModels: new Map(), route: { runtime: 'opencode', model: 'free' }, mode: 'ask', onModeChange: () => undefined, onRouteChange: () => undefined, running: false, platform: 'win32' } as unknown as ComposerProps
    for (const label of ['Mimo V2.6 Flash Free vs Ling 3.0 Flash Fin Free vs Muse Spark 1.3 Contributor Free', 'Model A vs Model B vs Model C']) {
      const html = renderToStaticMarkup(<Composer {...props} asking={{ label, columns: 3 }} />)
      expect(html).toContain(`title="${label}"`)
    }
  })

  it('draws the judge as a styled select with a decorative standard chevron and all model options', () => {
    const columns: CompareColumnView[] = (['a', 'b'] as const).map((slot) => ({ slot, name: slot, runtime: 'opencode', runtimeName: 'OpenCode', turns: [], running: false, keepable: true, retryable: false, answer: 'Answer', state: 'done' }))
    const html = renderToStaticMarkup(<CompareView compare={{ compareId: 'cmp_test', prompt: 'Question', createdAt: '2026-10-03T00:00:00.000Z', slots: [] }} changeLines={{}} prompts={[]} columns={columns} owner={undefined} workspacePath={undefined} keeping={false} retrying={undefined} onKeep={() => undefined} onRetry={() => undefined} onBack={undefined} onJudge={() => undefined} judgeChoices={[{ key: 'free', label: 'Free judge' }, { key: 'other', label: 'Another judge', group: 'OpenCode' }]} />)
    expect(html).toMatch(/class="lc-compare__select"><select[^>]*aria-label="The model that judges"/)
    expect(html).toContain('class="lc-chevron"')
    expect(html).toContain('<optgroup label="OpenCode">')
  })
})
