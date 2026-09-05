import { useState } from 'react'
import type { ReactElement } from 'react'

import type { PublicTeammate } from '../../../shared/ipc.js'
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
  initialName,
  initialSteps,
  truncated,
  routeLabel,
  busy,
  error,
  onSave,
  onCancel
}: {
  readonly teammate: PublicTeammate | undefined
  readonly initialName: string
  readonly initialSteps: readonly string[]
  /** The conversation had more turns than a routine may hold, and the draft was cut. */
  readonly truncated: boolean
  /** The route this will replay on, in the words the picker uses. */
  readonly routeLabel: string | undefined
  readonly busy: boolean
  readonly error: string | undefined
  readonly onSave: (input: { readonly name: string; readonly steps: readonly string[] }) => void
  readonly onCancel: () => void
}): ReactElement {
  const editing = initialSteps.length > 0 && routeLabel === undefined
  const [name, setName] = useState(initialName)
  const [steps, setSteps] = useState<readonly string[]>(initialSteps)

  const kept = steps.filter((step) => step.trim().length > 0)
  const canSave = name.trim().length > 0 && kept.length > 0 && !busy

  return (
    <div className="lc-scrim">
      <div className="lc-dialog" role="dialog" aria-modal="true" aria-label={editing ? 'Edit routine' : 'Save as routine'}>
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

          <div className="lc-dialog__section">
            <span className="lc-fieldlabel lc-mono">
              Steps <span className="lc-queued__note">{String(steps.length)} of {String(MAX_ROUTINE_STEPS)}</span>
            </span>
            {steps.map((step, index) => (
              <div className="lc-routinestep" key={`step_${String(index)}`}>
                <span className="lc-routinestep__n lc-mono">{index + 1}</span>
                <textarea
                  className="lc-input lc-routinestep__text"
                  aria-label={`Step ${String(index + 1)}`}
                  value={step}
                  rows={2}
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
              </div>
            ))}
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
            onClick={() => onSave({ name: name.trim(), steps: kept.map((step) => step.trim()) })}
          >
            {editing ? 'Save changes' : 'Save routine'}
          </button>
        </div>
      </div>
    </div>
  )
}
