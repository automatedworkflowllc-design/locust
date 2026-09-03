import { Fragment, useMemo, useState } from 'react'
import type { ReactElement } from 'react'

import { HUNKS_SHOWN_FIRST, completenessOf, foldContext, hunkRange, pairedSpans } from '../diff.js'
import type { DiffCounts, DiffFile, DiffHunk, DiffRow, WordSpan } from '../diff.js'

/**
 * One file's change, unified, never side by side: the thread column caps at
 * 760px and two panes would leave forty mono characters each.
 *
 * Everything numeric on screen is derived from the rows by `diff.ts` -- the
 * `@@` line, the fold counts, the footer -- so the three numbers a reviewer
 * sees for one change cannot disagree. And the last thing in the box is
 * always a statement of completeness: `All N hunks shown`, an expand button
 * naming exactly what remains, or the remainder the record could not hold.
 * Silence after the last row would read as "that was everything".
 */
export function DiffView({
  file,
  truncated,
  reported
}: {
  readonly file: DiffFile
  /** The recorded text is shorter than the change the runtime made. */
  readonly truncated: boolean
  /** What the runtime counted across the whole change, before bounding. */
  readonly reported: DiffCounts | undefined
}): ReactElement {
  const [shownHunks, setShownHunks] = useState(Math.min(HUNKS_SHOWN_FIRST, file.hunks.length))
  const moreParsed = shownHunks < file.hunks.length
  // Parsed hunks are offered before the truncation is confessed: a reader
  // should see every line that was recorded, then be told what was not.
  const completeness = completenessOf(file, shownHunks, truncated && !moreParsed)
  return (
    <div className="lc-diff" role="region" aria-label={`Changes to ${file.path}`}>
      {file.hunks.slice(0, completeness.shownHunks).map((hunk, index) => (
        <Hunk key={`${String(hunk.oldStart)}-${String(hunk.newStart)}-${String(index)}`} hunk={hunk} />
      ))}
      <div className="lc-diff__foot">
        {completeness.canExpand ? (
          <button type="button" className="lc-diff__expand" onClick={() => setShownHunks(file.hunks.length)}>
            {completeness.statement}
          </button>
        ) : (
          <span>
            {completeness.statement}
            {truncated && reported !== undefined && (
              <>
                {' · the runtime counted '}
                <span className="lc-diff__addmark">+{reported.added}</span> <span className="lc-diff__delmark">−{reported.removed}</span>
                {' in all'}
              </>
            )}
          </span>
        )}
      </div>
    </div>
  )
}

function Hunk({ hunk }: { readonly hunk: DiffHunk }): ReactElement {
  const [openFolds, setOpenFolds] = useState<ReadonlySet<number>>(() => new Set())
  const spans = useMemo(() => pairedSpans(hunk.rows), [hunk])
  const segments = useMemo(() => foldContext(hunk.rows), [hunk])
  return (
    <>
      <div className="lc-diff__hunk">
        <span>{hunkRange(hunk)}</span>
        {hunk.heading.length > 0 && <span>{hunk.heading}</span>}
      </div>
      {segments.map((segment, index) => {
        if (segment.kind === 'rows' || openFolds.has(index)) {
          return segment.rows.map((row, rowIndex) => (
            <Row key={`${String(index)}-${String(rowIndex)}`} row={row} spans={spans.get(row)} />
          ))
        }
        return (
          <button
            key={`fold-${String(index)}`}
            type="button"
            className="lc-diff__fold"
            onClick={() => setOpenFolds(new Set([...openFolds, index]))}
          >
            <span className="lc-diff__foldmark" aria-hidden="true">
              ⋯
            </span>
            <span>
              {segment.count} unchanged line{segment.count === 1 ? '' : 's'}
            </span>
          </button>
        )
      })}
    </>
  )
}

/**
 * The sign column carries the same fact as the row fill, so the diff reads
 * without colour. Gutters are unselectable: a copy of the diff yields code.
 */
function Row({ row, spans }: { readonly row: DiffRow; readonly spans: readonly WordSpan[] | undefined }): ReactElement {
  return (
    <div className={`lc-diff__row is-${row.kind}`}>
      <span className="lc-diff__no" aria-hidden="true">
        {row.oldNo ?? ''}
      </span>
      <span className="lc-diff__no" aria-hidden="true">
        {row.newNo ?? ''}
      </span>
      <span className="lc-diff__sign">{row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ''}</span>
      <span className="lc-diff__code">
        {spans === undefined
          ? row.text
          : spans.map((span, index) =>
              span.changed ? (
                <mark key={String(index)} className="lc-diff__word">
                  {span.text}
                </mark>
              ) : (
                <Fragment key={String(index)}>{span.text}</Fragment>
              )
            )}
      </span>
    </div>
  )
}
