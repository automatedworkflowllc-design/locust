import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { csvWorkbook } from '../../shared/sheet.js'
import type { Workbook } from '../../shared/sheet.js'
import { ActivityCard } from './components/ActivityCard.js'
import { FileViewer } from './components/FileViewer.js'
import { SheetView } from './components/SheetView.js'
import { producedFiles } from './missionView.js'

/** The shape the card takes; imported structurally rather than by name. */
type ActivityDetail = Parameters<typeof ActivityCard>[0]['details'][number]

/**
 * A SPREADSHEET OPENS AS A GRID (0.364).
 *
 * Penny's budget workbook was refused by the viewer -- "Locust does not open
 * that kind of file here" -- and, made by a Python command, it was not even
 * listed as a changed file (the Research & money drive, packaged 0.363).
 * Colin: "it could also show in a viewer or as an artifact like Claude code
 * does".
 */
const BUDGET: Workbook = {
  sheets: [
    {
      name: 'Monthly Budget',
      rows: [
        [{ text: 'Category', kind: 'text' }, { text: 'Budgeted', kind: 'text' }],
        [{ text: 'Rent', kind: 'text' }, { text: '$1,400.00', kind: 'number' }],
        [{ text: 'Total', kind: 'text' }, { text: '=SUM(B2:B2)', kind: 'formula' }]
      ],
      moreRows: 0,
      moreColumns: 0
    },
    { name: 'Notes', rows: [[{ text: 'Yellow cells are yours.', kind: 'text' }]], moreRows: 0, moreColumns: 0 }
  ],
  moreSheets: 0
}

describe('a spreadsheet in the viewer', () => {
  const html = renderToStaticMarkup(<SheetView workbook={BUDGET} />)

  it('is the grid a spreadsheet person reads: letters across, numbers down', () => {
    expect(html).toMatch(/<th class="lc-sheet__col" scope="col">A<\/th><th class="lc-sheet__col" scope="col">B<\/th>/)
    expect(html).toContain('<th class="lc-sheet__row" scope="row">3</th>')
    expect(html).toContain('<td class="lc-sheet__cell is-number">$1,400.00</td>')
  })

  it('shows a formula with no result as written, and says why once', () => {
    expect(html).toContain('<td class="lc-sheet__cell is-formula">=SUM(B2:B2)</td>')
    expect(html).toContain('A formula the file holds no result for is shown as written; Excel or Sheets works it out.')
  })

  it('has a tab per sheet, below the grid as Excel keeps them', () => {
    expect(html.indexOf('lc-sheet__tabs')).toBeGreaterThan(html.indexOf('lc-sheet__grid'))
    expect(html).toContain('>Notes</button>')
  })

  it('says what it did not draw', () => {
    const big = csvWorkbook('big.csv', Array.from({ length: 510 }, (_, index) => `row ${String(index + 1)},${String(index)}`).join('\n'), ',')
    expect(renderToStaticMarkup(<SheetView workbook={big} />)).toContain('10 more rows not shown here.')
  })

  it('draws cell text as text, never markup', () => {
    const hostile = csvWorkbook('x.csv', 'a,<img src=x onerror=alert(1)>\n', ',')
    const drawn = renderToStaticMarkup(<SheetView workbook={hostile} />)
    expect(drawn).not.toContain('<img')
    expect(drawn).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('is what the file viewer draws for a table', () => {
    const viewer = renderToStaticMarkup(
      <FileViewer path="C:/work/budget.xlsx" text="" mode="table" workbook={BUDGET} onClose={() => undefined} onReveal={() => undefined} onSave={() => undefined} />
    )
    expect(viewer).toContain('lc-sheet__grid')
    expect(viewer).toContain('budget.xlsx')
  })
})

const edit = (name: string, extra: Record<string, unknown>): ActivityDetail =>
  ({ kind: 'edit', name, tool: 'edit', settled: true, failed: false, ...extra }) as unknown as ActivityDetail

const fold = (details: readonly ActivityDetail[]): string =>
  renderToStaticMarkup(
    <ActivityCard summary="1 file" details={details} runtimeName="OpenCode" workspacePath="C:/work" finished openByDefault onOpenFile={() => undefined} />
  )

describe('a spreadsheet in the conversation', () => {
  it('previews a new CSV as its first rows', () => {
    const text = ['--- /dev/null', '+++ b/budget.csv', '@@ -0,0 +1,3 @@', '+Category,Budgeted', '+Rent,"1,400"', '+Food,500'].join('\n')
    const html = fold([edit('C:/work/budget.csv', { patch: { text } })])
    expect(html).toContain('lc-docpreview__table')
    expect(html).toContain('<td class="lc-sheet__cell is-number">1,400</td>')
    expect(html).toContain('Open budget.csv')
    expect(html).not.toContain('lc-diff__row')
  })

  it('names a workbook a command made as a changed file, and opens it', () => {
    const seen = edit('C:/work/monthly_budget.xlsx', { status: 'observed on disk' })
    const html = fold([seen])
    expect(html).toContain('changed · seen on disk')
    expect(html).toContain('aria-label="Open monthly_budget.xlsx"')
    expect(html).not.toContain('did not report the change')
    // And the Artifacts tab lists it.
    expect(producedFiles([seen], 'C:/work').map((file) => file.shown)).toEqual(['monthly_budget.xlsx'])
  })

  it("keeps the teammate's own word on a changed file the host could not read (0.597)", () => {
    // A report written into a dot-folder workspace: seen changed by name, never read.
    const html = fold([edit('C:/work/report.md', { tool: 'write_to_file', status: 'reported by the runtime, changed on disk' })])
    expect(html).toContain('changed · seen on disk')
    expect(html).toContain('>Write<')
    expect(html).not.toContain('did not report the change')
  })

  it('still says a runtime did not report a change it did not see on disk', () => {
    expect(fold([edit('C:/work/notes.md', {})])).toContain('OpenCode did not report the change')
  })
})
