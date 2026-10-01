import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ActivityCard } from './components/ActivityCard.js'
import { FileViewer } from './components/FileViewer.js'
import type { ActivityDetail, FileTurn } from './missionView.js'

/**
 * The file viewer, and the fold that now opens it.
 *
 * 0.203.0 shipped the panel and a drive proved it opens. A drive cannot
 * cheaply prove the two things that matter MOST about it, because both are
 * claims about what the markup does and does not contain:
 *
 *   1. Markdown is rendered as prose and anything else is not. A file in a
 *      workspace was written by a MODEL, so the difference between "rendered"
 *      and "interpreted" is the app's whole security position, not a
 *      presentation preference.
 *   2. Nothing here hands the file to the operating system. `shell.openPath`
 *      is refused in `reveal-file.ts` because opening would RUN a `.bat` or a
 *      `.ps1` the model had just named and written. If an Open button is ever
 *      added to this panel, this test is where the reason it must not be
 *      lives -- the same job `a-handed-file-is-a-control.test.tsx` does for
 *      the pill.
 */

const noop = (): void => undefined

const viewer = (over: { readonly text: string; readonly mode: 'markdown' | 'code'; readonly path?: string }): string =>
  renderToStaticMarkup(
    <FileViewer
      path={over.path ?? 'C:/work/docs/report.md'}
      text={over.text}
      mode={over.mode}
      onClose={noop}
      onReveal={noop}
      onSave={noop}
    />
  )

describe('the file viewer', () => {
  it('renders markdown as prose, not as its source', () => {
    const html = viewer({ text: '# The rollup\n\nTwo things went wrong.\n', mode: 'markdown' })
    expect(html).toContain('lc-viewer__prose')
    expect(html).toContain('The rollup')
    // The hash is markup in markdown. If it survives into the output the file
    // is being shown, not rendered, and the mode means nothing.
    expect(html).not.toContain('# The rollup')
  })

  it('renders anything else in its own scroll box, verbatim', () => {
    const html = viewer({ text: 'const total = a + b\n', mode: 'code', path: 'C:/work/sum.ts' })
    expect(html).toContain('lc-viewer__code')
    expect(html).toContain('const total = a + b')
    expect(html).not.toContain('lc-viewer__prose')
  })

  it('does not interpret the file, whichever mode it is in', () => {
    /*
     * The same hostile file both ways. React escapes every value it renders,
     * so this is a check that nothing on the path from disk to screen ever
     * stops going through React -- an innerHTML shortcut added later for a
     * "faster" code path is exactly what this catches.
     */
    const hostile = '<img src=x onerror="alert(1)">'
    for (const mode of ['markdown', 'code'] as const) {
      const html = viewer({ text: hostile, mode })
      // The words survive -- they are the file's own text and a viewer that
      // silently dropped them would be lying about the file. What must not
      // survive is the ELEMENT: no tag, so no attribute, so nothing to fire.
      expect(html).not.toMatch(/<img/i)
      expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
    }
  })

  it('offers no way to hand the file to the operating system', () => {
    const html = viewer({ text: 'notes\n', mode: 'markdown' })
    expect(html).toContain('Show it in the file manager')
    expect(html).toContain('Save a copy')
    expect(html).not.toMatch(/open\s+(externally|with|in\b(?!\s+the\s+panel))/i)
    // No link out of the panel either: a file's own text cannot become one,
    // and the head has no anchor of its own.
    expect(html).not.toContain('<a ')
  })

  it('says why there is no open button, rather than leaving a hole', () => {
    /*
     * Design agent's ruling, 2026-09-20: the three controls are right and
     * "what is absent is the reason". Without it a person reads the missing
     * control as an oversight instead of a decision -- and it makes Reveal
     * look like the safe fallback for something somebody forgot.
     */
    const html = viewer({ text: 'notes', mode: 'markdown' })
    expect(html).toContain('lc-viewer__register')
    // Said as what it does (0.515): shown here, never launched -- not "does not open", under a file it opened.
    expect(html).toContain('Shown here only: Locust never runs a file a teammate made, or opens it in another app.')
    expect(html).not.toContain('Locust does not open files')
  })

  it('names the file by its own name and keeps the whole path reachable', () => {
    const html = viewer({ text: 'notes\n', mode: 'markdown', path: 'C:/work/docs/report.md' })
    expect(html).toContain('report.md')
    // The path is too long for the pane at any useful width, so it lives in
    // the title. A viewer that says only `report.md` cannot tell you WHICH.
    expect(html).toContain('title="C:/work/docs/report.md"')
  })
})

