import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { DROP_WIDTH, EFFORT_TRACK_WIDTH, EffortSlider, stopPosition, THUMB_WIDTH } from './components/EffortSlider.js'
import { effortName } from './effortLevels.js'

/**
 * THE EFFORT CONTROL IS CLAUDE CODE'S, ON THE GOOEY SLIDER.
 *
 * Colin, 2026-09-22, with a frame of Claude Code's ("Effort Max", Faster to
 * Smarter, a dotted track, a white thumb): "make it like this but for UI,
 * we're just going to have to add fast variant and adjusted effort names for
 * each model variant"; 2026-09-23: "exact same type as Claude code fit to our
 * Ui". The liquid itself is the library's and runs in the window
 * (drive-effort-slider); these hold the words, the stops and the control.
 */

const draw = (props: Partial<Parameters<typeof EffortSlider>[0]> = {}): string =>
  renderToStaticMarkup(
    <EffortSlider
      bases={['low', 'medium', 'high', 'xhigh', 'max']}
      index={4}
      fast={false}
      hasFast={false}
      footer={undefined}
      onPick={() => undefined}
      onFast={() => undefined}
      {...props}
    />
  )

describe('a level', () => {
  it('is named in words, as Claude Code names it', () => {
    expect(effortName('max')).toBe('Max')
    expect(effortName('xhigh')).toBe('Extra high')
    expect(effortName('medium')).toBe('Medium')
  })

  it('this build does not know keeps the runtime’s own word, capitalised, never renamed', () => {
    expect(effortName('turbo')).toBe('Turbo')
    expect(effortName('')).toBe('')
  })
})

describe('the control', () => {
  it('reads "Effort Max", with a ? that says what the level costs', () => {
    const html = draw()
    expect(html).toMatch(/lc-effortpanel__label">Effort</)
    expect(html).toMatch(/lc-effortpanel__now">Max</)
    expect(html).toContain('title="Max: slowest, costliest"')
  })

  it('names the ends, Faster to Smarter, and draws a stop for every level the model has', () => {
    const html = draw()
    expect(html).toMatch(/<span>Faster<\/span><span>Smarter<\/span>/)
    expect(html.match(/lc-effortpanel__notch[ "]/g)).toHaveLength(5)
    // Everything up to the level reads as passed.
    expect(html.match(/lc-effortpanel__notch is-passed/g)).toHaveLength(5)
    expect(draw({ index: 1 }).match(/lc-effortpanel__notch is-passed/g)).toHaveLength(2)
  })

  it('puts the stops end to end along the track, and the thumb on its level', () => {
    expect(stopPosition(0, 5)).toBeGreaterThan(0)
    expect(stopPosition(4, 5)).toBeLessThan(EFFORT_TRACK_WIDTH)
    expect(stopPosition(0, 5) + stopPosition(4, 5)).toBeCloseTo(EFFORT_TRACK_WIDTH)
    expect(stopPosition(0, 1)).toBe(EFFORT_TRACK_WIDTH / 2)
    // The thumb, and the drop the liquid is made from, both centred on the level.
    expect(draw({ index: 2 })).toContain(`translateX(${String(stopPosition(2, 5) - THUMB_WIDTH / 2)}px)`)
    expect(draw({ index: 2 })).toContain(`translateX(${String(stopPosition(2, 5) - DROP_WIDTH / 2)}px)`)
  })

  it("draws the thumb over the liquid, not as it (Colin, 2026-09-24: \"our white ball/square is off\")", () => {
    // The drop is inside the liquid; the thumb is the next thing after the
    // liquid closes -- a crisp element, so the goo's blur cannot round it.
    expect(draw()).toMatch(/lc-effortpanel__liquid[\s\S]*lc-effortpanel__drop[\s\S]*<\/div><span class="lc-effortpanel__thumb"/)
  })

  it('is a real range input over the track: the browser keeps its keys, its snapping and its name', () => {
    const html = draw({ index: 2 })
    expect(html).toMatch(/<input class="lc-effortpanel__slider" type="range" min="0" max="4" step="1"[^>]*value="2"/)
    expect(html).toContain('aria-valuetext="High"')
    expect(draw({ bases: ['high'], index: 0 })).toMatch(/lc-effortpanel__slider[^>]*disabled/)
  })

  it('offers the fast variant as a switch where the model has one, and says it in the name', () => {
    expect(draw()).not.toContain('Fast variant')
    const fast = draw({ hasFast: true, fast: true, index: 2 })
    expect(fast).toContain('role="switch" aria-checked="true"')
    expect(fast).toMatch(/lc-effortpanel__now">High · Fast</)
  })
})
