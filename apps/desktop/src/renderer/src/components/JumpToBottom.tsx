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
 */
export function JumpToBottom({
  shown,
  onClick
}: {
  readonly shown: boolean
  readonly onClick: () => void
}): ReactElement | null {
  if (!shown) return null
  return (
    <button
      type="button"
      className="lc-jumpdown"
      onClick={onClick}
      title="Go to the newest message"
      aria-label="Go to the newest message"
    >
      <Icon name="chevron-down" size={14} />
    </button>
  )
}
