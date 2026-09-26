import { useState } from 'react'
import type { ReactElement } from 'react'

import { columnName } from '../../../shared/sheet.js'
import type { SheetTable, Workbook } from '../../../shared/sheet.js'

/**
 * A SPREADSHEET, DRAWN AS ONE (0.364).
 *
 * Column letters across the top, row numbers down the side, a tab per sheet
 * below it where Excel and Sheets keep theirs:
 * the grid every spreadsheet person already reads. Numbers sit right; a
 * formula the file holds no result for is shown as the formula, muted, with
 * one line saying why (nothing here works a formula out -- see
 * shared/sheet.ts). Every bound the host applied is said under the grid.
 *
 * `compact` is the fold's preview of a new CSV: the first rows only, and no
 * tabs, with the whole file one press away in the viewer.
 */
export const COMPACT_ROWS = 8

export function SheetView({ workbook, compact = false }: { readonly workbook: Workbook; readonly compact?: boolean }): ReactElement {
  const [shown, setShown] = useState(0)
  const sheet: SheetTable | undefined = workbook.sheets[Math.min(shown, workbook.sheets.length - 1)]
  if (sheet === undefined) return <p className="lc-sheet__note">This workbook has no sheets.</p>
  const rows = compact ? sheet.rows.slice(0, COMPACT_ROWS) : sheet.rows
  const width = sheet.rows[0]?.length ?? 0
  const formulas = sheet.rows.some((row) => row.some((cell) => cell.kind === 'formula'))
  const hiddenRows = sheet.moreRows + (sheet.rows.length - rows.length)
  return (
    <div className={`lc-sheet${compact ? ' is-compact' : ''}`}>
      {rows.length === 0 ? (
        <p className="lc-sheet__note">{sheet.name} is empty.</p>
      ) : (
        <div className="lc-sheet__scroll">
          <table className="lc-sheet__grid" aria-label={sheet.name}>
            <thead>
              <tr>
                <th className="lc-sheet__corner" aria-hidden="true" />
                {Array.from({ length: width }, (_, column) => (
                  <th key={`h${String(column)}`} className="lc-sheet__col" scope="col">
                    {columnName(column)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`r${String(index)}`}>
                  <th className="lc-sheet__row" scope="row">
                    {index + 1}
                  </th>
                  {row.map((cell, column) => (
                    <td key={`c${String(column)}`} className={`lc-sheet__cell is-${cell.kind}`} title={cell.text.length > 24 ? cell.text : undefined}>
                      {cell.text}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!compact && workbook.sheets.length > 1 && (
        <div className="lc-sheet__tabs" role="tablist" aria-label="Sheets">
          {workbook.sheets.map((one, index) => (
            <button
              type="button"
              key={`${one.name}-${String(index)}`}
              role="tab"
              aria-selected={index === shown}
              className={`lc-sheet__tab${index === shown ? ' is-active' : ''}`}
              onClick={() => setShown(index)}
            >
              {one.name}
            </button>
          ))}
        </div>
      )}
      {(hiddenRows > 0 || sheet.moreColumns > 0 || workbook.moreSheets > 0 || (formulas && !compact)) && (
        <p className="lc-sheet__note">
          {[
            hiddenRows > 0 ? `${String(hiddenRows)} more ${hiddenRows === 1 ? 'row' : 'rows'}` : undefined,
            sheet.moreColumns > 0 ? `${String(sheet.moreColumns)} more ${sheet.moreColumns === 1 ? 'column' : 'columns'}` : undefined,
            workbook.moreSheets > 0 ? `${String(workbook.moreSheets)} more ${workbook.moreSheets === 1 ? 'sheet' : 'sheets'}` : undefined
          ]
            .filter((part) => part !== undefined)
            .join(' · ')}
          {(hiddenRows > 0 || sheet.moreColumns > 0 || workbook.moreSheets > 0) && (compact ? ' in the file.' : ' not shown here.')}
          {formulas && !compact && (
            <>
              {hiddenRows > 0 || sheet.moreColumns > 0 || workbook.moreSheets > 0 ? ' ' : ''}
              A formula the file holds no result for is shown as written; Excel or Sheets works it out.
            </>
          )}
        </p>
      )}
    </div>
  )
}
