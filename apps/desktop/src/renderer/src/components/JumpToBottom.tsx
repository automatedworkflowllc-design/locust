import type { ReactElement } from 'react'

import { Icon } from './Icon.js'

/**
 * The way back down, offered only while the person is away from the bottom.
 *
 * Colin, 2026-09-13, with a picture of the control he means: a small chevron
 * pill, floating over the end of the conversation. Claude Code's, and every
 * chat surface's, for the same reason -- following the newest line stops the
 * moment somebody scrolls up to read, which is right, and then there is
 * nothing to end that state except dragging the scrollbar back by hand.
 *
 * Standing, not Said: it is a fact about the view, not the teammate talking,
 * so it is quiet, it carries no colour, and it is gone the instant it stops
 * being true.
 *
 * WORKING (0.703, Colin, with a picture of Claude's app): while the run is
 * still going, the pill wears the thread's own thinking dots instead of the
 * chevron, so someone reading higher up sees the teammate is still at it
 * without scrolling down to check. The chevron comes back on hover and
 * keyboard focus -- the moment the pill is about to be used as a button.
 */
export function JumpToBottom({
  shown,
  onClick,
  working = false
}: {
  readonly shown: boolean
  readonly onClick: () => void
  readonly working?: boolean
}): ReactElement | null {
  if (!shown) return null
  const label = working ? 'Still working. Go to the newest message' : 'Go to the newest message'
  return (
    <button
      type="button"
      className={`lc-jumpdown${working ? ' lc-jumpdown--working' : ''}`}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      {working && (
        <span className="lc-dots lc-jumpdown__dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      )}
      <span className="lc-jumpdown__chevron" aria-hidden="true">
        <Icon name="chevron-down" size={14} />
      </span>
    </button>
  )
}
