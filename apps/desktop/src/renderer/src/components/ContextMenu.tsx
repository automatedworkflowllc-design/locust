import { useEffect, useRef, useState } from 'react'

import { useDismissOnOutsidePress } from '../useDismissOnOutsidePress.js'
import type { ReactElement } from 'react'

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
  /** A hairline above this row: a destructive item should not sit flush against an ordinary one. */
  readonly dividerAbove?: boolean
  /** When set, the item is shown but cannot be chosen, and says why. */
  readonly disabledReason?: string
  readonly onSelect?: () => void
}

export interface ContextMenuState {
  readonly x: number
  readonly y: number
  readonly title: string
  readonly items: readonly ContextMenuItem[]
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

  useEffect(() => {
    ref.current?.focus()
  }, [])

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
  const [openSub, setOpenSub] = useState<string>()

  useDismissOnOutsidePress(true, onClose, ref)

  return (
    <div
      ref={ref}
      className="lc-context"
      role="menu"
      tabIndex={-1}
      aria-label={state.title}
      style={{ left: state.x, top: state.y }}
      onMouseDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="lc-context__title">{state.title}</div>
      {state.items.map((item) => {
        const armed = armedLabel === item.label
        if (item.submenu !== undefined) {
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
            <div
              key={item.label}
              className="lc-context__row"
              onMouseEnter={() => setOpenSub(item.label)}
              onMouseLeave={() => setOpenSub(undefined)}
            >
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={open}
                className="lc-context__item"
                onClick={() => setOpenSub(open ? undefined : item.label)}
              >
                <span className="lc-context__label">{item.label}</span>
                <span className="lc-context__more" aria-hidden="true">›</span>
              </button>
              {open && (
                <div className="lc-context__sub" role="menu" aria-label={item.label}>
                  {item.submenu.map((entry) => (
                    <button
                      key={entry.label}
                      type="button"
                      role="menuitemradio"
                      aria-checked={entry.checked === true}
                      className="lc-context__item"
                      onClick={() => {
                        entry.onSelect?.()
                        onClose()
                      }}
                    >
                      <span className="lc-context__label">{entry.label}</span>
                      {/* The tick says which one it is already in, so the
                          list answers "where is this?" as well as offering
                          to move it. */}
                      {entry.checked === true && (
                        <span className="lc-context__tick" aria-hidden="true">✓</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        }
        return (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            className={`lc-context__item${item.danger === true ? ' is-danger' : ''}${item.dividerAbove === true ? ' is-divided' : ''}`}
            disabled={item.disabledReason !== undefined}
            title={item.disabledReason}
            onClick={() => {
              if (item.disabledReason !== undefined) return
              // A destructive item asks first, in place.
              if (item.confirmLabel !== undefined && !armed) {
                onArm(item.label)
                return
              }
              item.onSelect?.()
              onClose()
            }}
          >
            <span className="lc-context__label">{armed ? item.confirmLabel : item.label}</span>
            {/*
              * Said out loud, not left in a tooltip. A greyed item whose
              * reason only appears on hover is indistinguishable from a
              * broken one -- which is exactly how it was reported.
              */}
            {item.disabledReason !== undefined && (
              <span className="lc-context__why">{item.disabledReason}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
