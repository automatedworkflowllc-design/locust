import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactElement } from 'react'

import type { TeammateHue, TeammateRole } from '../../../shared/ipc.js'
import { FACE_PRESETS, PixelFace } from './PixelFace.js'

const HUES: readonly { readonly hue: TeammateHue; readonly label: string }[] = [
  { hue: 'lime', label: 'Lime' },
  { hue: 'blue', label: 'Blue' },
  { hue: 'violet', label: 'Violet' },
  { hue: 'clay', label: 'Clay' }
]

const ROLES: readonly { readonly role: TeammateRole; readonly description: string }[] = [
  { role: 'Code & Migrations', description: 'Repo work, refactors, test runs' },
  { role: 'Research & Briefs', description: 'Reading, comparing, summarising' },
  { role: 'Ops & Scheduling', description: 'Routine jobs and reminders' },
  { role: 'Docs & QA', description: 'Written output and checking' },
  { role: 'Data & Reporting', description: 'Spreadsheets, figures, digests' },
  { role: 'Custom', description: 'Describe the work yourself' }
]

const FACE_ORDER = ['wren', 'atlas', 'juno', 'sable'] as const

/**
 * The face is generated from the name rather than chosen: the user picks a hue
 * and gets a face, which is one decision instead of two and still gives every
 * teammate a stable, distinguishable identity. The seed is the trimmed name, so
 * the preview a user sees while typing is the face they get.
 */
export function faceForName(name: string): readonly (readonly [number, number])[] {
  const seed = [...name.trim().toLowerCase()].reduce((total, character) => total + character.charCodeAt(0), 0)
  const key = FACE_ORDER[seed % FACE_ORDER.length]!
  return FACE_PRESETS[key]!
}

export function NewTeammateDialog({
  onCancel,
  onCreate,
  error
}: {
  readonly onCancel: () => void
  readonly onCreate: (input: { name: string; hue: TeammateHue; role: TeammateRole }) => void
  readonly error: string | undefined
}): ReactElement {
  const [name, setName] = useState('')
  const [hue, setHue] = useState<TeammateHue>('lime')
  const [role, setRole] = useState<TeammateRole>('Code & Migrations')
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  const trimmed = name.trim()
  const canCreate = trimmed.length > 0

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
    }
  }

  return (
    <div className="lc-scrim" onKeyDown={onKeyDown}>
      <div className="lc-dialog" role="dialog" aria-modal="true" aria-label="New teammate">
        <div className="lc-dialog__head">
          <span className="lc-dialog__title">New teammate</span>
          <span className="lc-dialog__sub lc-mono">lives on this machine</span>
          <button type="button" className="lc-dialog__close" aria-label="Close" onClick={onCancel}>
            ✕
          </button>
        </div>

        <div className="lc-dialog__body">
          <div className="lc-dialog__identity">
            <PixelFace hue={hue} pixels={faceForName(trimmed.length > 0 ? trimmed : 'a')} size={56} />
            <div className="lc-dialog__fields">
              <label className="lc-fieldlabel lc-mono" htmlFor="lc-teammate-name">
                Name
              </label>
              <input
                id="lc-teammate-name"
                ref={nameRef}
                className="lc-input"
                value={name}
                maxLength={40}
                onChange={(event) => setName(event.target.value)}
                placeholder="Wren"
                autoComplete="off"
              />
              <div className="lc-hues" role="radiogroup" aria-label="Avatar colour">
                {HUES.map((option) => (
                  <button
                    key={option.hue}
                    type="button"
                    role="radio"
                    aria-checked={hue === option.hue}
                    aria-label={option.label}
                    className={`lc-hue${hue === option.hue ? ' is-selected' : ''}`}
                    onClick={() => setHue(option.hue)}
                  >
                    <PixelFace hue={option.hue} pixels={faceForName(trimmed.length > 0 ? trimmed : 'a')} size={24} />
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="lc-dialog__section">
            <span className="lc-fieldlabel lc-mono">Role</span>
            <div className="lc-rolegrid" role="radiogroup" aria-label="Role">
              {ROLES.map((option) => (
                <button
                  key={option.role}
                  type="button"
                  role="radio"
                  aria-checked={role === option.role}
                  className={`lc-rolecard${role === option.role ? ' is-selected' : ''}`}
                  onClick={() => setRole(option.role)}
                >
                  <span className="lc-rolecard__name">{option.role}</span>
                  <span className="lc-rolecard__desc">{option.description}</span>
                </button>
              ))}
            </div>
          </div>

          {/*
            The reference shows a default route and approval mode here. Both are
            stated as what they are today rather than as settings this dialog
            can change: route selection lands with the route layer, and approval
            modes need a write-capable sandbox to mean anything.
          */}
          <div className="lc-dialog__summary">
            <div className="lc-summarycard">
              <span className="lc-dot lc-tone-lime" />
              <span className="lc-summarycard__text">Whichever route is active when a mission starts</span>
              <span className="lc-summarycard__label lc-mono">DEFAULT ROUTE</span>
            </div>
            <div className="lc-summarycard">
              <span className="lc-summarycard__text">Read-only · nothing outside the workspace</span>
              <span className="lc-summarycard__label lc-mono">APPROVALS</span>
            </div>
          </div>

          <p className="lc-dialog__note lc-mono">
            A teammate is a name, a face and a place to keep missions. It grants no new access.
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
            disabled={!canCreate}
            onClick={() => onCreate({ name: trimmed, hue, role })}
          >
            Create teammate
          </button>
        </div>
      </div>
    </div>
  )
}
