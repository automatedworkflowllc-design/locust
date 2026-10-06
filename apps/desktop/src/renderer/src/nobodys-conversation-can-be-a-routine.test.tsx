import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { RoutineDialog } from './components/RoutineDialog.js'
import type { PublicTeammate } from '../../shared/ipc.js'
import { seedAvatar } from '../../shared/avatar.js'

/**
 * The last hole in the solo path.
 *
 * A conversation can be started with nobody picked -- that is half of what
 * Colin asked for, the Claude Code half beside the teammates -- and a run
 * like that has known the folder and the project's memory since 0.191.0. It
 * still could not be saved as a routine, and the reason was never the steps:
 * a routine IS the words the person typed, and those exist whether or not
 * anybody was picked. What was missing is whose route replays them.
 *
 * So the dialog asks, once, instead of the menu item quietly doing nothing.
 * The two things that must both hold: it will not save without an answer, and
 * it does not invent one by defaulting to whoever is first in the roster --
 * which would put a teammate's name on work they had no part in.
 */

const WREN: PublicTeammate = {
  teammateId: 'tm_wren',
  name: 'Wren',
  role: 'Code & Migrations',
  hue: 'lime',
  avatar: seedAvatar('tm_wren')
} as unknown as PublicTeammate

const drawn = (props: Partial<Parameters<typeof RoutineDialog>[0]>): string =>
  renderToStaticMarkup(
    <RoutineDialog
      teammate={undefined}
      initialName="Nightly tidy"
      initialSteps={['Tidy the notes folder.']}
      initialSchedule={undefined}
      truncated={false}
      routeLabel="OpenCode / Muse Spark 1.3 Contributor Free"
      busy={false}
      error={undefined}
      onSave={() => undefined}
      onCancel={() => undefined}
      {...props}
    />
  )

describe('saving a conversation nobody owns', () => {
  it('asks who will run it', () => {
    const html = drawn({ chooseFrom: [WREN] })
    expect(html).toContain('Who runs it')
    expect(html).toContain('Wren')
    expect(html).toContain('This conversation was not assigned to anyone')
  })

  it('will not save until that is answered', () => {
    // Nobody is selected to begin with, so the button is unavailable -- and
    // the sentence above it says why, which is the half a disabled button
    // alone never says.
    const html = drawn({ chooseFrom: [WREN] })
    expect(html).toMatch(/<button[^>]*class="lc-primarybutton"[^>]*disabled/)
  })

  it('picks nobody by default', () => {
    // The control. Defaulting to the first teammate would make this save
    // silently, under a name that had nothing to do with the work.
    const html = drawn({ chooseFrom: [WREN] })
    expect(html).toContain('Pick a teammate')
    expect(html).not.toMatch(/<option value="tm_wren" selected/)
  })

  it('says so plainly when there is nobody to pick', () => {
    const html = drawn({ chooseFrom: [] })
    expect(html).toContain('there are no teammates yet')
    // And Save waits, as the sentence says (0.658): it was live, and answered "Choose which teammate
    // runs this routine" with no list to choose from.
    expect(html).toMatch(/<button[^>]*class="lc-primarybutton"[^>]*disabled/)
  })

  it('asks nothing when the conversation already has an owner', () => {
    // The ordinary case, unchanged: the owner is inherited and the dialog
    // states it rather than asking.
    const html = drawn({ teammate: WREN })
    expect(html).not.toContain('Who runs it')
    expect(html).toContain('runs it')
  })
})

describe('a step too long to send (A5.1)', () => {
  it('will not save, and says which step to shorten', () => {
    const html = drawn({ teammate: WREN, initialSteps: ['Fine.', 'x'.repeat(8_001)] })
    expect(html).toContain('Shorten step 2 to save this routine.')
    expect(html).toMatch(/<button type="button" class="lc-primarybutton" disabled="">/)
  })
})