const patch = (path: string): ActivityDetail =>
  ({
    kind: 'edit',
    name: path,
    tool: 'edit',
    settled: true,
    patch: {
      text: [
        `--- a/${path}`,
        `+++ b/${path}`,
        '@@ -1 +1,2 @@',
        ' first line',
        '+second line'
      ].join('\n')
    }
  }) as unknown as ActivityDetail

const fold = (onOpenFile?: (path: string) => void): string =>
  renderToStaticMarkup(
    <ActivityCard
      summary="edited 1 file"
      details={[patch('docs/report.md')]}
      runtimeName="OpenCode"
      workspacePath="C:/work"
      openByDefault
      {...(onOpenFile === undefined ? {} : { onOpenFile })}
    />
  )

describe('the activity fold, which is how a file is usually met', () => {
  it('offers to open a file it touched, not only to go find it', () => {
    /*
     * A handed file is a teammate CHOOSING to give you one, and most files
     * are not handed. Until this, the fold's only offer was the file manager,
     * so reading what a teammate wrote meant leaving the app.
     */
    const html = fold(noop)
    expect(html).toContain('lc-filerow__view')
    expect(html).toContain('lc-filerow__reveal')
    expect(html).toContain('Open docs/report.md')
  })

  it('still only reveals where nothing can open it', () => {
    // The card renders in places that have no viewer beside them. The control
    // must be absent there rather than present and inert.
    const html = fold()
    expect(html).not.toContain('lc-filerow__view')
    expect(html).toContain('lc-filerow__reveal')
  })
})

/**
 * The version strip: artifact support's (c), "show me what this looked like
 * three turns ago", over data the ledger already keeps.
 *
 * The claim under test is not that the strip renders. It is that the strip
 * NEVER CLAIMS TO BE THE FILE. Reverse-applying the recorded patches would
 * build a convincing document out of an incomplete record -- patches arrive
 * truncated, several runtimes report an edit with no diff at all -- so a
 * version shows what that turn CHANGED, and the words on screen have to say
 * so. If someone later adds reconstruction, this test is where the reason it
 * needs a complete record lives.
 */

const turn = (added: string): FileTurn => ({
  missionId: 'ms_1',
  prompt: 'add a line to the notes',
  counts: { added: 1, removed: 0 },
  truncated: false,
  reported: undefined,
  file: {
    path: 'C:/work/docs/report.md',
    status: 'modified',
    hunks: [
      {
        header: '@@ -1 +1,2 @@',
        heading: '',
        oldStart: 1,
        newStart: 1,
        rows: [{ kind: 'add', text: added, oldLine: undefined, newLine: 2 }]
      }
    ]
  }
}) as unknown as FileTurn

const withTurns = (turns: readonly FileTurn[]): string =>
  renderToStaticMarkup(
    <FileViewer
      path="C:/work/docs/report.md"
      text="# The rollup\n"
      mode="markdown"
      turns={turns}
      onClose={noop}
      onReveal={noop}
      onSave={noop}
    />
  )

describe('the versions of a file across turns', () => {
  it('counts the turns that changed it and offers each one', () => {
    const html = withTurns([turn('first'), turn('second')])
    expect(html).toContain('CHANGED IN 2 TURNS')
    expect(html).toContain('lc-viewer__version')
    // And a way back to the file itself, which is where it opens.
    expect(html).toContain('Now')
  })

  it('says one turn in the singular', () => {
    expect(withTurns([turn('only')])).toContain('CHANGED IN 1 TURN')
  })

  it('shows nothing at all for a file this conversation never changed', () => {
    const html = withTurns([])
    expect(html).not.toContain('lc-viewer__versions')
    expect(html).not.toContain('CHANGED IN')
  })

  it('opens on the file, not on a turn', () => {
    // The document is the thing that was asked for. A panel that opened on a
    // patch would answer a question nobody pressed.
    const html = withTurns([turn('first')])
    expect(html).toContain('lc-viewer__prose')
    expect(html).not.toContain('lc-viewer__versionnote')
  })

  it('never offers to show the file as it stood', () => {
    /*
     * The words are the feature's honesty. "Changed in" is a claim the
     * record supports; "as it looked" is one it does not.
     */
    const html = withTurns([turn('first'), turn('second')])
    expect(html).not.toMatch(/as it (looked|stood|was)/i)
    expect(html).not.toMatch(/\b(restore|revert|roll ?back)\b/i)
  })
})
