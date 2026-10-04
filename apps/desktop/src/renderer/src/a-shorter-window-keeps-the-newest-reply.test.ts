import { describe, expect, it } from 'vitest'

import hook from './useFollowBottom.ts?raw'

/**
 * A SHORTER WINDOW KEEPS THE NEWEST REPLY IN VIEW (0.409, fresh-eyes check).
 * The follow watched the thread's CONTENT for growth; a window made shorter
 * shrinks the scroller instead, with its scrollTop unchanged -- no growth, no
 * scroll event -- and "DONE" slid below the view. drive-a-conversation
 * measures it at 1440x900 then 1120x720.
 */
describe('following the newest reply', () => {
  it('watches the scrolling view as well as its content', () => {
    expect(hook).toContain('observer.observe(content)')
    expect(hook).toContain('observer.observe(box)')
  })

  it('goes back to the bottom when the view got shorter while following', () => {
    expect(hook).toContain('const shrank = box.clientHeight < lastView')
    expect(hook).toContain('if (following.current && (grew || shrank) && walking.current === 0)')
  })
})
