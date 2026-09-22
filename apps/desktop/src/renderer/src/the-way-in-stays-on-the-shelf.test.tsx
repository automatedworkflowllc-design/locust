import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { AutomationsScreen } from './components/AutomationsScreen.js'

type Props = Parameters<typeof AutomationsScreen>[0]
type Routine = Props['routines'][number]
type Savable = NonNullable<Props['missions']>[number]

/**
 * THE ENTRANCE HAS TO SURVIVE THE FIRST ROUTINE.
 *
 * The offer to save a conversation as a routine lived on the EMPTY screen
 * only, on the reasoning that a shelf cannot fill itself -- true, and it
 * stopped being true the moment the shelf had one thing on it. A person with
 * one routine and no memory of how they made it is in exactly the position
 * of a person with none, and the screen went silent for them.
 *
 * Colin's second design (2026-09-22) puts the row inside the card under the
 * routines, which is right: it is the same list, and adding to it belongs
 * there.
 *
 * Written as a RENDER test because the drive cannot reach it. The drive
 * seeds a profile with no finished conversations, so the row correctly does
 * not draw there -- and "I could not see it" is not evidence that it works.
 */
const ROUTINE: Routine = {
  routineId: 'rt_1',
  name: 'roth check',
  teammateId: 'tm_wren',
  route: { runtime: 'opencode', model: 'opencode/muse-spark-1.3-contributor-free', mode: 'ask' },
  steps: ['Check the ladder.'],
  learnedFrom: [],
  createdAt: '2026-09-20T09:00:00.000Z',
  runs: 1
} as Routine

const SAVABLE: Savable = {
  missionId: 'mission_1',
  title: 'Check the Roth ladder',
  turns: 2,
  phase: 'completed',
  finishedAt: '2026-09-21T09:00:00.000Z'
} as Savable

function draw(routines: readonly Routine[], missions: readonly Savable[], onSaveRoutine?: (id: string) => void): string {
  return renderToStaticMarkup(
    <AutomationsScreen
      routines={routines}
      teammates={[
        {
          teammateId: 'tm_wren',
          name: 'Wren',
          hue: 'lime',
          // PixelFace reads every part of this, so a partial stub throws
          // inside the renderer rather than failing an assertion.
          avatar: { headwear: 0, accessory: 0, mouth: 0 }
        } as Props['teammates'][number]
      ]}
      routineStepByTeammate={{}}
      onRunRoutine={() => undefined}
      onEditRoutine={() => undefined}
      onRemoveRoutine={() => undefined}
      notice={undefined}
      onDismissNotice={() => undefined}
      missions={missions}
      {...(onSaveRoutine === undefined ? {} : { onSaveRoutine })}
    />
  )
}

const OFFER = 'Save a routine from a finished conversation'

describe('the way in stays on the shelf', () => {
  it('offers to save one even when routines already exist', () => {
    const markup = draw([ROUTINE], [SAVABLE], () => undefined)
    expect(markup).toContain(OFFER)
    // Inside the list, not stuck under it: it carries the row's own class so
    // it reads as the last row rather than as a banner.
    expect(markup).toContain('lc-routinerow lc-routineadd')
    // And the routine is still there beside it.
    expect(markup).toContain('roth check')
  })

  it('offers nothing when there is nothing to save', () => {
    // A row offering to save from nothing is the blank form this screen
    // deliberately refused to grow.
    expect(draw([ROUTINE], [], () => undefined)).not.toContain(OFFER)
  })

  it('offers nothing when the screen cannot open the dialog', () => {
    // No handler, no offer: a control that does nothing when pressed is
    // worse than an absent one.
    expect(draw([ROUTINE], [SAVABLE])).not.toContain(OFFER)
  })

  it('still names the way in on an empty shelf', () => {
    // The case that always worked, kept as the control: if this ever stops
    // containing the offer, the test above is passing for the wrong reason.
    expect(draw([], [SAVABLE], () => undefined)).toContain('finished conversations')
  })
})
