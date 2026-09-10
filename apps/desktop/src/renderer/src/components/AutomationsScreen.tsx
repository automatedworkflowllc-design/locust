import type { ReactElement } from 'react'

import type { PublicRoutine, PublicTeammate } from '../../../shared/ipc.js'
import { shortAgo } from '../railFlyout.js'
import { routineRunSummary, routineScheduleSummary, routineStepLabel } from '../routines.js'
import { NOTHING_TO_SAVE_YET, savableConversations, turnsLabel } from '../savableConversations.js'
import type { SavableConversation } from '../savableConversations.js'
import { Icon } from './Icon.js'
import { PixelFace } from './PixelFace.js'
import { RoutineRecovery } from './RoutineRecovery.js'
import type { RecoverRoutine } from './RoutineRecovery.js'

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
  onRecoverRoutine,
  onOpenMission,
  onEditRoutine,
  onRemoveRoutine,
  notice,
  onDismissNotice,
  missions,
  onSaveRoutine
}: {
  readonly routines: readonly PublicRoutine[]
  readonly teammates: readonly PublicTeammate[]
  /** Which routine each teammate is replaying right now, keyed by teammate. */
  readonly routineStepByTeammate: Readonly<
    Record<string, { readonly name: string; readonly step: number; readonly of: number }>
  >
  readonly onRunRoutine: (routineId: string) => void
  readonly onRecoverRoutine?: RecoverRoutine
  readonly onOpenMission?: (missionId: string) => void
  readonly onEditRoutine: (routine: PublicRoutine) => void
  readonly onRemoveRoutine: (routineId: string) => void
  /** The last scheduled routine that would not start, and why. */
  readonly notice: string | undefined
  readonly onDismissNotice: () => void
  /**
   * The conversations this screen can offer to save, when it has no routines
   * yet. The same rows the sidebar draws; this screen filters and sorts them.
   */
  readonly missions?: readonly (SavableConversation & { readonly ownerId?: string })[]
  /** Open the Save as routine dialog on one of them. */
  readonly onSaveRoutine?: (missionId: string) => void
}): ReactElement {
  const now = new Date()
  const savable = savableConversations(missions ?? []) as readonly (SavableConversation & {
    readonly ownerId?: string
  })[]
  // Scheduled first: those are the ones that happen without anybody here,
  // and so the ones a person came to this screen to check.
  const ordered = [...routines].sort((first, second) => {
    const held = (routine: PublicRoutine): number => routine.execution !== undefined && routine.execution.status !== 'abandoned' && routine.execution.status !== 'running' ? 0 : 1
    if (held(first) !== held(second)) return held(first) - held(second)
    const firstScheduled = first.schedule === undefined ? 1 : 0
    const secondScheduled = second.schedule === undefined ? 1 : 0
    if (firstScheduled !== secondScheduled) return firstScheduled - secondScheduled
    return first.name.localeCompare(second.name)
  })
  const scheduled = ordered.filter((routine) => routine.schedule !== undefined).length
  const ownerOf = (routine: PublicRoutine): PublicTeammate | undefined =>
    teammates.find((teammate) => teammate.teammateId === routine.teammateId)

  return (
    <section className="lc-screen lc-automations" aria-label="Routines">
      <header className="lc-screen__head">
        {/*
          * Called what every control on it already calls the object.
          *
          * `Save as routine`, `Edit routine`, `routineRunSummary` -- the app
          * says routine everywhere except the one place a person reads first.
          * "Automations" was the right word for a shelf holding two kinds of
          * thing: routines you can run, and a read-only inventory of what you
          * configured in the CLIs themselves. That second list has moved to
          * Settings, under the runtime each fact belongs to, and Colin's
          * reason for the broader word left with it (design agent,
          * 2026-09-10).
          */}
        <h1 className="lc-screen__title">Routines</h1>
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
        /*
         * The empty screen CONTAINS the entrance rather than describing it.
         *
         * It used to name the gesture in prose -- finish a conversation,
         * right-click it under its teammate, choose Save as routine. That was
         * the right floor when the row had no visible affordance, and it was
         * still not enough: Colin read this screen and reported the feature as
         * missing, and so did the outside tester before him.
         *
         * The design agent's rule (2026-09-10) says why. A feature needs an
         * entrance where its material is and an entrance where its absence is
         * felt, and the second must contain the first. A shelf cannot fill
         * itself, and a routine -- unlike a room -- cannot be made from
         * nothing, so a New routine button would be a blank form lying about
         * what a routine is.
         *
         * So: the real material, listed. The same rows the sidebar draws,
         * finished ones only, newest first, Save on each opening the dialog
         * that already exists.
         */
        <div className="lc-empty">
          <p>
            A routine is a conversation a teammate has been taught: the turns you typed, saved so they can be
            replayed.
          </p>
          {savable.length === 0 ? (
            /*
             * A brand-new workspace has no finished conversations either, and
             * only then is the old sentence's job gone: there is no gesture to
             * name because there is nothing to name it about.
             */
            <p className="lc-empty__how">{NOTHING_TO_SAVE_YET}</p>
          ) : (
            <div className="lc-savable">
              <p className="lc-savable__head lc-mono">
                Save one from <span className="lc-savable__from">your finished conversations</span>
              </p>
              {savable.map((mission) => {
                const owner =
                  mission.ownerId === undefined
                    ? undefined
                    : teammates.find((teammate) => teammate.teammateId === mission.ownerId)
                return (
                  <div className="lc-savable__row" key={mission.missionId}>
                    {owner !== undefined && (
                      <PixelFace hue={owner.hue} avatar={owner.avatar} size={16} teammateId={owner.teammateId} />
                    )}
                    <button
                      type="button"
                      className="lc-savable__name"
                      onClick={() => onOpenMission?.(mission.missionId)}
                      title={mission.title}
                    >
                      {mission.title}
                    </button>
                    <span className="lc-savable__turns lc-mono">{turnsLabel(mission.turns)}</span>
                    <span className="lc-savable__at lc-mono">{shortAgo(mission.lastAt, now) ?? ''}</span>
                    <button
                      type="button"
                      className="lc-button"
                      onClick={() => onSaveRoutine?.(mission.missionId)}
                    >
                      Save
                    </button>
                  </div>
                )
              })}
            </div>
          )}
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
                    {/* The step count comes from `routineRunSummary`, which
                        opens with it. Naming it here as well is why every card
                        on this screen read "2 steps · 2 steps · not run yet" --
                        seen in a drive of the recovery card, 2026-09-08, and
                        older than that work. */}
                    {routineRunSummary(routine)}
                  </span>
                  {schedule !== undefined && (
                    <span className="lc-routinerow__meta lc-mono lc-routinerow__sched">{schedule}</span>
                  )}
                </span>
                <button
                  type="button"
                  className="lc-ghostbutton"
                  disabled={replaying !== undefined || owner === undefined || (routine.execution !== undefined && routine.execution.status !== 'abandoned')}
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
                {/*
                  * A row of its own, across every column.
                  *
                  * It was nested INSIDE `lc-routinerow__name` -- a span that is
                  * `white-space: nowrap; overflow: hidden; text-overflow:
                  * ellipsis`, meant to hold a one-line name. A card carrying a
                  * checkbox and two buttons cannot shrink, so the `1fr` name
                  * column could not shrink either: the Run button was pushed
                  * off the window edge and the teammate's avatar sat alone in a
                  * tall empty gutter beside it.
                  *
                  * Invisible to the tests, which render to a string. Seen in
                  * the drive's SCREENSHOT, after its step text had already been
                  * read as a pass (2026-09-08).
                  */}
                <RoutineRecovery
                  key={`${routine.execution?.attemptId}:${routine.execution?.step}`}
                  routine={routine}
                  {...(onRecoverRoutine === undefined ? {} : { recover: onRecoverRoutine })}
                  {...(onOpenMission === undefined ? {} : { onOpenMission })}
                />
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
    </section>
  )
}
