import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ActivityCard } from './components/ActivityCard.js'
import type { ActivityDetail } from './missionView.js'
import { InComparisonCell } from './pinnedPages.js'

/**
 * A PAGE A TEAMMATE MADE RUNS IN ITS TURN (0.580).
 *
 * A new web page opens on arrival (0.446), but the turn's files card --
 * one row per file, under the reply (0.494) -- opened nothing, so the page
 * sat as a folded `index.html ADDED` row: in any conversation, and after a
 * comparison's Keep brought the kept page in (drive-build-and-compare's
 * "the kept page still runs in the conversation", failing since at least
 * 0.570). The files card now opens a new page, and only a new page.
 */

const PAGE = ['--- /dev/null', '+++ b/index.html', '@@ -0,0 +1,2 @@', '+<!doctype html>', '+<h1>Cozy Corner Coffee</h1>'].join('\n')
const CHANGED_PAGE = ['--- a/index.html', '+++ b/index.html', '@@ -1,2 +1,2 @@', ' <!doctype html>', '-<h1>Old</h1>', '+<h1>New</h1>'].join('\n')
const SCRIPT = ['--- /dev/null', '+++ b/build.ts', '@@ -0,0 +1,1 @@', '+export const x = 1'].join('\n')

const edit = (path: string, text: string): ActivityDetail =>
  ({ kind: 'edit', name: path, tool: 'write', settled: true, failed: false, patch: { text } }) as unknown as ActivityDetail

/** The turn's files card, as Thread draws it under a reply. */
const turnFiles = (details: readonly ActivityDetail[]): string =>
  renderToStaticMarkup(
    <ActivityCard summary="" variant="files" oneRowPerFile trace={[{ key: 'edited', text: 'Edited' }]} finished details={details} runtimeName="OpenCode" workspacePath="C:/work" openByDefault />
  )

describe("a turn's files card", () => {
  it('opens a new web page, so it runs', () => {
    expect(turnFiles([edit('C:/work/index.html', PAGE)])).toContain('lc-docpreview')
  })

  it('opens the page even when another file came first, and only the page', () => {
    const html = turnFiles([edit('C:/work/build.ts', SCRIPT), edit('C:/work/index.html', PAGE)])
    expect(html).toContain('lc-docpreview')
    expect(html).not.toContain('export const x')
  })

  it("stays folded in a comparison's cell, whose page runs above it", () => {
    // Reopened after Keep, the kept column ran its page twice (dev drive, 0.580).
    const html = renderToStaticMarkup(
      <InComparisonCell.Provider value={true}>
        <ActivityCard summary="" variant="files" oneRowPerFile trace={[{ key: 'edited', text: 'Edited' }]} finished details={[edit('C:/work/index.html', PAGE)]} runtimeName="OpenCode" workspacePath="C:/work" openByDefault />
      </InComparisonCell.Provider>
    )
    expect(html).toContain('index.html')
    expect(html).not.toContain('lc-docpreview')
  })

  it('leaves a changed page and any other new file folded, as before', () => {
    expect(turnFiles([edit('C:/work/index.html', CHANGED_PAGE)])).not.toContain('lc-docpreview')
    expect(turnFiles([edit('C:/work/index.html', CHANGED_PAGE)])).not.toContain('<h1>New</h1>')
    expect(turnFiles([edit('C:/work/build.ts', SCRIPT)])).not.toContain('export const x')
  })
})
