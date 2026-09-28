import { describe, expect, it } from 'vitest'

import { COMPARE_STARTERS } from './components/FirstLaunch.js'

/**
 * BUILD AND COMPARE STARTERS ASK FOR ONE PAGE (0.448).
 *
 * A column shows what it built by running it (0.446): a NEW .html file opens
 * as a page in its column. So a starter must ask for exactly that -- one named
 * .html file, everything inside it -- or the columns would show code and the
 * whole point, seeing the builds side by side, is gone.
 */
describe('the Home starters', () => {
  it('each ask for one named .html file with everything inside it', () => {
    expect(COMPARE_STARTERS.map((starter) => starter.label)).toEqual(['A landing page', 'A dashboard', 'A small game'])
    for (const starter of COMPARE_STARTERS) {
      expect(starter.prompt).toMatch(/^Make [a-z]+\.html: /)
      expect(starter.prompt).toMatch(/One file/)
    }
  })
})
