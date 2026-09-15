import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * At 64px the rail is the whole app, so every control in it has to work.
 *
 * Colin, 2026-09-14: *"for rail mode maybe consolidate room and teammate add
 * into one +, looks clunky, also there is no locust logo to click in rail
 * mode to go to home"*. The first attempt at this shipped without anyone
 * looking at it and came back: *"the top part with the locust is an actual
 * disaster, and the + doesnt even function"*. It was reverted.
 *
 * What made that possible is that BOTH defects were invisible to every test
 * in this repo, and both were pure CSS:
 *
 * | measured | before | after |
 * | --- | --- | --- |
 * | the home button | `2x0 at 12,63` | `26x15 at 19,50` |
 * | the add menu | `306x2`, then clipped at x=63 | `168x84`, reachable at x=120 |
 *
 * A button of zero height renders, passes any "is it in the DOM" assertion,
 * and cannot be pressed. So these are written as the two cascade facts that
 * were actually wrong, both of which a reader would otherwise have to
 * reconstruct from two rules 1,300 lines apart.
 */

const CSS = readFileSync(fileURLToPath(new URL('../renderer/src/shell.css', import.meta.url)), 'utf8')
const SIDEBAR = readFileSync(fileURLToPath(new URL('../renderer/src/components/Sidebar.tsx', import.meta.url)), 'utf8')

const rule = (selector: string): string => {
  const at = CSS.indexOf(selector)
  expect(at, `${selector} should exist`).toBeGreaterThan(-1)
  return CSS.slice(at, CSS.indexOf('}', at))
}

describe('the add menu in the rail', () => {
  it('outranks .lc-menu on its own, rather than by sitting below it', () => {
    /*
     * `.lc-menu` opens UPWARD off the composer (`bottom: calc(100% + ...)`)
     * and is a fixed 306px. This menu hangs off a button at the TOP of the
     * rail, so it has to undo both.
     *
     * Written first as a single-class `.lc-sidebar__addmenu` block, which
     * changed nothing: one class against one class, and `.lc-menu` is
     * declared further down the file, so it won every property they share.
     * `bottom` stayed pinned while `top` was added, the box stretched
     * between both edges, and the menu opened two pixels tall.
     */
    expect(CSS).toContain('.lc-menu.lc-sidebar__addmenu {')
    const menu = rule('.lc-menu.lc-sidebar__addmenu {')
    expect(menu, 'a box pinned top AND bottom is as tall as the gap').toContain('bottom: auto')
    expect(menu).toContain('top:')
  })

  it('is not left to the base width, which is wider than the rail', () => {
    expect(rule('.lc-menu.lc-sidebar__addmenu {')).toContain('width: max-content')
  })

  it('may hang out of the rail, which is 64px and cannot contain it', () => {
    /*
     * `.lc-sidebar` carries a belt-and-braces `overflow: hidden` so no row
     * that miscalculates its width paints outside a fixed-width column. It
     * caught the one thing that is SUPPOSED to hang out: the menu's own box
     * measured 168x84 while everything past x=63 was clipped away, so half
     * of each item was unpressable.
     *
     * Lifting it is safe because `.lc-sidebar__scroll` is the scrolling
     * child -- the nav itself never scrolled, so nothing depended on the
     * clip.
     */
    expect(rule('.lc-shell.is-compact .lc-sidebar {')).toContain('overflow: visible')
    expect(CSS, 'the brand must not clip it either').toContain('.lc-shell.is-compact .lc-sidebar__brand {')
  })

  it('beats the workroom, which comes after the sidebar in the document', () => {
    expect(rule('.lc-menu.lc-sidebar__addmenu {')).toContain('z-index:')
  })

  it('exists only where the words do not', () => {
    // Widened out, both rows carry their own label and neither needs a menu.
    expect(SIDEBAR).toContain('compact ? (')
    expect(SIDEBAR).toContain('lc-sidebar__addmenu')
  })

  it('offers both things the two separate pluses used to', () => {
    expect(SIDEBAR).toContain('New teammate')
    expect(SIDEBAR).toContain('New room')
  })
})

describe('the way home', () => {
  it('is the mark, and it is a button', () => {
    expect(SIDEBAR).toContain('aria-label="Home"')
    expect(SIDEBAR).toContain('className="lc-brand__lockup"')
  })

  it('keeps a real size in the rail, where the wordmark collapses to nothing', () => {
    /*
     * The lockup is a flex ROW of mark + wordmark. In the rail the wordmark
     * is hidden, and with `overflow: hidden` on the row the mark came out
     * `2x0` -- a home button with no area at all, which is precisely "there
     * is no locust logo to click". The column stacks what is left and the
     * explicit size stops it collapsing again.
     */
    const brand = rule('.lc-shell.is-compact .lc-sidebar__brand {')
    expect(brand).toContain('flex-direction: column')
    const mark = rule('.lc-shell.is-compact .lc-brand__mark {')
    expect(mark).toMatch(/width:\s*\d+px/)
    expect(mark).toMatch(/height:\s*\d+px/)
  })
})
