import type { ReactElement } from 'react'
import { BOT_SIZE } from '../botSizes.js'

import type { PublicFolder, PublicRoutine, PublicTeammate } from '../../../shared/ipc.js'
import { shortAgo } from '../railFlyout.js'
import { routineChain, routineRunSummary, routineScheduleSummary, routineStepLabel } from '../routines.js'
import { NOTHING_TO_SAVE_YET, savableConversations, turnsLabel } from '../savableConversations.js'
import { RoutineChanges } from './RoutineChanges.js'
import type { SavableConversation } from '../savableConversations.js'
import { Icon } from './Icon.js'
import { ScreenHeader } from './Screens.js'
import { TeammateBot } from './TeammateBot.js'
import { RoutineRecovery } from './RoutineRecovery.js'
import type { RecoverRoutine } from './RoutineRecovery.js'
import { ArmedButton } from './ArmedButton.js'
import { routineAwaitsReview } from '../../../shared/routine-recovery.js'

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
  onSaveRoutine,
  onNewRoutine,
  onSettleRoutine,
  folders = []
}: {
  /** A copy routine's waiting changes: Keep, Discard, or open the copy (0.533). */
  readonly onSettleRoutine?: (routineId: string, decision: 'keep' | 'discard' | 'open') => void
  /** A routine written here, step by step, rather than saved from a conversation (0.530). */
  readonly onNewRoutine?: () => void
  readonly routines: readonly PublicRoutine[]
  /** The folders Locust knows, so a routine's card names the one it runs in (0.512). */
  readonly folders?: readonly PublicFolder[]
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
        *
        * THE SHARED HEADER, since 2026-09-22. This screen had its own --
        * `.lc-screen__head`, a flex column with a UI-font lede -- and
        * measured 129px against the 60px every other list screen uses, so
        * the content under the title jumped 69px on a tab click. The count
        * goes in the meta slot, in mono, because a count is machine output
        * and that is what the slot is for.
        */}
      <ScreenHeader
        title="Routines"
        {...(onNewRoutine === undefined
          ? {}
          : {
              /*
               * NEW ROUTINE, WRITTEN HERE (0.530). The rule above said a routine
               * "cannot be made from nothing", so the only door was a finished
               * conversation -- and Sol's 0.528 pass, as an office user, had to
               * finish one, save it, and delete three of its four imported turns
               * to get one clean job. Claude's own Routines starts from a blank
               * task; so does this, with the same dialog.
               */
              actions: (
                <button type="button" className="lc-ghostbutton" onClick={onNewRoutine}>
                  New routine
                </button>
              )
            })}
        meta={
          routines.length === 0
            ? 'none saved'
            : `${String(routines.length)} saved · ${
                scheduled === 0 ? 'none on a schedule' : `${String(scheduled)} on a schedule`
              }`
        }
      />

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
            A routine is a job a teammate does again: steps you write, or the turns of a conversation you
            save, replayed when you press Run or on a schedule.
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
              {/*
                * A card of rows under a plain sentence (first-impressions
                * pass, 0.354): the rows floated free under "SAVE ONE FROM
                * your finished conversations", half a shout and half a
                * sentence, with a bare "Save" that did not say what it made.
                */}
              <p className="lc-savable__head">Save one of your finished conversations to start.</p>
              <div className="lc-savable__card">
              {savable.map((mission) => {
                const owner =
                  mission.ownerId === undefined
                    ? undefined
                    : teammates.find((teammate) => teammate.teammateId === mission.ownerId)
                return (
                  <div className="lc-savable__row" key={mission.missionId}>
                    {owner !== undefined && (
                      <TeammateBot hue={owner.hue} avatar={owner.avatar} size={BOT_SIZE.savableRow} teammateId={owner.teammateId} />
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
                      Save as routine
                    </button>
                  </div>
                )
              })}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="lc-routinelist lc-settingcard">
          {ordered.map((routine) => {
            const owner = ownerOf(routine)
            const schedule = routineScheduleSummary(routine, now)
            // A teammate can only replay one routine at a time, so a run of
            // theirs is what disables this row -- not any run anywhere.
            const replaying = routineStepByTeammate[routine.teammateId]
            return (
              <div className="lc-routinerow" key={routine.routineId}>
                {owner !== undefined && (
                  <TeammateBot hue={owner.hue} avatar={owner.avatar} size={BOT_SIZE.routineRow} teammateId={owner.teammateId} />
                )}
                <span className="lc-routinerow__name" title={routine.steps.join(STEP_GAP)}>
                  {routine.name}
                  <span className="lc-routinerow__meta lc-mono">
                    {/* No leading separator. It was written when the meta
                        ran on from the name on the same line; on its own
                        line it opened with a dangling "·". Seen in a drive,
                        2026-09-22 -- the measurements said nothing about it
                        because a separator has a size and a colour like any
                        other text. */}
                    {/* A hand-off chain names every teammate in step order (0.435). */}
                    {owner === undefined && routine.handOffs === undefined ? 'teammate removed' : routineChain(routine, teammates, true)}
                    {' · '}
                    {/* The step count comes from `routineRunSummary`, which
                        opens with it. Naming it here as well is why every card
                        on this screen read "2 steps · 2 steps · not run yet" --
                        seen in a drive of the recovery card, 2026-09-08, and
                        older than that work. */}
                    {routineRunSummary(routine)}
                    {/* Where it runs (0.512): Sol's pass on 0.509 found the
                        time, model and mode on the card and no folder, in a
                        profile that moved between folders. */}
                    {(() => {
                      const folder = routine.workspaceId === undefined ? undefined : folders.find((entry) => entry.id === routine.workspaceId)
                      return folder === undefined ? null : <span title={folder.path}>{` · in ${folder.name}`}</span>
                    })()}
                  </span>
                  {/* Its last run's check still failed (0.536): said here, where
                      the next run is started, not only in the conversation. */}
                  {routine.lastFailed !== undefined && (
                    <span className="lc-routinerow__failed">Last run: {routine.lastFailed}</span>
                  )}
                </span>
                {/* The schedule as a CHIP, not a third prose line. It is the
                    one fact on the row a person scans for -- does this go on
                    its own, or only when I press Run -- and as prose under
                    the meta it read as more of the same sentence. */}
                <span className="lc-routinerow__sched lc-mono">
                  {schedule ?? 'no schedule'}
                </span>
                <button
                  type="button"
                  className="lc-ghostbutton"
                  disabled={replaying !== undefined || owner === undefined || routine.staged !== undefined || (routine.execution !== undefined && routine.execution.status !== 'abandoned')}
                  title={
                    owner === undefined
                      ? 'The teammate this was taught to is gone, so it has no route to run on.'
                      : routine.staged !== undefined
                        ? 'Its last run\'s changes are waiting: Keep or Discard them first.'
                        : replaying === undefined
                          ? undefined
                          : `${replaying.name} is running: ${routineStepLabel(replaying)}`
                  }
                  onClick={() => onRunRoutine(routine.routineId)}
                >
                  Run
                </button>
                <span className="lc-routinerow__meta">
                  {/*
                    * Run keeps its word; the other two become icons.
                    *
                    * All three were `lc-ghostbutton` -- one class, one
                    * appearance -- so the point of the screen and the
                    * destructive thing looked identical. Run is what a
                    * person came to press, so it stays a word. Both icons
                    * carry `title` AND `aria-label`, because an icon with
                    * neither is a button nobody can name.
                    */}
                  <button
                    type="button"
                    className="lc-ghostbutton lc-iconbutton"
                    title="Edit routine"
                    aria-label={`Edit ${routine.name}`}
                    onClick={() => onEditRoutine(routine)}
                  >
                    <Icon name="pencil" size={14} />
                  </button>
                  {/* H2: asks first; and not while the routine waits for review. */}
                  <ArmedButton
                    className="lc-ghostbutton lc-iconbutton lc-routinerow__remove"
                    title={routineAwaitsReview(routine) ? 'Waiting for your review: check it and abandon it before removing it' : 'Remove routine'}
                    ariaLabel={`Remove ${routine.name}`}
                    armedLabel="Remove for good?"
                    disabled={routineAwaitsReview(routine)}
                    onConfirm={() => onRemoveRoutine(routine.routineId)}
                  >
                    <Icon name="close" size={14} />
                  </ArmedButton>
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
                {onSettleRoutine !== undefined && <RoutineChanges routine={routine} onSettle={onSettleRoutine} />}
                <RoutineRecovery
                  key={`${routine.execution?.attemptId}:${routine.execution?.step}`}
                  routine={routine}
                  {...(onRecoverRoutine === undefined ? {} : { recover: onRecoverRoutine })}
                  {...(onOpenMission === undefined ? {} : { onOpenMission })}
                />
              </div>
            )
          })}
          {/*
            * THE ENTRANCE STAYS, once there are routines.
            *
            * It used to appear only on the empty screen, on the reasoning
            * that a shelf cannot fill itself. True, and it stopped being
            * true the moment the shelf had one thing on it: a person with
            * one routine and no idea how they made it is in the same
            * position as a person with none. Colin's second design puts the
            * row inside the card, under the rows, and that is right -- it
            * is the same list, and adding to it belongs there.
            *
            * Only when there is something to save. A row offering to save
            * from nothing is the blank form this screen refused to grow.
            */}
          {onSaveRoutine !== undefined && savable.length > 0 && (
            <button
              type="button"
              className="lc-routinerow lc-routineadd"
              onClick={() => onSaveRoutine(savable[0]!.missionId)}
            >
              <span className="lc-routineadd__plus" aria-hidden="true">
                <Icon name="plus" size={14} />
              </span>
              <span className="lc-routinerow__name">
                Save a routine from a finished conversation
                <span className="lc-routinerow__meta lc-mono">
                  Right-click any conversation, then Save as routine
                </span>
              </span>
            </button>
          )}
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
