import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { useDismissOnOutsidePress } from '../useDismissOnOutsidePress.js'
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react'

/** The element the most recent right-click landed on (H11). */
let lastRightClicked: HTMLElement | null = null
if (typeof window !== 'undefined') {
  window.addEventListener(
    'contextmenu',
    (event) => {
      lastRightClicked = event.target instanceof HTMLElement ? event.target : null
    },
    true
  )
}

/**
 * A right-click menu for a row.
 *
 * The rule it keeps: a destructive item never acts on the first press. The
 * menu asks in place -- "Delete for good?" -- exactly as the workroom's own
 * delete control does, so the same action carries the same confirmation
 * wherever it is reached from. A context menu is a faster way to reach a
 * thing, not a way to skip being asked about it.
 *
 * It closes on Escape, on a click anywhere else, and on scroll, because a
 * menu that outlives the row it points at is pointing at nothing.
 *
 * DRAWN THE WAY CLAUDE'S IS. Colin, 2026-09-22, with his menu beside the one
 * the Claude app draws: "right click folding under window, also can we clean
 * it up a little bit like the one you use?" His had a title bar, one
 * `Assign to <name>` row per teammate, a `›` that had wrapped onto a line of
 * its own, and ran off the bottom of the window. Claude's is short rows, a
 * hairline between kinds of action, lists behind `›`, a key at the end of
 * the row, and Delete in red. So: no title (it stays the menu's accessible
 * name), lists as submenus, a real one-letter key per item that has one,
 * arrow keys, and the menu and its submenus kept inside the window.
 */

export interface ContextMenuItem {
  readonly label: string
  /**
   * A nested list, opened from this row rather than replacing the menu.
   *
   * For a choice with many destinations -- "Move to group" over every group
   * there is -- where listing each one at the top level would bury the
   * handful of things a person came to this menu for. An item with a submenu
   * has no `onSelect` of its own: choosing it means choosing from it.
   */
  readonly submenu?: readonly ContextMenuItem[]
  /** Ticked, for a submenu that shows which one is already chosen. */
  readonly checked?: boolean
  /** Shown instead of `label` once the item has been pressed once. */
  readonly confirmLabel?: string
  readonly danger?: boolean
  /** A hairline above this row, between kinds of action. */
  readonly dividerAbove?: boolean
  /** When set, the item is shown but cannot be chosen, and says why. */
  readonly disabledReason?: string
  /**
   * One letter that chooses this item while the menu is open, drawn at the
   * end of the row. Only where it is real: a key printed on a row that does
   * nothing when pressed is a dead control.
   */
  readonly shortcut?: string
  readonly onSelect?: () => void
}

export interface ContextMenuState {
  readonly x: number
  readonly y: number
  /** The menu's accessible name: what was right-clicked. Not drawn. */
  readonly title: string
  readonly items: readonly ContextMenuItem[]
  /**
   * The control it hangs from, when it opens from a button rather than a
   * right-click: a press on that control is the control's own business --
   * a second press closes the menu -- not a press somewhere else, which
   * would close it and let the same click open it again.
   */
  readonly anchor?: HTMLElement
}

/** How close a menu may come to the window's edge. */
const EDGE = 8

/**
 * Where a menu opened at (x, y) goes so that all of it is on screen: flipped
 * to the other side of the point along whichever axis it would cross, and
 * held off the edge if even that does not fit.
 *
 * Exported for its test. It is the whole of "folding under window": the
 * menu was placed at the pointer and nothing asked whether it fitted.
 */
export function placeMenu(
  at: { readonly x: number; readonly y: number },
  size: { readonly width: number; readonly height: number },
  view: { readonly width: number; readonly height: number }
): { readonly left: number; readonly top: number } {
  const across = (point: number, extent: number, room: number): number => {
    if (point + extent <= room - EDGE) return point
    const flipped = point - extent
    if (flipped >= EDGE) return flipped
    return Math.max(EDGE, room - EDGE - extent)
  }
  return { left: across(at.x, size.width, view.width), top: across(at.y, size.height, view.height) }
}

/** Items a key can move between, in the given panel only. */
function itemsIn(panel: Element | null): HTMLButtonElement[] {
  if (panel === null) return []
  return [...panel.querySelectorAll<HTMLButtonElement>('button[role^="menuitem"]')].filter(
    (button) => !button.disabled && button.closest('.lc-context__sub, .lc-context') === panel
  )
}

