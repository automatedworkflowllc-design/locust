import { useState } from 'react'
import type { ReactElement } from 'react'

import { copyText } from '../copyText.js'
import { Icon } from './Icon.js'

/**
 * COPY, the way Claude Code offers it (0.545). Colin, 2026-10-03: "add a copy
 * button the way claude code does for files and md outputs ... slightly
 * quicker than saving and then adding from downloads."
 *
 * `text` is what to copy, or a function that fetches it (a file's text is
 * read only when asked). When it cannot be had, the button says so in its
 * tooltip and a short word, never silently.
 */
export function CopyButton({
  text,
  label,
  className
}: {
  readonly text: string | (() => Promise<string | { readonly refused: string }>)
  /** What is copied, for the accessible name: "this reply", "notes.md". */
  readonly label: string
  readonly className: string
}): ReactElement {
  const [state, setState] = useState<'idle' | 'copied' | { readonly refused: string }>('idle')
  const settle = (next: 'copied' | { readonly refused: string }): void => {
    setState(next)
    window.setTimeout(() => setState('idle'), next === 'copied' ? 1_600 : 4_000)
  }
  const copy = async (): Promise<void> => {
    const got = typeof text === 'string' ? text : await text().catch(() => ({ refused: 'It could not be read, so nothing was copied.' }))
    if (typeof got !== 'string') {
      settle(got)
      return
    }
    settle((await copyText(got)) ? 'copied' : { refused: 'The clipboard did not take it, so nothing was copied.' })
  }
  const refused = typeof state === 'object' ? state.refused : undefined
  return (
    <button
      type="button"
      className={className}
      aria-label={state === 'copied' ? `Copied ${label}` : `Copy ${label}`}
      title={refused ?? (state === 'copied' ? 'Copied' : 'Copy')}
      onClick={() => void copy()}
    >
      <Icon name={state === 'copied' ? 'check' : 'copy'} size={12} />
      {state === 'copied' && <span className="lc-copy__said">Copied</span>}
      {refused !== undefined && <span className="lc-copy__said">Not copied</span>}
    </button>
  )
}
