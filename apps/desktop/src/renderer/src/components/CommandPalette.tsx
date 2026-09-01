import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactElement } from 'react'

import { Icon } from './Icon.js'

export interface PaletteAction {
  readonly id: string
  readonly group: string
  readonly label: string
  readonly hint?: string
  readonly run: () => void
}

/**
 * The command palette.
 *
 * Every entry does something. The reference lists actions this build does not
 * have -- switch runtime, toggle swarm -- and a palette that offers a command
 * and then ignores it is worse than a shorter palette, so the caller supplies
 * only actions it can actually run.
 */
export function CommandPalette({
  actions,
  onClose
}: {
  readonly actions: readonly PaletteAction[]
  readonly onClose: () => void
}): ReactElement {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle.length === 0) return actions
    return actions.filter((action) => `${action.group} ${action.label}`.toLowerCase().includes(needle))
  }, [actions, query])

  useEffect(() => {
    setIndex(0)
  }, [query])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setIndex((current) => (matches.length === 0 ? 0 : (current + 1) % matches.length))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setIndex((current) => (matches.length === 0 ? 0 : (current - 1 + matches.length) % matches.length))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const action = matches[index]
      if (action !== undefined) {
        onClose()
        action.run()
      }
    }
  }

  let lastGroup: string | undefined

  return (
    <div className="lc-scrim lc-scrim--top" onKeyDown={onKeyDown}>
      <div className="lc-palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="lc-palette__head">
          <Icon name="search" size={14} />
          <input
            ref={inputRef}
            className="lc-palette__input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Type a command, teammate or mission…"
            aria-label="Command palette search"
            autoComplete="off"
          />
          <button type="button" className="lc-dialog__close" aria-label="Close palette" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="lc-palette__list">
          {matches.length === 0 ? (
            <p className="lc-inspector__empty" style={{ padding: '10px' }}>
              Nothing matches that.
            </p>
          ) : (
            matches.map((action, position) => {
              const header = action.group === lastGroup ? undefined : action.group
              lastGroup = action.group
              return (
                <div key={action.id}>
                  {header !== undefined && <div className="lc-palette__group">{header}</div>}
                  <button
                    type="button"
                    className={`lc-palette__item${position === index ? ' is-active' : ''}`}
                    onMouseEnter={() => setIndex(position)}
                    onClick={() => {
                      onClose()
                      action.run()
                    }}
                  >
                    <span className="lc-palette__label">{action.label}</span>
                    {action.hint !== undefined && <span className="lc-palette__hint">{action.hint}</span>}
                  </button>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
