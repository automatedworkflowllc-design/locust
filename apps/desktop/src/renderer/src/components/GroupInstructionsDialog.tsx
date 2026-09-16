import { useState } from 'react'
import type { KeyboardEvent, ReactElement } from 'react'

import type { PublicGroup } from '../../../shared/ipc.js'

/** The store's own cap, said here so the box cannot promise more than the file keeps. */
export const MAX_GROUP_INSTRUCTIONS = 4_000

/**
 * A group's standing instructions, edited as the GROUP'S.
 *
 * Colin's ruling of 2026-09-15, taking the stronger half of the design
 * agent's flag: a group is not only a folder. Filing a conversation into one
 * buys something -- every turn of it is briefed with these, after the
 * folder's own LOCUST.md and before memory. A folder that only sorts is a
 * tax people stop paying in week two.
 *
 * What it says about itself is exactly what is true: turns started from now
 * on, in conversations in this group. Turns already run were not briefed,
 * and nothing here claims they were.
 */
export function GroupInstructionsDialog({
  group,
  onSave,
  onCancel
}: {
  readonly group: PublicGroup
  readonly onSave: (instructions: string) => void
  readonly onCancel: () => void
}): ReactElement {
  const [text, setText] = useState(group.instructions)
  const trimmed = text.trim()
  const unchanged = trimmed === group.instructions.trim()
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
    }
  }
  return (
    <div className="lc-scrim" onKeyDown={onKeyDown}>
      <div className="lc-dialog" role="dialog" aria-modal="true" aria-label={`Standing instructions for ${group.name}`}>
        <div className="lc-dialog__head">
          <span className="lc-dialog__title">Standing instructions</span>
          <span className="lc-dialog__sub lc-mono">{group.name}</span>
          <button type="button" className="lc-dialog__close" aria-label="Close" onClick={onCancel}>
            ×
          </button>
        </div>
        <div className="lc-dialog__body">
          <p className="lc-groupinstructions__help">
            Given to every turn started from now on in any conversation in {group.name}, after the folder&apos;s own
            LOCUST.md. Turns already run were not briefed. Clear it and {group.name} is a plain folder again.
          </p>
          <textarea
            className="lc-input lc-groupinstructions__text"
            aria-label="Standing instructions"
            rows={8}
            maxLength={MAX_GROUP_INSTRUCTIONS}
            placeholder="Quote sizes in shares. Never propose a trade; analysis only."
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <span className="lc-groupinstructions__count lc-mono">
            {String(text.length)} / {String(MAX_GROUP_INSTRUCTIONS)}
          </span>
        </div>
        <div className="lc-dialog__foot">
          <button type="button" className="lc-button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="lc-primarybutton" disabled={unchanged} onClick={() => onSave(trimmed)}>
            {trimmed.length === 0 && group.instructions.length > 0 ? 'Clear instructions' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
