import { describe, expect, it } from 'vitest'

import { addressedTeammate } from './App.js'

// Code review B4, renderer-thread (c): removing the teammate you had picked
// left the pick in place, and the composer then addressed the FIRST teammate
// in the roster -- someone the person never chose.
describe('who a message goes to', () => {
  const wren = { teammateId: 'tm_wren', name: 'Wren' }
  const ash = { teammateId: 'tm_ash', name: 'Ash' }

  it('is the teammate picked', () => {
    expect(addressedTeammate([ash, wren], 'tm_wren')).toBe(wren)
  }, 10_000)

  it('is nobody once that teammate is removed, never whoever is first', () => {
    expect(addressedTeammate([ash], 'tm_wren')).toBeUndefined()
  }, 10_000)

  it('is nobody when nobody was picked', () => {
    expect(addressedTeammate([ash, wren], undefined)).toBeUndefined()
  }, 10_000)
})
