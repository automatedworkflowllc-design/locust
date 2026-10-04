import { describe, expect, it } from 'vitest'

import { macCommandScript } from './open-in-terminal.js'

/**
 * A MAC OPENS ITS OWN TERMINAL (the first macOS build, 2026-09-29). Terminal
 * runs a `.command` file; this is the file's text.
 */
describe("the script Terminal runs on a Mac", () => {
  it('goes to the folder, removes itself, and becomes the resume -- every word quoted', () => {
    const script = macCommandScript({ file: '/opt/homebrew/bin/claude', args: ['--resume', 'abc-123'] }, "/Users/ian/My Project's", { ELECTRON_RUN_AS_NODE: '1', 'bad name': 'x' })
    expect(script.split('\n')).toEqual([
      '#!/bin/zsh -l',
      'rm -f -- "$0"',
      `cd '/Users/ian/My Project'"'"'s' || exit 1`,
      "export ELECTRON_RUN_AS_NODE='1'",
      "exec '/opt/homebrew/bin/claude' '--resume' 'abc-123'",
      ''
    ])
  })
})
