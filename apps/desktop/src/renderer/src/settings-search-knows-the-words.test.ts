import { describe, expect, it } from 'vitest'

import { SETTINGS_PAGES, matchedHeadings, pageMatches } from './settingsPages.js'

/**
 * The settings search knows the words a person types, not only the words we chose.
 *
 * Grok's pass 9, 2026-09-18, typed four words into Settings on 0.177.0 and was
 * told the same thing every time: "Nothing matches. The pages are still here;
 * clear the search to see them."
 *
 *   memory    -> nothing        (it is under "What your team remembers")
 *   worktree  -> nothing        (it is under "Project folder")
 *   node      -> nothing        (the runtimes page is entirely about this)
 *   ledger    -> nothing        (a definition on "Privacy & local data")
 *
 * All four settings exist and three of those words are words the app itself
 * says to people. Their verdict, and it is the right one: "You will not find
 * memory if the search already told you it does not exist." A person who has
 * to scroll keeps looking. A person who is told nothing matches stops.
 *
 * The fix is not to rename the headings. "What your team remembers" is the
 * better sentence and "Memory" would turn the screen into a search index. The
 * words are filed under the heading they lead to instead, so the answer names
 * a place rather than echoing the question.
 */

/** The four words that were measured missing, and where each one lives. */
const THE_FOUR = [
  { typed: 'memory', page: 'teammates', heading: 'What your team remembers' },
  { typed: 'worktree', page: 'workspace', heading: 'Project folder' },
  { typed: 'node', page: 'runtimes', heading: 'Runtimes & accounts' },
  { typed: 'ledger', page: 'app', heading: 'Privacy & local data' }
] as const

/** Pages that answer a typed word, the way the screen filters them. */
const answering = (typed: string): readonly string[] =>
  SETTINGS_PAGES.filter((page) => pageMatches(page, typed)).map((page) => page.id)

describe('the words Grok typed and got nothing for', () => {
  it.each(THE_FOUR)('$typed finds the $page page', ({ typed, page }) => {
    expect(answering(typed)).toContain(page)
  })

  it.each(THE_FOUR)('$typed is answered with where it lives, not with itself', ({ typed, page, heading }) => {
    // The nav line under the page name. Echoing "memory" back would tell a
    // person nothing they did not just type; naming the heading tells them
    // what to read for once the page opens.
    const found = SETTINGS_PAGES.find((entry) => entry.id === page)
    expect(found).toBeDefined()
    expect(matchedHeadings(found!, typed)).toContain(heading)
  })

  it.each(THE_FOUR)('$typed does not drag in every page', ({ typed }) => {
    // A search that matches everything is the same dead end as one that
    // matches nothing: the list stops narrowing and stops being a search.
    expect(answering(typed).length).toBeLessThan(SETTINGS_PAGES.length)
  })
})

describe('the words that already worked', () => {
  // The control. These four were measured finding their page on 0.177.0, and
  // an index rewritten to fix the misses must not lose them.
  it.each([
    { typed: 'trash', page: 'app', heading: 'Trash' },
    { typed: 'connector', page: 'runtimes', heading: 'Connectors' },
    { typed: 'update', page: 'app', heading: 'Updates' },
    { typed: 'auto', page: 'teammates', heading: 'Auto mode' }
  ])('$typed still finds $heading', ({ typed, page, heading }) => {
    expect(answering(typed)).toContain(page)
    const found = SETTINGS_PAGES.find((entry) => entry.id === page)
    expect(matchedHeadings(found!, typed)).toContain(heading)
  })

  it('a word that is on no page still answers honestly', () => {
    // The other control. If everything matched, the tests above would pass
    // on an index that had learned nothing.
    expect(answering('kombucha')).toEqual([])
  })

  it('an empty search is not a match for everything by accident', () => {
    // The screen short-circuits before calling this, and the fallback is
    // still worth pinning: an empty query matching every page is correct,
    // and it must be because the code says so rather than by luck.
    expect(answering('').length).toBe(SETTINGS_PAGES.length)
  })
})

describe('the index itself', () => {
  it('files every extra word under a heading the page really has', () => {
    // An alias keyed to a heading that does not exist would match the page
    // and then name a place the person cannot find. The sibling guard
    // `settings-pages-are-real` already holds the headings to the JSX, so
    // this closes the loop from the other end.
    for (const page of SETTINGS_PAGES) {
      for (const heading of Object.keys(page.alsoKnownAs ?? {})) {
        expect(page.headings, `${page.id} -> ${heading}`).toContain(heading)
      }
    }
  })

  it('has extra words at all, on every page', () => {
    // The control for the guard above: with no aliases anywhere it passes
    // while finding nothing.
    for (const page of SETTINGS_PAGES) {
      expect(Object.keys(page.alsoKnownAs ?? {}).length, page.id).toBeGreaterThan(0)
    }
  })

  it('never repeats a word across two pages, which would make the search useless', () => {
    const seen = new Map<string, string>()
    for (const page of SETTINGS_PAGES) {
      for (const words of Object.values(page.alsoKnownAs ?? {})) {
        for (const word of words) {
          expect(seen.has(word), `"${word}" is on ${page.id} and ${seen.get(word) ?? ''}`).toBe(false)
          seen.set(word, page.id)
        }
      }
    }
  })
})
