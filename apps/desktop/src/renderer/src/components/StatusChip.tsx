import { useContext, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'

import { STATUS_CHOICES } from '../statusChips.js'
import type { StatusTone } from '../statusChips.js'
import { ThreadImagesContext } from '../threadImages.js'

/**
 * A status in a teammate's tracker, as a chip you can change (0.733): pressing it offers the other statuses, and
 * picking one writes "Mark <the row> as <status>." into the box for the person to send -- the teammate keeps the
 * tracker, so the change is told to it, never made behind its back. Where the thread has no box to write into
 * (a room's answer, a file preview), the chip is the plain chip it was.
 */
export function StatusChip({ tone, item, children }: { readonly tone: StatusTone; readonly item: string; readonly children: ReactNode }): ReactElement {
  const { onDraft } = useContext(ThreadImagesContext)
  const [open, setOpen] = useState(false)
  if (onDraft === undefined) return <span className={`lc-status lc-status--${tone}`}>{children}</span>
  return (
    <span className="lc-statuswrap">
      <button
        type="button"
        className={`lc-status lc-status--${tone} is-button`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Change the status of ${item}`}
        onClick={() => setOpen(!open)}
      >
        {children}
      </button>
      {open && (
        <span className="lc-statusmenu" role="menu">
          {STATUS_CHOICES.filter((choice) => choice.tone !== tone).map((choice) => (
            <button
              key={choice.label}
              type="button"
              role="menuitem"
              className="lc-statusmenu__item"
              onClick={() => {
                setOpen(false)
                onDraft(statusAsk(item, choice.label))
              }}
            >
              <span className={`lc-status lc-status--${choice.tone}`}>{choice.label}</span>
            </button>
          ))}
        </span>
      )}
    </span>
  )
}

/** The words a picked status puts in the box. */
export function statusAsk(item: string, status: string): string {
  return `Mark "${item}" as ${status} in the tracker, and say what that changes.`
}
