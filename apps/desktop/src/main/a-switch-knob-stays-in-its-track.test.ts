import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * `.lc-switch` is defined twice in `shell.css`, and the design handover of
 * 2026-09-21 called that "a dead rule worth deleting regardless". Checked
 * before acting on it: **both blocks are live**, because they answer
 * different markup.
 *
 * - Settings writes `lc-switch` + `is-on` on the control ITSELF
 *   (`Screens.tsx`), which only `.lc-switch.is-on` can reach.
 * - The composer writes a bare `.lc-switch` inside an ancestor carrying
 *   `is-on` (`Composer.tsx`), which only `.is-on .lc-switch` can reach.
 *
 * Deleting either breaks the other's on-state. What the duplication DID cost
 * is the knob travel. The later block wins on the box — 26px track, 2px
 * padding, 10px knob, so 12px of room — and the earlier block still moved
 * 14px, putting every switched-on Settings toggle 2px past its padding box,
 * flush against the border.
 *
 * Fixing that turned up the same class of error in the other direction:
 * `.lc-memory__switch` is a 28px track with 14px of room and moved 12,
 * stopping short of the end. One over, one under, both from writing the
 * travel by hand instead of deriving it from the box it moves in.
 */
const read = (relative: string): string => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
const CSS = read('../renderer/src/shell.css')
const SCREENS = read('../renderer/src/components/Screens.tsx')
const COMPOSER = read('../renderer/src/components/Composer.tsx')

/** Every `selector { ... }` body in the sheet, in source order. */
function bodiesOf(selector: string): readonly string[] {
  const bodies: string[] = []
  let at = 0
  for (;;) {
    const found = CSS.indexOf(`${selector} {`, at)
    if (found === -1) return bodies
    const open = CSS.indexOf('{', found)
    const close = CSS.indexOf('}', open)
    if (open === -1 || close === -1) return bodies
    bodies.push(CSS.slice(open + 1, close))
    at = close
  }
}

/** The last value a property takes for a selector — the one that wins. */
function lastValue(selector: string, property: string): number {
  let held = 0
  for (const body of bodiesOf(selector)) {
    for (const line of body.split(';')) {
      const [name, value] = line.split(':')
      if (name?.trim() === property && value !== undefined) held = Number.parseInt(value.trim(), 10)
    }
  }
  return held
}

/** Every rule whose selector mentions `is-on` and ends at this knob. */
function onStateTravels(knob: string): readonly number[] {
  const travels: number[] = []
  for (const block of CSS.split('}')) {
    const open = block.indexOf('{')
    if (open === -1) continue
    const selector = block.slice(0, open)
    if (!selector.includes('is-on') || !selector.includes(knob)) continue
    const moved = /translateX\((\d+)px\)/.exec(block.slice(open))
    if (moved?.[1] !== undefined) travels.push(Number.parseInt(moved[1], 10))
  }
  return travels
}

describe('a switch knob stays in its track', () => {
  it('both switch markups are still in use, so neither block is dead', () => {
    // The evidence that "delete the duplicate" would have been a regression.
    expect(SCREENS).toContain("lc-switch${relay ? ' is-on' : ''}")
    expect(COMPOSER).toContain('className="lc-switch"')
    expect(CSS).toContain('.lc-switch.is-on {')
    expect(CSS).toContain('.is-on .lc-switch {')
  })

  it('every switch travels exactly the room its own track has', () => {
    const families = [
      { track: '.lc-switch', knob: '.lc-switch__knob' },
      { track: '.lc-memory__switch', knob: '.lc-memory__knob' }
    ]
    for (const family of families) {
      const room = lastValue(family.track, 'width') - lastValue(family.track, 'padding') * 2 - lastValue(family.knob, 'width')
      expect(room, `${family.track} has no room to move in`).toBeGreaterThan(0)
      const travels = onStateTravels(family.knob)
      expect(travels.length, `${family.knob} has no on-state`).toBeGreaterThan(0)
      for (const travel of travels) {
        expect(travel, `${family.knob} moves ${String(travel)}px in ${String(room)}px of room`).toBe(room)
      }
    }
  })
})
