import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { PoweredLockup, lightingPlan, nextLightingDelay } from './components/PoweredLockup.js'

/**
 * THE LOCKUP POWERS ON, after probing, and again every 7 to 10 seconds.
 *
 * Colin, 2026-09-22, on the design system cover's animation: "put this
 * animation where our current logo goes on the splash page ... make sure it
 * starts playing after the probing process, and maybe run that weird green
 * crt effect every 7-10 seconds so if the user missed it they can see it
 * again."
 */

describe('when the lockup lights', () => {
  it('follows the boot screen preference: full relights, subtle once, off never', () => {
    expect(lightingPlan('full', false)).toBe('repeat')
    expect(lightingPlan('subtle', false)).toBe('once')
    expect(lightingPlan('off', false)).toBe('none')
  })

  it('never, when the system asks for reduced motion', () => {
    expect(lightingPlan('full', true)).toBe('none')
    expect(lightingPlan('subtle', true)).toBe('none')
  })

  it('comes back 7 to 10 seconds after it last ended', () => {
    expect(nextLightingDelay(() => 0)).toBe(7_000)
    expect(nextLightingDelay(() => 1)).toBe(10_000)
    expect(nextLightingDelay(() => 0.5)).toBe(8_500)
    // A random source that misbehaves still lands inside the window.
    expect(nextLightingDelay(() => 7)).toBe(10_000)
    expect(nextLightingDelay(() => -1)).toBe(7_000)
  })
})

describe('what the lockup draws', () => {
  const html = renderToStaticMarkup(<PoweredLockup ready={false} tube="full" />)

  it('is the traced mark beside the name in live type, named Locust', () => {
    expect(html).toContain('role="img"')
    expect(html).toContain('aria-label="Locust"')
    // The mark's traced path, with its real outline -- not a placeholder.
    const paths = [...html.matchAll(/<path fill-rule="evenodd" d="([^"]+)"/g)].map((match) => match[1] ?? '')
    expect(paths).toHaveLength(1)
    expect(paths[0]!.length).toBeGreaterThan(10_000)
    // The name as the cover sets it: type, not the lighter traced wordmark.
    expect(html).toMatch(/<span class="lc-lockup__name" aria-hidden="true">Locust<\/span>/)
  })

  it('is still until the runtimes have answered', () => {
    expect(html).not.toContain('is-powering')
    expect(html).not.toContain('is-relighting')
  })
})
