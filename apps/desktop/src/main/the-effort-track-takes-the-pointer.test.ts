import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * THE EFFORT TRACK TAKES THE POINTER, NOT THE RANGE INPUT ON IT.
 *
 * The input is laid over the track, invisible, and was what the pointer
 * pressed: a stepped control, so a drag moved the thumb stop by stop and the
 * liquid under it had no motion to trail (Colin, 2026-09-23: "responds a
 * little oddly compared to claudes"). It stays the control for the keyboard
 * and the screen reader; the pointer goes through it to the track, which holds
 * the thumb (EffortSlider). And a held thumb's fill is where the thumb is,
 * not easing after it -- its ease put the two 38px apart (0.300).
 */
const shell = readFileSync(fileURLToPath(new URL('../renderer/src/shell.css', import.meta.url)), 'utf8')
const slider = readFileSync(fileURLToPath(new URL('../renderer/src/components/EffortSlider.tsx', import.meta.url)), 'utf8')
const rule = (selector: string): string => {
  const at = shell.indexOf(`${selector} {`)
  return at < 0 ? '' : shell.slice(at, shell.indexOf('}', at))
}

describe('the effort track', () => {
  it('lets the pointer through the input to the track', () => {
    expect(rule('.lc-effortpanel__slider')).toMatch(/pointer-events:\s*none/)
    expect(slider).toMatch(/onPointerDown=/)
    expect(slider).toMatch(/setPointerCapture/)
  })

  it('does not start a scroll or a selection with a drag', () => {
    expect(rule('.lc-effortpanel__scale')).toMatch(/touch-action:\s*none/)
    expect(rule('.lc-effortpanel__scale')).toMatch(/user-select:\s*none/)
  })

  it('keeps the fill under a held thumb', () => {
    expect(rule('.lc-effortpanel__scale.is-held .lc-effortpanel__fill')).toMatch(/transition:\s*none/)
  })
})
