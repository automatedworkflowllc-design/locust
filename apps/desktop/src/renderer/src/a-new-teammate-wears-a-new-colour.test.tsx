import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { NewTeammateDialog, freshHue } from './components/NewTeammateDialog.js'

/**
 * A NEW TEAMMATE STARTS ON A COLOUR THE TEAM DOES NOT WEAR YET.
 *
 * The design review (#7): "same default accent for every new teammate".
 * Every new teammate started on lime, so a team made by accepting the
 * defaults was one colour, and the faces that say whose each conversation is
 * could not tell its members apart.
 */
describe("a new teammate's colour", () => {
  it('is the first one nobody wears, then round again', () => {
    expect(freshHue([])).toBe('lime')
    expect(freshHue(['lime'])).toBe('blue')
    expect(freshHue(['lime', 'blue', 'violet'])).toBe('clay')
    expect(freshHue(['blue'])).toBe('lime')
    const everyOne = ['lime', 'blue', 'violet', 'clay', 'teal', 'butter', 'rose', 'slate', 'pearl'] as const
    expect(freshHue(everyOne)).toBe('lime')
    expect(freshHue([...everyOne, 'lime'])).toBe('blue')
  })

  it('is where the dialog opens, and an edit keeps the colour it has', () => {
    const noop = (): void => undefined
    const fresh = renderToStaticMarkup(<NewTeammateDialog error={undefined} mode="accept-edits" takenHues={['lime']} onCancel={noop} onCreate={noop} />)
    expect(fresh).toMatch(/aria-checked="true"[^>]*aria-label="Blue"|aria-label="Blue"[^>]*aria-checked="true"/)
    const rose = { teammateId: 'tm_rose', name: 'Rosa', hue: 'rose', role: 'Custom', createdAt: '2026-09-23T05:00:00.000Z', avatar: { headwear: 0, accessory: 0, mouth: 0 } } as never
    const edit = renderToStaticMarkup(<NewTeammateDialog error={undefined} mode="accept-edits" initial={rose} takenHues={['lime', 'rose']} onCancel={noop} onCreate={noop} />)
    expect(edit).toMatch(/aria-checked="true"[^>]*aria-label="Rose"|aria-label="Rose"[^>]*aria-checked="true"/)
  })
})