function Submenu({
  item,
  onPick,
  focusFirst
}: {
  readonly item: ContextMenuItem
  readonly onPick: (entry: ContextMenuItem) => void
  readonly focusFirst: boolean
}): ReactElement {
  const ref = useRef<HTMLDivElement>(null)
  const [left, setLeft] = useState(false)
  const [lift, setLift] = useState(0)

  /*
   * A submenu opens to the right of its row, and to the LEFT when the right
   * would cross the window's edge; it rises by however much it would hang
   * below the bottom. Measured before paint, so it never draws in the wrong
   * place first.
   */
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect()
    if (box === undefined) return
    if (box.right > window.innerWidth - EDGE) setLeft(true)
    const below = box.bottom - (window.innerHeight - EDGE)
    if (below > 0) setLift(Math.min(below, Math.max(0, box.top - EDGE)))
  }, [])

  useEffect(() => {
    if (focusFirst) itemsIn(ref.current)[0]?.focus()
  }, [focusFirst])

  return (
    <div
      ref={ref}
      className={`lc-context__sub${left ? ' is-left' : ''}`}
      style={lift > 0 ? { top: `calc(-5px - ${String(lift)}px)` } : undefined}
      role="menu"
      aria-label={item.label}
    >
      {(item.submenu ?? []).map((entry) => (
        <button
          key={entry.label}
          type="button"
          role="menuitemradio"
          aria-checked={entry.checked === true}
          className="lc-context__item"
          disabled={entry.disabledReason !== undefined}
          title={entry.disabledReason}
          onClick={() => onPick(entry)}
        >
          <span className="lc-context__label">{entry.label}</span>
          {/* The tick says which one it is already in, so the list answers
              "where is this?" as well as offering to move it. */}
          {entry.checked === true && (
            <span className="lc-context__tick" aria-hidden="true">✓</span>
          )}
        </button>
      ))}
    </div>
  )
}

