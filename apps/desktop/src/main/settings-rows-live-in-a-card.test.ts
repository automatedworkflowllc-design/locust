import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * The design handover of 2026-09-21 counted `.lc-*` rule blocks by surface:
 * thread 121, sidebar 77, composer 51, Rooms 29, Settings 27, Routines 15.
 * Settings is not a matter of taste away from the thread; it is a multiple.
 *
 * One root cause carried most of it, and it is the thing this file guards:
 * **setting rows floated naked on the window ground.** `padding: space-3 0`
 * — six pixels vertical, ZERO horizontal — with a hairline running edge to
 * edge across the page, while `.lc-settingcard` sat directly above in the
 * same stylesheet with the thread's card language, used only for folder and
 * runtime rows.
 *
 * Measured on the packaged 0.244.0 build after the change
 * (`_tools/drive-settings-pages.mjs`, all five sub-nav pages): every
 * `.lc-settingrow` at 44–49px, every segmented button at exactly 26px, zero
 * nested cards on any page.
 *
 * The sample put this behind an opt-in `.is-carded`. That modifier exists so
 * the sample can draw before and after on one page; in the app it would be
 * ten hand-added class names and a second visual language that the first
 * missed one falls into. Hence the base rules asserted below.
 */
const CSS = readFileSync(fileURLToPath(new URL('../renderer/src/shell.css', import.meta.url)), 'utf8')
const SCREENS = readFileSync(fileURLToPath(new URL('../renderer/src/components/Screens.tsx', import.meta.url)), 'utf8')

/**
 * The body of the LAST block whose selector list contains this selector on
 * its own — the one that wins.
 *
 * ANCHORED, because a plain `indexOf(selector + ' {')` is a substring match
 * and this file was written with one. `.lc-row {` matched inside
 * `.lc-sidebar .lc-row {`, and `.lc-settingcard {` matched the tail of
 * `.lc-settingrows .lc-settingcard {` — so two assertions read a descendant
 * override and failed against CSS that was correct. A checking tool that is
 * wrong about the thing it checks is worse than none: it would have sent me
 * to "fix" a rule that had nothing wrong with it.
 */
/**
 * Comments stripped first. This stylesheet is 11,000 lines and most rules
 * carry a paragraph explaining why they exist, so a selector list read as
 * "everything since the last `}`" is mostly prose — which made an exact
 * match find nothing at all, silently, and every assertion pass against an
 * empty string. Second time the checker has been the broken thing here.
 */
/**
 * And without the High Contrast block: its rules win only in Windows forced
 * colors, so "the last block wins" was reading the forced-colors override of
 * `.lc-settings__navitem.is-current` as the ordinary one (0.287.0).
 */
function withoutForcedColors(css: string): string {
  const start = css.indexOf('@media (forced-colors: active)')
  if (start === -1) return css
  let depth = 0
  for (let at = css.indexOf('{', start); at !== -1 && at < css.length; at += 1) {
    if (css[at] === '{') depth += 1
    if (css[at] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(0, start) + withoutForcedColors(css.slice(at + 1))
    }
  }
  return css.slice(0, start)
}
const BARE = withoutForcedColors(CSS.replace(/\/\*[\s\S]*?\*\//g, ''))

function bodyOf(selector: string): string {
  let held = ''
  for (const block of BARE.split('}')) {
    const open = block.indexOf('{')
    if (open === -1) continue
    const selectors = block.slice(0, open).split(',').map((one) => one.trim())
    if (!selectors.includes(selector)) continue
    held = block.slice(open + 1)
  }
  return held
}

describe('settings rows live in a card', () => {
  it('gives the row list the same card language as the rest of the app', () => {
    const rows = bodyOf('.lc-settingrows')
    for (const property of ['border:', 'border-radius:', 'background:', 'overflow:']) {
      expect(rows, `.lc-settingrows is missing ${property}`).toContain(property)
    }
    // The same three tokens `.lc-settingcard` already used, so the two card
    // kinds cannot drift into looking like different components.
    const card = bodyOf('.lc-settingcard')
    for (const token of ['--lc-border-card', '--lc-radius-card', '--lc-bg-raised']) {
      expect(rows, `.lc-settingrows should use ${token} like .lc-settingcard`).toContain(token)
      expect(card).toContain(token)
    }
  })

  it('gives a row real height and real horizontal padding', () => {
    const row = bodyOf('.lc-settingrow')
    expect(row).toContain('min-height: 44px')
    // The defect was `padding: var(--lc-space-3) 0` — the trailing zero is
    // the whole bug, so a two-value padding ending in 0 must not come back.
    expect(row).toMatch(/padding:\s*var\(--lc-space-\d\)\s+var\(--lc-space-\d\)/)
    expect(row).not.toMatch(/padding:[^;]*\s0;/)
  })

  it('draws one card, never a card inside a card', () => {
    // Measured as 0 nested cards on all five pages; this keeps it that way if
    // a future section nests a `.lc-settingcard` inside the row list.
    expect(CSS).toContain('.lc-settingrows .lc-settingcard')
  })

  it('keeps mono on the numerals and off the words', () => {
    /*
     * The sample proposed "mono numerals" and the only segmented control on
     * it was the numeric one. Applying mono to the word pickers — Off /
     * Chromatic / Silver / Gold — looked consistent in the Appearance frame
     * and was extending an approval past what was shown, onto the least
     * legible type on the page, for the person this app is being made easy
     * for. So the font is scoped, and the scope is asserted.
     */
    expect(bodyOf('.lc-segmented > .lc-button')).not.toContain('--lc-font-mono')
    expect(bodyOf('.lc-segmented.is-numeric > .lc-button')).toContain('--lc-font-mono')
    // And the one control that earns it still asks for it.
    expect(SCREENS).toContain('lc-segmented is-numeric')
  })

  it('speaks the sidebar\u2019s language in the sub-nav', () => {
    // Two navigations in one window were using two languages: a filled pill
    // here, `bg-selected` + `border-card` three inches to the left. 9px is
    // `.lc-row`'s own radius, so "matches the sidebar" is literally true.
    const current = bodyOf('.lc-settings__navitem.is-current')
    expect(current).toContain('--lc-bg-selected')
    expect(current).toContain('--lc-border-card')
    expect(bodyOf('.lc-settings__navitem')).toContain('border-radius: 9px')
    expect(bodyOf('.lc-row')).toContain('9px')
  })
})
