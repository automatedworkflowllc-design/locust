import type { ReactElement } from 'react'

import type { PublicRoutine, PublicRuntimeArtifact, PublicTeammate } from '../../../shared/ipc.js'
import { runtimeDisplayName } from '../../../shared/runtimes.js'
import { routineRunSummary, routineScheduleSummary, routineStepLabel } from '../routines.js'
import { Icon } from './Icon.js'
import { PixelFace } from './PixelFace.js'

const STEP_GAP = '\n\n'

/**
 * Automations: every routine in the workspace, in one place.
 *
 * A routine still belongs to a teammate -- it runs on their route, with
 * their permissions, and goes when they do -- which is why they were first
 * shown inside the roster card. What that could not answer is "what runs
 * here, and when": the schedules were scattered across cards, and a person
 * with four teammates had to open four of them to find out. So the roster
 * card keeps its list, and this screen is the other view of the same rows,
 * grouped by teammate and ordered so the scheduled ones come first.
 *
 * Named "Automations" on Colin's word (2026-09-06) because that is what a
 * person calls this, and it is the word in the tab.
 */
export function AutomationsScreen({
  routines,
  teammates,
  routineStepByTeammate,
  onRunRoutine,
  onEditRoutine,
  onRemoveRoutine,
  notice,
  onDismissNotice,
  cliArtifacts
}: {
  readonly routines: readonly PublicRoutine[]
  readonly teammates: readonly PublicTeammate[]
  /** Which routine each teammate is replaying right now, keyed by teammate. */
  readonly routineStepByTeammate: Readonly<
    Record<string, { readonly name: string; readonly step: number; readonly of: number }>
  >
  readonly onRunRoutine: (routineId: string) => void
  readonly onEditRoutine: (routine: PublicRoutine) => void
  readonly onRemoveRoutine: (routineId: string) => void
  /** The last scheduled routine that would not start, and why. */
  readonly notice: string | undefined
  readonly onDismissNotice: () => void
  /**
   * What the person set up inside the CLIs themselves. Locust neither made
   * nor runs these -- it lists them, because a machine with nine agents and
   * commands on it read "Nothing saved yet" (Colin, 2026-09-07: "It would
   * just be nice for them to be able to see the routines/automations they've
   * setup on their models").
   */
  readonly cliArtifacts: readonly PublicRuntimeArtifact[]
}): ReactElement {
  const now = new Date()
  // Scheduled first: those are the ones that happen without anybody here,
  // and so the ones a person came to this screen to check.
  const ordered = [...routines].sort((first, second) => {
    const firstScheduled = first.schedule === undefined ? 1 : 0
    const secondScheduled = second.schedule === undefined ? 1 : 0
    if (firstScheduled !== secondScheduled) return firstScheduled - secondScheduled
    return first.name.localeCompare(second.name)
  })
  const scheduled = ordered.filter((routine) => routine.schedule !== undefined).length
  const ownerOf = (routine: PublicRoutine): PublicTeammate | undefined =>
    teammates.find((teammate) => teammate.teammateId === routine.teammateId)

  return (
    <section className="lc-screen lc-automations" aria-label="Automations">
      <header className="lc-screen__head">
        <h1 className="lc-screen__title">Automations</h1>
        <p className="lc-screen__lede">
          {routines.length === 0
            ? 'Nothing saved yet.'
            : `${String(routines.length)} saved · ${
                scheduled === 0 ? 'none on a schedule' : `${String(scheduled)} on a schedule`
              }`}
        </p>
      </header>

      {notice !== undefined && (
        <p className="lc-claim lc-claim--hint lc-tone-amber">
          {notice}{' '}
          <button type="button" className="lc-ghostbutton" onClick={onDismissNotice}>
            Dismiss
          </button>
        </p>
      )}

      {routines.length === 0 ? (
        <div className="lc-empty">
          <p>
            A routine is a conversation a teammate has been taught: the turns you typed, saved so they can be
            replayed.
          </p>
          {/*
            * Name the GESTURE. This used to say "save it from that teammate's
            * card" under a button reading "Open the team", and both sent
            * people to the one screen the control is not on -- an outside
            * tester followed it exactly, found Edit / Remove on the card, and
            * filed the whole feature as missing (2026-09-07).
            *
            * Right-click is the only way in: the row has no visible
            * affordance, which is what makes saying so out loud the job.
            */}
          <p className="lc-empty__how">
            Finish a conversation worth repeating, then right-click it under its teammate in the sidebar and
            choose <strong>Save as routine</strong>. You can give it a schedule there.
          </p>
        </div>
      ) : (
        <div className="lc-routinelist">
          {ordered.map((routine) => {
            const owner = ownerOf(routine)
            const schedule = routineScheduleSummary(routine, now)
            // A teammate can only replay one routine at a time, so a run of
            // theirs is what disables this row -- not any run anywhere.
            const replaying = routineStepByTeammate[routine.teammateId]
            return (
              <div className="lc-routinerow" key={routine.routineId}>
                {owner !== undefined && (
                  <PixelFace hue={owner.hue} avatar={owner.avatar} size={18} teammateId={owner.teammateId} />
                )}
                <span className="lc-routinerow__name" title={routine.steps.join(STEP_GAP)}>
                  {routine.name}
                  <span className="lc-routinerow__meta lc-mono">
                    {' · '}
                    {owner?.name ?? 'teammate removed'}
                    {' · '}
                    {String(routine.steps.length)} step{routine.steps.length === 1 ? '' : 's'}
                    {' · '}
                    {routineRunSummary(routine)}
                  </span>
                  {schedule !== undefined && (
                    <span className="lc-routinerow__meta lc-mono lc-routinerow__sched">{schedule}</span>
                  )}
                </span>
                <button
                  type="button"
                  className="lc-ghostbutton"
                  disabled={replaying !== undefined || owner === undefined}
                  title={
                    owner === undefined
                      ? 'The teammate this was taught to is gone, so it has no route to run on.'
                      : replaying === undefined
                        ? undefined
                        : `${replaying.name} is running: ${routineStepLabel(replaying)}`
                  }
                  onClick={() => onRunRoutine(routine.routineId)}
                >
                  Run
                </button>
                <span className="lc-routinerow__meta">
                  <button type="button" className="lc-ghostbutton" onClick={() => onEditRoutine(routine)}>
                    Edit
                  </button>
                  <button type="button" className="lc-ghostbutton" onClick={() => onRemoveRoutine(routine.routineId)}>
                    Remove
                  </button>
                </span>
              </div>
            )
          })}
        </div>
      )}

      <p className="lc-screen__note">
        <Icon name="clock" size={12} /> A scheduled routine runs only while Locust is open, on its teammate&rsquo;s
        own route and permissions.
      </p>
      {/*
        * Set up in the CLI, listed here.
        *
        * Separate from the routines above and deliberately inert: these are
        * not Locust's to run, edit or schedule, and a Run button on one would
        * be a promise the app cannot keep. The path is stated because that is
        * the answer to the only question this list raises -- where do I change
        * it.
        */}
      {cliArtifacts.length > 0 && (
        <section className="lc-cliartifacts">
          <h3 className="lc-section__title">Set up in your CLIs</h3>
          <p className="lc-cliartifacts__note">
            Locust did not make these and does not run them. They are what you configured in the coding agents
            themselves, listed so you can see them in one place.
          </p>
          {[...new Set(cliArtifacts.map((entry) => entry.runtime))].map((runtime) => (
            <div className="lc-cliartifacts__group" key={runtime}>
              <div className="lc-cliartifacts__runtime lc-mono">{runtimeDisplayName(runtime as never)}</div>
              {cliArtifacts
                .filter((entry) => entry.runtime === runtime)
                .map((entry) => (
                  <div className="lc-cliartifacts__row" key={`${entry.runtime}/${entry.kind}/${entry.path}`}>
                    <span className="lc-cliartifacts__kind lc-mono">{entry.kind}</span>
                    <span className="lc-cliartifacts__name">{entry.name}</span>
                    {entry.description !== undefined && (
                      <span className="lc-cliartifacts__desc">{entry.description}</span>
                    )}
                    {/*
                      * The last two segments, not the whole path. A full
                      * Windows path is far wider than this row and ran off
                      * the right edge of the window (screenshot, 2026-09-07);
                      * `agents\gig-scout.md` is the part that answers "where
                      * do I change it", and the whole thing is on hover.
                      */}
                    <span className="lc-cliartifacts__path lc-mono" title={entry.path}>
                      {entry.path.split(/[\\/]/).slice(-2).join('/')}
                    </span>
                  </div>
                ))}
            </div>
          ))}
        </section>
      )}

    </section>
  )
}
