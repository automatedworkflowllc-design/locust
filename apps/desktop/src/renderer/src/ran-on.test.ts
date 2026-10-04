import { describe, expect, it } from 'vitest'

import { folderName, platformName, ranOnLine } from './ranOn.js'

/*
 * The design agent's ruling, 2026-09-11: do not draw what a run could NOT
 * have checked. Choosing which absences matter is a judgement about what the
 * diff means -- the same inference the commands line already refuses, only
 * harder -- and without it the list is true of every run and becomes
 * furniture.
 *
 * "State scope, not absence." There is one fact here that needs no inference:
 * a run happened on one machine, in one environment. These pin that it is
 * only ever stated, never inferred.
 */
describe('the conditions a run happened under', () => {
  it('names a platform the way a person does', () => {
    expect(platformName('win32')).toBe('Windows')
    expect(platformName('darwin')).toBe('macOS')
    expect(platformName('linux')).toBe('Linux')
  })

  it('passes through a platform it does not know, rather than guessing', () => {
    // Every other branch is a rename, not an inference, and this one keeps it
    // that way: `freebsd` is still true.
    expect(platformName('freebsd')).toBe('freebsd')
  })

  it('says something true even knowing nothing', () => {
    expect(platformName('')).toBe('this machine')
    expect(ranOnLine({ platform: '' })).toBe('this machine')
  })

  it('names the folder only when it was given one', () => {
    // A recovered mission records its workspace as an id, not a path, so
    // printing today's folder beside an older run would be a claim nothing
    // supports -- and this line exists to be the part that cannot be wrong.
    expect(ranOnLine({ platform: 'win32' })).toBe('Windows')
    expect(ranOnLine({ platform: 'win32', folder: '' })).toBe('Windows')
    expect(ranOnLine({ platform: 'win32', folder: '   ' })).toBe('Windows')
    expect(ranOnLine({ platform: 'win32', folder: 'locust-astra' })).toBe('Windows · locust-astra')
  })

  it('says nothing about what was NOT covered', () => {
    // The ruling in one assertion: no absence, no warning, no verdict.
    const said = ranOnLine({ platform: 'win32', folder: 'locust-astra' }).toLowerCase()
    for (const word of ['not ', 'never', 'untested', 'missing', 'no ', 'without']) {
      expect(said, word).not.toContain(word)
    }
  })

  it('reads a folder off either separator, and off a trailing slash', () => {
    expect(folderName('C:\\Users\\<home>\\locust-astra')).toBe('locust-astra')
    expect(folderName('/home/you/proj/')).toBe('proj')
    expect(folderName(undefined)).toBeUndefined()
    expect(folderName('')).toBeUndefined()
  })
})
