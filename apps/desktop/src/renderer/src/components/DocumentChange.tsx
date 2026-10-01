import type { ReactElement } from 'react'

import type { ChangedPassage } from '../documentChange.js'

/**
 * A document's change as the passages a reader sees (0.530, documentChange.ts):
 * the old words struck, the new ones marked, nothing of the diff's machinery.
 * Escaped text only; nothing in a passage is rendered as markup.
 */
export function DocumentChange({ passages }: { readonly passages: readonly ChangedPassage[] }): ReactElement {
  if (passages.length === 0) {
    return <p className="lc-docchange__none">No words changed: only spacing or layout did.</p>
  }
  return (
    <ul className="lc-docchange" aria-label="What changed, in the document's words">
      {passages.map((passage, index) => (
        <li key={index} className={`lc-docchange__passage is-${passage.kind}`}>
          <span className="lc-docchange__what lc-mono">{passage.kind === 'changed' ? 'Changed' : passage.kind === 'added' ? 'Added' : 'Removed'}</span>
          <span className="lc-docchange__words">
            {passage.kind === 'changed' ? (
              <>
                {passage.before}
                {passage.removed.length > 0 && <del>{passage.removed}</del>}
                {passage.added.length > 0 && <ins>{passage.added}</ins>}
                {passage.after}
              </>
            ) : passage.kind === 'added' ? (
              <ins>{passage.text}</ins>
            ) : (
              <del>{passage.text}</del>
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}
