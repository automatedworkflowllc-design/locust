import { describe, expect, it } from 'vitest'

import APP from './App.tsx?raw'
import { modelDisplayName, routeChrome } from './routeName.js'

/**
 * SAVE AS ROUTINE NAMES THE MODEL AS THE REST OF THE APP DOES (0.417).
 *
 * Fresh-eyes area 11: the dialog read "Marlow runs it on OpenCode /
 * opencode/nemotron-3-ultra-free" -- the raw id, where the composer and a
 * room answer say "OpenCode / Nemotron 3 Ultra Free".
 * drive-a-routine-from-scratch reads the dialog on the packaged build.
 */
describe('the routine dialog’s route', () => {
  it('is spelled by routeChrome, not the raw id', () => {
    const at = APP.indexOf('routeLabel={')
    const block = APP.slice(at, at + 700)
    expect(block).toContain('routeChrome(')
    expect(block).not.toContain('${routineDialog.route.model}`')
  })

  it('which reads as a person would say it', () => {
    expect(routeChrome('opencode', 'opencode/nemotron-3-ultra-free', modelDisplayName('opencode', 'opencode/nemotron-3-ultra-free'))).toBe('OpenCode / Nemotron 3 Ultra Free')
  })
})
