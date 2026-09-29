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
const APP = readFileSync(fileURLToPath(new URL('../renderer/src/App.tsx', import.meta.url)), 'utf8')
const CONTEXT_MENU = readFileSync(fileURLToPath(new URL('../renderer/src/components/ContextMenu.tsx', import.meta.url)), 'utf8')

const rule = (selector: string): string => {
  const at = CSS.indexOf(selector)
  expect(at, `${selector} should exist`).toBeGreaterThan(-1)
  return CSS.slice(at, CSS.indexOf('}', at))
}

describe('the add menu', () => {
  it('is the right-click menu, hung from the +', () => {
    /*
     * Colin, 2026-09-24: "make the + button for new teammate and group the
     * same style as our right click dropdowns, those are way cleaner". It
     * was its own `lc-menu` dropdown, which needed three cascade fixes to
     * open downward, at its own width and above the workroom from a 64px
     * rail -- all of which the right-click menu never needed: it is drawn at
     * the window and kept inside it (0.311).
     */
    expect(SIDEBAR).not.toContain('lc-sidebar__addmenu')
    expect(CSS).not.toContain('lc-sidebar__addmenu')
    expect(SIDEBAR).toContain('onAddMenu(event.currentTarget)')
    expect(rule('.lc-context {')).toContain('position: fixed')
  })

  it('offers what the + adds, each with its key -- and no New group since folders sort (0.460)', () => {
    const menu = APP.slice(APP.indexOf('const openAddMenu'), APP.indexOf('const assignMissionTo'))
    expect(menu).toContain("{ label: 'New teammate', shortcut: 't'")
    expect(menu).toContain("{ label: 'New room', shortcut: 'r'")
    expect(menu).not.toContain("label: 'New group',")
  })

  it('leaves its own button alone, so a second press closes it instead of reopening it', () => {
    // An outside press closes a menu before the press does its own work; the
    // + is outside the menu, so without this a second press would close it
    // and the same click would open it again.
    expect(CONTEXT_MENU).toContain('useDismissOnOutsidePress(true, onClose, ref, anchor)')
    expect(APP).toContain('if (rowMenu?.anchor === anchor) {')
  })

  it('may still hang out of the rail, as the rail\u2019s flyouts do', () => {
    /*
     * `.lc-sidebar` carries a belt-and-braces `overflow: hidden` so no row
     * that miscalculates its width paints outside a fixed-width column. It
     * caught the add menu once (168x84 with everything past x=63 clipped),
     * then again at full width in 0.147.0. The add menu no longer lives in
     * the sidebar, but the rail's flyouts do, so the guard stays on the base
     * rule: a fix scoped to one width is a fix that waits for the other.
     */
    expect(rule(String.fromCharCode(10) + '.lc-sidebar {')).toContain('overflow: visible')
    expect(CSS, 'the brand must not clip it either').toContain('.lc-shell.is-compact .lc-sidebar__brand {')
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
