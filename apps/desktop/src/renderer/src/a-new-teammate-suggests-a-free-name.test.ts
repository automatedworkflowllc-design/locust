import { describe, expect, it } from 'vitest'

import { EXAMPLE_NAMES, suggestedName } from './components/NewTeammateDialog.js'
import screens from './components/Screens.tsx?raw'
import home from './components/HomeTeam.tsx?raw'
import card from './components/TeamCard.tsx?raw'

/**
 * THE NAME BOX SUGGESTS A NAME YOU CAN USE (0.408, fresh-eyes check). Its hint
 * was always "Wren"; after the Build software starter team, Wren was the one
 * name the box would refuse. And a teammate with no model yet reads the same
 * on Home and the Team screen.
 */
describe('the suggested name', () => {
  it('is Wren on an empty team', () => {
    expect(suggestedName([])).toBe('Wren')
  })

  it('skips every name already on the team, whatever its case', () => {
    expect(suggestedName(['Wren', 'Juno', 'Atlas'])).toBe('Robin')
    expect(suggestedName(['wren', 'ROBIN'])).toBe('Sable')
  })

  it('falls back to Wren once every example is taken (the box still says why a name is refused)', () => {
    expect(suggestedName([...EXAMPLE_NAMES])).toBe('Wren')
  })
})

describe('a teammate with no model yet', () => {
  it('is said the same way on Home and the Team screen', () => {
    expect(home).toContain("'runs on the model you pick'")
    // No "not run yet" (0.524): the card beside it can say "last run 5 minutes ago".
    expect(screens).toContain('<span>runs on the model you pick</span>')
    expect(screens).not.toContain('not run yet · runs on')
    expect(screens).not.toContain('route set by their first mission')
  })
})

/*
 * 0.408: the Share window said the image "can be dropped into Locust"; there
 * is no dropping -- Add team from image is the way in (the card's own footer
 * was corrected for the same claim in 0.398; this line was missed).
 */
describe('the Share team window', () => {
  it('names the way in, not a drop that does not exist', () => {
    expect(card).not.toContain('dropped into Locust')
    expect(card).toContain('can add the team from it with Add team from image')
  })
})
