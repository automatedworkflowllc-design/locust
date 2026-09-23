import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Composer } from './components/Composer.js'
import type { ComposerProps } from './components/Composer.js'
import { HomeCover } from './components/HomeCover.js'

/**
 * THE MONO BEAMS.
 *
 * Colin, 2026-09-23, on https://libraries.dev/beam: "they have a loading hue
 * for their stop button lets just use that asset but make it mono instead to
 * make it subtle", and "lets add a rotate large mono around the title box
 * with the logo in it". Beam.tsx holds the one setting (mono, dark, no hue
 * shift, none under reduced motion); these hold where each one goes, and
 * when it is on.
 */

describe('the title box', () => {
  it('wears a beam round the card, and round nothing else', () => {
    const html = renderToStaticMarkup(<HomeCover ready tube="full" />)
    expect(html).toMatch(/<div data-beam="[^"]+"[^>]*class="lc-coverbeam"[^>]*><div class="lc-cover"/)
    expect(html.match(/<div data-beam=/g) ?? []).toHaveLength(1)
  })

  it('comes on with the lockup, once the runtimes have answered', () => {
    // The package marks a running beam `data-active`; the drive
    // (_tools/drive-beams.mjs) reads the animation itself off the built app.
    const wrapper = (ready: boolean): string =>
      /<div data-beam="[^"]+"[^>]*class="lc-coverbeam"[^>]*>/.exec(renderToStaticMarkup(<HomeCover ready={ready} tube="full" />))?.[0] ?? ''
    expect(wrapper(false)).not.toContain('data-active')
    expect(wrapper(true)).toContain('data-active')
  })
})

describe('the stop button', () => {
  const composer = (running: boolean): string =>
    renderToStaticMarkup(
      <Composer
        {...({
          runtimes: [],
          limitedRuntimes: new Map(),
          discoveryPhase: 'ready',
          models: [],
          resolvedModels: new Map(),
          route: { runtime: 'opencode', model: 'account-default', routeId: 'opencode:account-default' },
          mode: 'accept-edits',
          onModeChange: () => undefined,
          onRouteChange: () => undefined,
          onSend: () => undefined,
          onCancel: () => undefined,
          running,
          platform: 'win32'
        } as unknown as ComposerProps)}
      />
    )

  it('wears the beam while a run goes', () => {
    const html = composer(true)
    const beam = html.indexOf('class="lc-stopbeam"')
    expect(beam).toBeGreaterThan(-1)
    expect(html.indexOf('aria-label="Stop the running mission"')).toBeGreaterThan(beam)
  })

  it('has no beam when there is nothing to stop', () => {
    expect(composer(false)).not.toContain('lc-stopbeam')
  })
})
