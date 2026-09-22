import { useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { useModal } from '../useModal.js'

import type { PublicTeammate, RoutineSchedule } from '../../../shared/ipc.js'
import { EVERY_HOURS_CHOICES } from '../../../shared/routine-schedule.js'
import { stepTooLongNotice } from '../../../shared/step-budget.js'
import { MAX_ROUTINE_STEPS } from '../routines.js'
import { PixelFace } from './PixelFace.js'

/**
 * Saving a conversation as a routine, and correcting one.
 *
 * The steps arrive already filled in with what the person typed on each turn:
 * the point of the feature is that they do not have to write it again. They
 * are editable here because a correction is the whole way a routine improves
 * -- "it saves your workflow as a routine, takes your corrections" -- and the
 * record of what actually happened is untouched either way.
 */
export function RoutineDialog({
  teammate,
  chooseFrom,
  initialName,
  initialSteps,
  initialSchedule,
  truncated,
  routeLabel,
  busy,
  error,
  onSave,
  onCancel
}: {
  readonly teammate: PublicTeammate | undefined
  /**
   * Who could run it, when the conversation had no owner to inherit.
   *
   * A conversation can be started with nobody picked -- that is half the
   * product -- and until now that was the one thing you could not save as a
   * routine. The steps were never the problem: they are the words the person
   * typed, which exist either way. What was missing is whose route replays
   * them, so the dialog asks, once, here.
   */
  readonly chooseFrom?: readonly PublicTeammate[]
  readonly initialName: string
  readonly initialSteps: readonly string[]
  /** When it runs on its own, if it does. Undefined: only when a person presses Run. */
  readonly initialSchedule: RoutineSchedule | undefined
  /** The conversation had more turns than a routine may hold, and the draft was cut. */
  readonly truncated: boolean
  /** The route this will replay on, in the words the picker uses. */
  readonly routeLabel: string | undefined
  readonly busy: boolean
  readonly error: string | undefined
  readonly onSave: (input: {
    readonly name: string
    readonly steps: readonly string[]
    readonly schedule: RoutineSchedule | undefined
    readonly teammateId?: string
  }) => void
  readonly onCancel: () => void
}): ReactElement {
  const editing = initialSteps.length > 0 && routeLabel === undefined
  const [name, setName] = useState(initialName)
  const [steps, setSteps] = useState<readonly string[]>(initialSteps)
  const [schedule, setSchedule] = useState<RoutineSchedule | undefined>(initialSchedule)
  // Nobody is picked to begin with: a default here would put a teammate's
  // name on work they were never part of, which is the one thing the whole
  // ownerless path exists to avoid.
  const [runner, setRunner] = useState<string>('')
  const mustPick = chooseFrom !== undefined && chooseFrom.length > 0 && teammate === undefined
  const scheduleKind = schedule?.kind ?? 'off'

  const kept = steps.filter((step) => step.trim().length > 0)
  const canSave = name.trim().length > 0 && kept.length > 0 && !busy && (!mustPick || runner.length > 0)
  // Focus in, Tab held inside, Escape closes, focus back to the opener.
  const box = useRef<HTMLDivElement>(null)
  useModal(box, onCancel)

  return (
    <div className="lc-scrim">
      <div ref={box} className="lc-dialog" role="dialog" aria-modal="true" aria-label={editing ? 'Edit routine' : 'Save as routine'}>
        <div className="lc-dialog__head">
          <span className="lc-dialog__title">{editing ? 'Edit routine' : 'Save as routine'}</span>
          <span className="lc-dialog__sub lc-mono">replayed step by step</span>
          <button type="button" className="lc-dialog__close" aria-label="Close" onClick={onCancel}>
            ×
          </button>
        </div>

        <div className="lc-dialog__body">
          <div className="lc-dialog__fields">
            <label className="lc-fieldlabel lc-mono" htmlFor="routine-name">
              Name
            </label>
            <input
              id="routine-name"
              className="lc-input"
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              placeholder="Nightly tidy"
            />
          </div>

          {teammate !== undefined && (
            <p className="lc-dialog__note lc-mono">
              <PixelFace hue={teammate.hue} avatar={teammate.avatar} size={16} /> {teammate.name} runs it
              {routeLabel === undefined ? '' : ` on ${routeLabel}`}. A routine saved read-only stays read-only.
            </p>
          )}

          {/*
            * ASKED, NOT GUESSED. A conversation with nobody picked has no
            * owner to inherit, and a routine runs on somebody's route -- so
            * the one missing fact is asked for here rather than defaulted to
            * whoever happens to be first in the roster.
            */}
          {mustPick && (
            <div className="lc-dialog__fields">
              <label className="lc-fieldlabel lc-mono" htmlFor="routine-runner">
                Who runs it
              </label>
              <select
                id="routine-runner"
                className="lc-input"
                value={runner}
                onChange={(event) => setRunner(event.target.value)}
              >
                <option value="">Pick a teammate</option>
                {chooseFrom?.map((entry) => (
                  <option key={entry.teammateId} value={entry.teammateId}>
                    {entry.name}
                  </option>
                ))}
              </select>
              <p className="lc-dialog__note lc-mono">
                This conversation was not assigned to anyone. It replays on the teammate you pick, on their route.
              </p>
            </div>
          )}

          {/*
            * And the case where there is nobody to pick. Said rather than
            * silently unsavable: the app cannot invent a teammate, and a
            * disabled button with no sentence is the failure this whole file
            * keeps being about.
            */}
          {chooseFrom !== undefined && chooseFrom.length === 0 && teammate === undefined && (
            <p className="lc-dialog__note lc-mono">
              A routine runs on a teammate&apos;s route, and there are no teammates yet. Add one, then save this again.
            </p>
          )}

          <div className="lc-dialog__section">
            <span className="lc-fieldlabel lc-mono">
              Steps <span className="lc-queued__note">{String(steps.length)} of {String(MAX_ROUTINE_STEPS)}</span>
            </span>
            {steps.map((step, index) => {
              /*
               * A step longer than the message can carry, said WHILE it is
               * typed.
               *
               * The store accepts 20,000 characters and the runtime prompt cap
               * is 12,000 for the step, the workspace briefing, anything
               * waiting from teammates and the roster trailer together. So a
               * step could be saved here and then never send -- and worse, an
               * over-long one used to make the host shed every waiting peer
               * message trying to fit, fail anyway, and send it over the cap
               * regardless (R4, docs/ROUTINES-RECHECK-2026-09-08.md). That
               * half is fixed in the host; this is the half that stops it
               * being saved in the first place.
               *
               * A warning, not a block: the cap is not lowered, because
               * `parsedRoutine` validates length on READ and a smaller one
               * would make routines people already saved unreadable.
               */
              const tooLong = stepTooLongNotice(step)
              return (
                <div className="lc-routinestep" key={`step_${String(index)}`}>
                  <span className="lc-routinestep__n lc-mono">{index + 1}</span>
                  <textarea
                    className="lc-input lc-routinestep__text"
                    aria-label={`Step ${String(index + 1)}`}
                    value={step}
                    rows={2}
                    aria-invalid={tooLong !== undefined}
                    {...(tooLong === undefined ? {} : { 'aria-describedby': `step-too-long-${String(index)}` })}
                    onChange={(event) =>
                      setSteps(steps.map((held, at) => (at === index ? event.target.value : held)))
                    }
                  />
                  <button
                    type="button"
                    className="lc-ghostbutton lc-routinestep__drop"
                    aria-label={`Remove step ${String(index + 1)}`}
                    onClick={() => setSteps(steps.filter((_, at) => at !== index))}
                  >
                    Remove
                  </button>
                  {tooLong !== undefined && (
                    <p className="lc-routinestep__over lc-tone-amber" id={`step-too-long-${String(index)}`}>
                      {tooLong}
                    </p>
                  )}
                </div>
              )
            })}
            {/*
              * Kept and disabled at the cap rather than unmounted. A control
              * that vanishes reads as a broken dialog; one that stays and
              * says why teaches the limit (design pass, gap 4).
              */}
            <button
              type="button"
              className="lc-ghostbutton"
              disabled={steps.length >= MAX_ROUTINE_STEPS}
              title={steps.length >= MAX_ROUTINE_STEPS ? `A routine holds ${String(MAX_ROUTINE_STEPS)} steps at most` : undefined}
              onClick={() => setSteps([...steps, ''])}
            >
              Add a step
            </button>
          </div>

          <div className="lc-dialog__section">
            <span className="lc-fieldlabel lc-mono" id="routine-schedule-label">
              Runs on its own
            </span>
            <div className="lc-routinesched">
              <div className="lc-segmented" role="radiogroup" aria-labelledby="routine-schedule-label">
                {(
                  [
                    ['off', 'Only when I press Run'],
                    ['every', 'Every few hours'],
                    ['daily', 'Daily at a time']
                  ] as const
                ).map(([kind, label]) => (
                  <button
                    key={kind}
                    type="button"
                    role="radio"
                    aria-checked={scheduleKind === kind}
                    className={`lc-button${scheduleKind === kind ? ' is-active' : ''}`}
                    onClick={() => {
                      // Pressing the choice already made keeps what was set
                      // under it: a person who taps "Daily" twice has not
                      // asked for 09:00 back.
                      if (kind === scheduleKind) return
                      setSchedule(
                        kind === 'off' ? undefined : kind === 'every' ? { kind: 'every', hours: 4 } : { kind: 'daily', at: '09:00' }
                      )
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {schedule?.kind === 'every' && (
                <label className="lc-routinesched__detail lc-mono">
                  every
                  <select
                    className="lc-input lc-routinesched__pick"
                    aria-label="Hours between runs"
                    value={String(schedule.hours)}
                    onChange={(event) => setSchedule({ kind: 'every', hours: Number(event.target.value) })}
                  >
                    {EVERY_HOURS_CHOICES.map((hours) => (
                      <option key={hours} value={String(hours)}>
                        {hours === 1 ? '1 hour' : `${String(hours)} hours`}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {schedule?.kind === 'daily' && (
                <label className="lc-routinesched__detail lc-mono">
                  at
                  <input
                    type="time"
                    className="lc-input lc-routinesched__pick"
                    aria-label="Time of day"
                    value={schedule.at}
                    onChange={(event) => {
                      if (/^\d\d:\d\d$/u.test(event.target.value)) setSchedule({ kind: 'daily', at: event.target.value })
                    }}
                  />
                </label>
              )}
            </div>
            {schedule !== undefined && (
              <p className="lc-dialog__note lc-mono">
                Only while Locust is open, and only when {teammate?.name ?? 'the teammate'} is free. A run missed while
                Locust was closed happens once, the next time it is open.
              </p>
            )}
          </div>

          {truncated && (
            <p className="lc-dialog__note lc-mono">
              This conversation had more turns than a routine can hold, so the first {String(MAX_ROUTINE_STEPS)} are here.
            </p>
          )}
          <p className="lc-dialog__note lc-mono">
            Each step runs only after the one before it finishes. A step that fails ends the routine there.
          </p>
          {error !== undefined && <p className="lc-dialog__error">{error}</p>}
        </div>

        <div className="lc-dialog__foot">
          <button type="button" className="lc-ghostbutton" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="lc-primarybutton"
            disabled={!canSave}
            onClick={() =>
              onSave({
                name: name.trim(),
                steps: kept.map((step) => step.trim()),
                schedule,
                ...(runner.length === 0 ? {} : { teammateId: runner })
              })
            }
          >
            {editing ? 'Save changes' : 'Save routine'}
          </button>
        </div>
      </div>
    </div>
  )
}