export function ContextMenu({
  state,
  armedLabel,
  onArm,
  onClose
}: {
  readonly state: ContextMenuState
  /** Which item is waiting for its second press, if any. */
  readonly armedLabel: string | undefined
  readonly onArm: (label: string | undefined) => void
  readonly onClose: () => void
}): ReactElement {
  const ref = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ readonly left: number; readonly top: number }>({ left: state.x, top: state.y })
  const [openSub, setOpenSub] = useState<string>()
  // Opened from the keyboard, the submenu takes focus; opened by the pointer
  // it does not, or hovering across a row would steal focus from the menu.
  const [subFromKeys, setSubFromKeys] = useState(false)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect()
    if (box === undefined) return
    const next = placeMenu({ x: state.x, y: state.y }, box, { width: window.innerWidth, height: window.innerHeight })
    if (next.left !== place.left || next.top !== place.top) setPlace(next)
    // Placed once per opening: the point it was opened at is what it hangs
    // from, and `place` moving is the effect of this, not a cause.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.x, state.y])

  /*
   * ELSEWHERE, and this menu is not elsewhere.
   *
   * The close listened for any mousedown in the capture phase and asked
   * nothing about where it landed -- so pressing an item in this menu closed
   * the menu before the press became a click, and the item never ran. Every
   * right-click action in the app did nothing at all: Delete, Assign,
   * Copy mission id, Save as routine.
   *
   * It was reported twice. Colin, 2026-09-06: "the right click, assign to
   * teammate isnt work, along with the right click delete conversation." The
   * first outside tester, 2026-09-09: "It's the right click delete issue I
   * was having, the delete button on the actual convo is working." The first
   * investigation blamed disabled items whose reason was only in a tooltip,
   * which was a real defect and not this one.
   *
   * No drive caught it because a drive presses with `.click()`, which sends
   * no mousedown at all. The harness could not reproduce the one event that
   * breaks it -- so probe-rightclick-delete.mjs now sends a real
   * mousedown/mouseup/click, which is what a mouse sends.
   *
   * Capture is still right: a press anywhere else must close this before
   * that press does its own work, or a right-click on a second row stacks
   * two menus.
   */
  const anchor = useRef<HTMLElement | null>(null)
  // H11: a right-click menu has no anchor of its own, so the element that
  // was right-clicked stands in -- scrolling the list it is in still closes
  // the menu, and a scroll anywhere else (the thread following a reply) no
  // longer does.
  anchor.current = state.anchor ?? lastRightClicked
  if (anchor.current !== null && !anchor.current.isConnected) anchor.current = null
  useDismissOnOutsidePress(true, onClose, ref, anchor)

  const choose = (item: ContextMenuItem, clicks = 0): void => {
    if (item.disabledReason !== undefined || item.submenu !== undefined) return
    // A destructive item asks first, in place.
    if (item.confirmLabel !== undefined && armedLabel !== item.label) {
      onArm(item.label)
      return
    }
    // M34: the second click of a double-click is not a second decision.
    if (item.confirmLabel !== undefined && clicks > 1) return
    item.onSelect?.()
    onClose()
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const active = document.activeElement
    const inSub = active?.closest('.lc-context__sub') ?? null
    const panel = inSub ?? ref.current
    const items = itemsIn(panel)
    const at = active instanceof HTMLButtonElement ? items.indexOf(active) : -1
    const move = (index: number): void => {
      event.preventDefault()
      items[(index + items.length) % items.length]?.focus()
    }
    switch (event.key) {
      case 'ArrowDown':
        move(at + 1)
        return
      case 'ArrowUp':
        move(at < 0 ? items.length - 1 : at - 1)
        return
      case 'Home':
        move(0)
        return
      case 'End':
        move(items.length - 1)
        return
      case 'ArrowRight': {
        const trigger = active instanceof HTMLButtonElement && active.getAttribute('aria-haspopup') === 'menu' ? active : undefined
        if (trigger === undefined) return
        event.preventDefault()
        setSubFromKeys(true)
        setOpenSub(trigger.dataset.label)
        return
      }
      case 'ArrowLeft':
      case 'Escape': {
        // One level at a time: out of a submenu first, then out of the menu
        // (the dismiss hook does that part, on a key that got past here).
        if (openSub === undefined) return
        event.preventDefault()
        event.stopPropagation()
        const trigger = ref.current?.querySelector<HTMLButtonElement>(`button[data-label="${CSS.escape(openSub)}"]`)
        setOpenSub(undefined)
        trigger?.focus()
        return
      }
      default:
        break
    }
    // A letter chooses the item that shows it, in the top-level menu.
    if (inSub !== null || event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return
    const keyed = state.items.find((item) => item.shortcut?.toLowerCase() === event.key.toLowerCase())
    if (keyed === undefined) return
    event.preventDefault()
    choose(keyed)
  }

  return (
    <div
      ref={ref}
      className="lc-context"
      role="menu"
      tabIndex={-1}
      aria-label={state.title}
      style={{ left: place.left, top: place.top }}
      onMouseDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={onKeyDown}
    >
      {state.items.map((item, index) => {
        const armed = armedLabel === item.label
        const divider = item.dividerAbove === true && index > 0
          ? <div className="lc-context__sep" role="separator" />
          : null
        if (item.submenu !== undefined && item.disabledReason === undefined) {
          /*
           * A row that opens a list rather than doing something.
           *
           * Opened on HOVER as well as on press, because that is what a
           * submenu does everywhere else and a person reaching for it will
           * not think to click. It stays open while the pointer is anywhere
           * in the row or the panel, which is why both live inside one
           * element with the handler on it.
           */
          const open = openSub === item.label
          return (
            <Fragment key={item.label}>
            {divider}
            <div
              className="lc-context__row"
              onMouseEnter={() => {
                setSubFromKeys(false)
                setOpenSub(item.label)
              }}
              onMouseLeave={() => setOpenSub(undefined)}
            >
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={open}
                data-label={item.label}
                className={`lc-context__item${open ? ' is-open' : ''}`}
                onClick={() => setOpenSub(open ? undefined : item.label)}
              >
                <span className="lc-context__label">{item.label}</span>
                <span className="lc-context__more" aria-hidden="true">›</span>
              </button>
              {open && (
                <Submenu
                  item={item}
                  focusFirst={subFromKeys}
                  onPick={(entry) => {
                    if (entry.disabledReason !== undefined) return
                    entry.onSelect?.()
                    onClose()
                  }}
                />
              )}
            </div>
            </Fragment>
          )
        }
        return (
          <Fragment key={item.label}>
          {divider}
          <button
            type="button"
            role="menuitem"
            className={`lc-context__item${item.danger === true ? ' is-danger' : ''}${item.disabledReason !== undefined ? ' has-why' : ''}`}
            disabled={item.disabledReason !== undefined}
            title={item.disabledReason}
            aria-keyshortcuts={item.shortcut}
            onClick={(event) => choose(item, event.detail)}
          >
            <span className="lc-context__label">{armed ? item.confirmLabel : item.label}</span>
            {item.shortcut !== undefined && item.disabledReason === undefined && (
              <span className="lc-context__key" aria-hidden="true">{item.shortcut.toUpperCase()}</span>
            )}
            {/*
              * Said out loud, not left in a tooltip. A greyed item whose
              * reason only appears on hover is indistinguishable from a
              * broken one -- which is exactly how it was reported.
              */}
            {item.disabledReason !== undefined && (
              <span className="lc-context__why">{item.disabledReason}</span>
            )}
          </button>
          </Fragment>
        )
      })}
    </div>
  )
}
