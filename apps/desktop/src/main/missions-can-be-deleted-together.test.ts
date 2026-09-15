import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Deleting more than one mission at a time.
 *
 * Colin, 2026-09-15: *"can we add a check and delete, so we can delete
 * missions from here or delete more than once."* Through a right-click menu,
 * one at a time, is fine for one and absurd for seventeen — which is what his
 * Missions screen was showing.
 *
 * Driven end to end before shipping: six rows, three ticked, the bar read
 * `3 selected · Clear · Select all 6 · Delete 3`, the button armed to
 * `Delete 3 for good?`, and three records left the ledger.
 */

const SCREENS = readFileSync(
  fileURLToPath(new URL('../renderer/src/components/Screens.tsx', import.meta.url)),
  'utf8'
)
const CSS = readFileSync(fileURLToPath(new URL('../renderer/src/shell.css', import.meta.url)), 'utf8')

describe('what may be selected', () => {
  it('will not offer a running mission', () => {
    /*
     * The host refuses to delete a live mission -- doing so would orphan a
     * process still writing into a file that no longer exists, and take away
     * the only control that stops it. So the screen does not offer the
     * checkbox either: an offer the screen knows will be refused is worse
     * than no offer.
     */
    expect(SCREENS).toContain('const deletable = shown.filter((mission) => !runningMissionIds.has(mission.missionId))')
    expect(SCREENS).toContain('disabled={running}')
  })

  it('says why the box is disabled rather than leaving it dead', () => {
    expect(SCREENS).toContain('Still running — stop it first')
  })

  it('re-filters at the moment of deleting, not only at the moment of picking', () => {
    // A mission that started running between the click and the confirm must
    // not go. The set is rebuilt from `deletable` rather than sent as picked.
    const handler = SCREENS.slice(SCREENS.indexOf('const going = deletable'))
    expect(handler.slice(0, 200)).toContain('picked.has(missionId)')
  })
})

describe('the bar', () => {
  it('appears only once something is selected', () => {
    expect(SCREENS).toContain('picked.size > 0 && (')
  })

  it('is absent entirely when the screen has no way to delete', () => {
    // A list with checkboxes and nowhere to take them is worse than a list
    // without: the prop is what turns selection on at all.
    expect(SCREENS).toContain('onDeleteMissions !== undefined && picked.size > 0')
    expect(SCREENS).toContain('{onDeleteMissions !== undefined && (')
  })

  it('confirms in two steps, the shape the row menu already uses', () => {
    // This removes records that cannot be recovered. One click is not enough
    // between a person and that; a modal is heavier than the act deserves,
    // and the menu settled that question already.
    expect(SCREENS).toContain('Delete ${picked.size} for good?')
  })

  it('offers select-all over what is actually deletable, not what is listed', () => {
    expect(SCREENS).toContain('Select all ${deletable.length}')
  })

  it('keeps the destructive control away from the harmless ones', () => {
    // Clear and Select all sit left; Delete is pushed to the far end so it
    // is not under the pointer that just finished doing something safe.
    const rule = CSS.slice(CSS.indexOf('.lc-pickbar__delete {'))
    expect(rule.slice(0, rule.indexOf('}'))).toContain('margin-left: auto')
  })
})

describe('the row keeps its shape', () => {
  it('puts the checkbox beside the row, never inside it', () => {
    /*
     * The row is a `<button>`. A checkbox nested in one is neither valid nor
     * reachable -- the same reason the sidebar's conversation row wraps its
     * `...` menu rather than nesting it.
     */
    expect(SCREENS).toContain('lc-missionrowwrap')
    const wrap = SCREENS.slice(SCREENS.indexOf('lc-missionrowwrap'))
    expect(wrap.indexOf('lc-missionrow__pick')).toBeLessThan(wrap.indexOf('<button'))
  })

  it('lets the row keep the width it had', () => {
    const rule = CSS.slice(CSS.indexOf('.lc-missionrowwrap > .lc-missionrow {'))
    expect(rule.slice(0, rule.indexOf('}'))).toContain('min-width: 0')
  })
})
