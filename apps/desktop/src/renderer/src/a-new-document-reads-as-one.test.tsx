import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ActivityCard } from './components/ActivityCard.js'
import { documentTextOf, isNewDocument } from './components/DocPreview.js'
import { parseUnifiedDiff } from './diff.js'

/** The shape the card takes; imported structurally rather than by name. */
type ActivityDetail = Parameters<typeof ActivityCard>[0]['details'][number]

/**
 * A NEW DOCUMENT READS AS ONE (0.363).
 *
 * Iris wrote a brand guide and the thread showed it as a green diff of raw
 * Markdown -- "+ ## Voice", "+ **We are:** welcoming" -- above her answer
 * (the Write & design drive, packaged 0.362). For a new file every line is
 * an addition, so the diff said nothing the page does not.
 */
const NEW_GUIDE = [
  'diff --git a/brand-guide.md b/brand-guide.md',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/brand-guide.md',
  '@@ -0,0 +1,5 @@',
  '+# Small Bakery Brand Guide',
  '+',
  '+## Colour Palette',
  '+',
  '+- **Crust** `#6B4226` for headlines'
].join('\n')

const EDITED_GUIDE = [
  'diff --git a/brand-guide.md b/brand-guide.md',
  '--- a/brand-guide.md',
  '+++ b/brand-guide.md',
  '@@ -1,3 +1,3 @@',
  ' # Small Bakery Brand Guide',
  '-Warm and plain.',
  '+Warm, plain and proud.',
  ' ## Colour Palette'
].join('\n')

const NEW_SCRIPT = ['--- /dev/null', '+++ b/build.ts', '@@ -0,0 +1,1 @@', '+export const x = 1'].join('\n')

const edit = (path: string, text: string): ActivityDetail =>
  ({ kind: 'edit', name: path, tool: 'write', settled: true, failed: false, patch: { text } }) as unknown as ActivityDetail

const fold = (detail: ActivityDetail, onOpenFile?: (path: string) => void): string =>
  renderToStaticMarkup(
    <ActivityCard
      summary="1 file"
      details={[detail]}
      runtimeName="OpenCode"
      workspacePath="C:/work"
      finished
      openByDefault
      {...(onOpenFile === undefined ? {} : { onOpenFile })}
    />
  )

describe('a new document in the fold', () => {
  it('is known: a new Markdown file, and nothing else', () => {
    expect(isNewDocument(parseUnifiedDiff(NEW_GUIDE)[0]!)).toBe(true)
    expect(isNewDocument(parseUnifiedDiff(EDITED_GUIDE)[0]!)).toBe(false)
    expect(isNewDocument(parseUnifiedDiff(NEW_SCRIPT)[0]!)).toBe(false)
  })

  it('is its written text, every added line in order', () => {
    expect(documentTextOf(parseUnifiedDiff(NEW_GUIDE)[0]!)).toBe('# Small Bakery Brand Guide\n\n## Colour Palette\n\n- **Crust** `#6B4226` for headlines')
  })

  it('is drawn as the page it is, with the whole file one press away', () => {
    const html = fold(edit('C:/work/brand-guide.md', NEW_GUIDE), () => undefined)
    expect(html).toContain('lc-docpreview')
    expect(html).toMatch(/<h3 class="lc-heading lc-heading--1"><span>Small Bakery Brand Guide<\/span><\/h3>/)
    // Its palette swatched, as in a reply.
    expect(html).toContain('style="background-color:#6B4226"')
    expect(html).toContain('Open brand-guide.md')
    expect(html).toContain('Show the change')
    // Not the diff: no line-by-line additions, no raw heading marks.
    expect(html).not.toContain('lc-diff__row')
    expect(html).not.toContain('## Colour Palette')
  })

  it('still opens a CHANGED document as its change, and a new script as code', () => {
    expect(fold(edit('C:/work/brand-guide.md', EDITED_GUIDE))).toContain('lc-diff__row')
    expect(fold(edit('C:/work/build.ts', NEW_SCRIPT))).toContain('lc-diff__row')
  })

  it('offers no Open where the fold has no viewer to open', () => {
    expect(fold(edit('C:/work/brand-guide.md', NEW_GUIDE))).not.toContain('Open brand-guide.md')
  })
})
