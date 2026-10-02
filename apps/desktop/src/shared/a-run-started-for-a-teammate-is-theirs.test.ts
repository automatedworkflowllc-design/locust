import { describe, expect, it } from 'vitest'

import { startAs } from './route-at-start.js'

/*
 * A RUN STARTED FOR A TEAMMATE IS THEIRS, WHOLE (H9).
 *
 * "Ask Rue for a review" on Jimothy's conversation went out as Jimothy -- his
 * id, his route, his mode -- because it was started from a closure made
 * before Rue was selected (code review H9). The tidy pass (A1.2) did the same
 * and went out as nobody's. `startAs` builds the start from the teammate's
 * own record instead.
 */

const COMPOSER = { route: { runtime: 'claude' as const, model: 'sonnet' }, mode: 'accept-edits' as const, effort: 'high' }
const RUE = { teammateId: 'tm_rue', route: { runtime: 'cursor' as const, model: 'composer-2.5', mode: 'ask' as const, effort: 'medium' } }

describe('who, on what, a run started for a teammate goes out as', () => {
  it('their id, their route, their mode and effort -- not what the composer was showing', () => {
    expect(startAs(RUE, COMPOSER, new Map())).toEqual({
      teammateId: 'tm_rue',
      route: { runtime: 'cursor', model: 'composer-2.5' },
      mode: 'ask',
      effort: 'medium'
    })
  })

  it('a route picked for their new chat wins, as it does in the box', () => {
    const picked = new Map([['new:tm_rue', { runtime: 'opencode' as const, model: 'opencode/muse-spark-1.3-contributor-free' }]])
    expect(startAs(RUE, COMPOSER, picked).route).toEqual({ runtime: 'opencode', model: 'opencode/muse-spark-1.3-contributor-free' })
  })

  it('a pick made in some conversation of theirs does not (0.552)', () => {
    const picked = new Map([['mission_other', { runtime: 'opencode' as const, model: 'opencode/muse-spark-1.3-contributor-free' }]])
    expect(startAs(RUE, COMPOSER, picked).route).toEqual({ runtime: 'cursor', model: 'composer-2.5' })
  })

  it('a teammate who has never run takes the composer\'s route, mode and effort, under their own id', () => {
    expect(startAs({ teammateId: 'tm_new' }, COMPOSER, new Map())).toEqual({
      teammateId: 'tm_new',
      route: { runtime: 'claude', model: 'sonnet' },
      mode: 'accept-edits',
      effort: 'high'
    })
  })

  it('a saved route with no effort sends none, rather than the composer\'s', () => {
    const { effort: _effort, ...route } = RUE.route
    expect(startAs({ teammateId: 'tm_rue', route }, COMPOSER, new Map()).effort).toBeUndefined()
  })
})
