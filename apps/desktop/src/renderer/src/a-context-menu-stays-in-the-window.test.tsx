import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ContextMenu, placeMenu } from './components/ContextMenu.js'
import type { ContextMenuItem } from './components/ContextMenu.js'

/**
 * A RIGHT-CLICK MENU STAYS IN THE WINDOW, and reads the way Claude's does.
 *
 * Colin, 2026-09-22, with his menu beside the one the Claude app draws:
 * "right click folding under window, also can we clean it up a little bit
 * like the one you use?" His ran off the bottom of the window -- it was
 * placed at the pointer and nothing asked whether it fitted -- under a title
 * bar, with one `Assign to <name>` row per teammate and a `›` wrapped onto a
 * line of its own.
 */

const VIEW = { width: 1477, height: 920 }
const MENU = { width: 220, height: 300 }

describe('where a menu opens', () => {
  it('at the pointer, when it fits there', () => {
    expect(placeMenu({ x: 200, y: 150 }, MENU, VIEW)).toEqual({ left: 200, top: 150 })
  })

  it('upward from the pointer, when it would run off the bottom', () => {
    // The screenshot's case: a row low in the sidebar.
    const at = { x: 120, y: 800 }
    const placed = placeMenu(at, MENU, VIEW)
    expect(placed.top).toBe(at.y - MENU.height)
    expect(placed.top + MENU.height).toBeLessThanOrEqual(VIEW.height - 8)
  })

  it('leftward from the pointer, when it would run off the right', () => {
    expect(placeMenu({ x: 1400, y: 150 }, MENU, VIEW).left).toBe(1400 - MENU.width)
  })

  it('held off the edge when neither side has room', () => {
    // A window barely taller than the menu, pointer in the middle.
    const small = { width: 500, height: 320 }
    const placed = placeMenu({ x: 100, y: 160 }, MENU, small)
    // Its bottom on the margin, which keeps it as near the pointer as the
    // window allows -- and all of it inside.
    expect(placed.top).toBe(small.height - 8 - MENU.height)
    expect(placed.top).toBeGreaterThanOrEqual(8)
  })
})

describe('what a menu draws', () => {
  const items: readonly ContextMenuItem[] = [
    { label: 'Open', shortcut: 'o', onSelect: () => undefined },
    { label: 'Rename', shortcut: 'r', onSelect: () => undefined },
    { label: 'Move to group', dividerAbove: true, submenu: [{ label: 'Work', checked: true }] },
    { label: 'Assign to', disabledReason: 'Wait for the run to finish before handing it over.', submenu: [{ label: 'Yurt' }] },
    { label: 'Delete', shortcut: 'd', dividerAbove: true, danger: true, confirmLabel: 'Delete for good?', onSelect: () => undefined }
  ]
  const html = renderToStaticMarkup(
    <ContextMenu
      state={{ x: 10, y: 10, title: 'Say hello to my friend Kevin', items }}
      armedLabel={undefined}
      onArm={() => undefined}
      onClose={() => undefined}
    />
  )

  it('has no title bar; what was clicked is the menu’s name', () => {
    expect(html).not.toContain('lc-context__title')
    expect(html).toContain('aria-label="Say hello to my friend Kevin"')
  })

  it('shows each row’s key at its end', () => {
    expect(html).toMatch(/Open<\/span><span class="lc-context__key"[^>]*>O</)
    expect(html).toMatch(/Delete<\/span><span class="lc-context__key"[^>]*>D</)
  })

  it('draws a hairline between kinds of action, and red for the one that deletes', () => {
    expect((html.match(/class="lc-context__sep"/g) ?? []).length).toBe(2)
    expect(html).toMatch(/class="lc-context__item is-danger/)
  })

  it('puts a list behind one row, and says why when it cannot open', () => {
    expect(html).toMatch(/aria-haspopup="menu"[^>]*>.*Move to group.*›/)
    // A list that cannot be used right now is a greyed row with its reason,
    // not an arrow into a list of things that would all refuse.
    expect(html).toMatch(/disabled=""[^>]*>.*Assign to.*Wait for the run to finish/)
  })
})
