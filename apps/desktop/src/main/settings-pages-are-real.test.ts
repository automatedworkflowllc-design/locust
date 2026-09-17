import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { SETTINGS_PAGES } from '../renderer/src/components/Screens.js'

/**
 * The settings search knows every setting that is actually on the page.
 *
 * `SETTINGS_PAGES` lists each page's headings so that typing "auto" finds
 * Auto mode rather than only matching page names. That list is written by
 * hand beside JSX that renders the headings, which is exactly the shape that
 * drifts: add a section, forget the index, and the search quietly stops
 * finding it. Nothing on screen looks wrong, which is what makes it bad.
 *
 * So the index is held to the file: every `lc-settings__heading` the screen
 * renders is in it, and nothing is in it that the screen does not render.
 *
 * Lives with the main-process guards because it reads the disk, and the
 * renderer's tsconfig carries no node types.
 */

const SOURCE = readFileSync(
  fileURLToPath(new URL('../renderer/src/components/Screens.tsx', import.meta.url)),
  'utf8'
)

/** Every settings heading the file renders, in the order it renders them. */
function renderedHeadings(): readonly string[] {
  const found: string[] = []
  const pattern = /<h2 className="lc-settings__heading">([^<]+)<\/h2>/g
  for (const match of SOURCE.matchAll(pattern)) {
    const text = (match[1] ?? '').trim()
    // JSX writes `&amp;` for an ampersand; the index holds what a person reads.
    if (text.length > 0) found.push(text.replace(/&amp;/g, '&'))
  }
  return found
}

describe('the settings pages', () => {
  it('are found at all, so this cannot pass by reading nothing', () => {
    // The control. An extractor that matches nothing would call every index
    // complete, including an empty one.
    expect(renderedHeadings().length).toBeGreaterThan(10)
    expect(SETTINGS_PAGES.length).toBeGreaterThan(3)
  })

  it('index every heading the screen renders, and invent none', () => {
    const rendered = [...renderedHeadings()].sort()
    const indexed = [...SETTINGS_PAGES.flatMap((page) => page.headings)].sort()
    expect(indexed).toEqual(rendered)
  })

  it('give every page a name and at least one setting', () => {
    for (const page of SETTINGS_PAGES) {
      expect(page.label.length, page.id).toBeGreaterThan(0)
      expect(page.headings.length, page.id).toBeGreaterThan(0)
    }
    // Ids are what the current page is stored as; two the same would make one
    // of the pages unreachable.
    expect(new Set(SETTINGS_PAGES.map((page) => page.id)).size).toBe(SETTINGS_PAGES.length)
  })

  it('are the areas the screen actually splits on', () => {
    // Each page boundary in the JSX is written as `shownPage === '<id>'`, so a
    // page in the index with no branch would render nothing at all.
    for (const page of SETTINGS_PAGES) {
      expect(SOURCE, page.id).toContain(`shownPage === '${page.id}'`)
    }
  })
})
