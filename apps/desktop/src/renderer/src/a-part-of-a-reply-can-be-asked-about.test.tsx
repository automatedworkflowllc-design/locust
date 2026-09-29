import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ImportDialog, ageOf } from './components/ImportDialog.js'
import { MAX_QUOTE, quoteOf } from './components/SelectionAsk.js'

/**
 * ASK ABOUT A PART OF A REPLY (a tester, 2026-09-29: "I can't select a
 * specific part of the chat to follow up on like I do using chatgpt"), and
 * the import dialog's first words.
 */
describe('a part of a reply, quoted into the box', () => {
  it('is quoted line by line, blank lines kept as quote lines', () => {
    expect(quoteOf('The rank is at most 3.\n\n\n\nSo AB is singular.')).toBe('> The rank is at most 3.\n>\n> So AB is singular.')
  })

  it('is cut past its limit, and says so with an ellipsis', () => {
    const quote = quoteOf('x'.repeat(MAX_QUOTE + 50))
    expect(quote.length).toBeLessThanOrEqual(MAX_QUOTE + 2)
    expect(quote.endsWith('…')).toBe(true)
  })
})

describe('the import dialog', () => {
  it('says it is looking before the list arrives, and names both runtimes', () => {
    const html = renderToStaticMarkup(
      <ImportDialog onList={() => new Promise(() => undefined)} onImport={async () => ({ ok: false, message: 'no' })} onImported={() => undefined} onCancel={() => undefined} />
    )
    expect(html).toContain('Import a conversation')
    expect(html).toContain('from Claude Code or Codex, the last 30 days')
    expect(html).toContain('Looking for your sessions…')
  })

  it('says ages the way the sidebar does', () => {
    const now = new Date('2026-09-29T20:00:00.000Z')
    expect(ageOf('2026-09-29T19:57:00.000Z', now)).toBe('3m')
    expect(ageOf('2026-09-29T15:00:00.000Z', now)).toBe('5h')
    expect(ageOf('2026-09-26T20:00:00.000Z', now)).toBe('3d')
  })
})
