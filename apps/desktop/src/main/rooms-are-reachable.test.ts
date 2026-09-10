import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * A person with no rooms can still find rooms.
 *
 * The Rooms section was drawn only when `rooms.length > 0`, with a comment
 * arguing that "an empty section has nothing to say here" because the Rooms
 * screen is "one palette entry or Ctrl 4 away". That is exactly backwards:
 * an empty section's whole job is to say the feature exists.
 *
 * The result was a feature unreachable without having already used it — the
 * only ways to make a FIRST room were a keyboard shortcut and a command
 * palette, neither of which announces itself. Colin, who owns the app and
 * had just watched a full day of work go into rooms, 2026-09-09: "sorry if
 * this is dumb but how does one create a room for teammates, i cant figure
 * it out lol."
 *
 * Not dumb. There was nothing on screen to find.
 */

const SIDEBAR = readFileSync(
  fileURLToPath(new URL('../renderer/src/components/Sidebar.tsx', import.meta.url)),
  'utf8'
)

/** Source with comments removed: prose about a gate is not a gate. */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[^\n]*?\/\/[^\n]*$/gm, ' ')
}

describe('the Rooms section', () => {
  it('is in the sidebar at all', () => {
    // The control. A renamed section would let the assertion below pass by
    // finding no gate because it found nothing.
    expect(codeOnly(SIDEBAR)).toContain('New room')
  })

  it('is not hidden behind already having one', () => {
    /*
     * THE regression, as the shape rather than the symptom. `rooms.length >
     * 0 &&` in front of the section is how a feature becomes invisible to
     * everyone who has not used it, and it reads as a sensible tidy-up in a
     * diff.
     */
    expect(codeOnly(SIDEBAR), 'Rooms is gated on already having a room again').not.toMatch(
      /rooms\.length\s*>\s*0\s*&&/
    )
  })
})
