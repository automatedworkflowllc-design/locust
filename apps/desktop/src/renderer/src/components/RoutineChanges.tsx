import type { ReactElement } from 'react'

import type { PublicRoutine } from '../../../shared/ipc.js'
import { ArmedButton } from './ArmedButton.js'

/** At most this many files are named; the rest are counted. */
const NAMED = 4

/**
 * A COPY ROUTINE'S LAST RUN, WAITING FOR THE PERSON (0.533, main/routine-copy.ts).
 *
 * The routine worked in a copy of the folder, so nothing it changed has
 * reached the folder yet. The card says what it changed, and offers the three
 * things a person does with that: Keep (written into the folder -- refused, and
 * said, if they have since changed the same files), Discard (asked first: it
 * cannot be undone), and Open the copy to look before deciding.
 */
export function RoutineChanges({
  routine,
  onSettle
}: {
  readonly routine: PublicRoutine
  readonly onSettle: (routineId: string, decision: 'keep' | 'discard' | 'open') => void
}): ReactElement | null {
  const staged = routine.staged
  if (staged === undefined) return null
  const files = [...staged.changed, ...staged.deleted.map((path) => `${path} (deleted)`)]
  const named = files.slice(0, NAMED).join(', ')
  const more = files.length - NAMED
  return (
    <div className="lc-routinechanges" role="group" aria-label={`Changes waiting from ${routine.name}`}>
      <span className="lc-routinechanges__head">
        <strong>Waiting for you</strong>
        {` · its last run changed ${String(files.length)} file${files.length === 1 ? '' : 's'} in its copy`}
      </span>
      <span className="lc-routinechanges__files lc-mono">
        {named}
        {more > 0 ? ` and ${String(more)} more` : ''}
      </span>
      <span className="lc-routinechanges__line">
        {files.length === 1
          ? 'Nothing has reached the folder. Keep writes it into the folder; Discard throws it away. It runs again once you choose.'
          : 'Nothing has reached the folder. Keep writes them into the folder; Discard throws them away. It runs again once you choose.'}
      </span>
      <span className="lc-routinechanges__actions">
        <button type="button" className="lc-primarybutton" onClick={() => onSettle(routine.routineId, 'keep')}>
          Keep
        </button>
        <ArmedButton
          className="lc-ghostbutton"
          ariaLabel={`Discard the changes from ${routine.name}`}
          armedLabel="Discard for good?"
          onConfirm={() => onSettle(routine.routineId, 'discard')}
        >
          Discard
        </ArmedButton>
        <button type="button" className="lc-linkbutton" onClick={() => onSettle(routine.routineId, 'open')}>
          Open the copy
        </button>
      </span>
    </div>
  )
}
