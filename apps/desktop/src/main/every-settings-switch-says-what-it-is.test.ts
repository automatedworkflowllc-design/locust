import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * EVERY SETTINGS SWITCH SAYS WHAT IT IS (0.419).
 *
 * Fresh-eyes area 13: Between teammates showed two switches labelled only by
 * their current state -- "Messages wait for the recipient's next run." --
 * so neither said what it controlled, and four switches (those two, Swarm,
 * Auto mode) were "Switch this on" to a screen reader. drive-settings-every-page
 * reads every switch's name on every page of the packaged build.
 */
const screens = readFileSync(fileURLToPath(new URL('../renderer/src/components/Screens.tsx', import.meta.url)), 'utf8')

describe('Settings switches', () => {
  it('are named for what they control', () => {
    for (const name of ['Automatic replies', 'Urgent messages interrupt', 'Swarm', 'Auto mode']) {
      expect(screens).toContain(`aria-label="${name}"`)
    }
    expect(screens).not.toContain("'Switch this off' : 'Switch this on'")
  })

  it('and the two between teammates say their name before their state', () => {
    expect(screens).toContain("'Automatic replies: off. Messages wait for the recipient\\'s next run.'")
    expect(screens).toContain("'Urgent messages interrupt: off. An urgent message still waits for the recipient to finish.'")
  })
})
