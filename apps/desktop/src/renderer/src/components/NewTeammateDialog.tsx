import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactElement } from 'react'

import { seedAvatar, shuffledAvatar } from '../../../shared/avatar.js'
import type { AvatarSpec } from '../../../shared/avatar.js'
import type { PublicTeammate, TeammateHue, TeammateRole } from '../../../shared/ipc.js'
import { PixelFace } from './PixelFace.js'

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

/**
 * The face is generated, then owned: the dialog seeds a look the moment it
 * opens (from a throwaway id, so two dialogs opened in a row start from
 * different faces), the person can shuffle it or recolour it, and whatever is
 * on the preview when they create is what gets persisted with the record.
 * Never derived from the name -- a rename must not change a face.
 */
export function NewTeammateDialog({
  onCancel,
  onCreate,
  error,
  initial
}: {
  readonly onCancel: () => void
  readonly onCreate: (input: { name: string; hue: TeammateHue; role: TeammateRole; roleTitle?: string; avatar: AvatarSpec }) => void
  readonly error: string | undefined
  /** Set to edit an existing teammate: the same dialog, filled in, saving instead of creating. */
  readonly initial?: PublicTeammate
}): ReactElement {
  const editing = initial !== undefined
  const [name, setName] = useState(initial?.name ?? '')
  const [hue, setHue] = useState<TeammateHue>(initial?.hue ?? 'lime')
  const [avatar, setAvatar] = useState<AvatarSpec>(
    () => initial?.avatar ?? seedAvatar(`draft_${Date.now()}_${Math.random()}`)
  )
  const [role, setRole] = useState<TeammateRole>(initial?.role ?? 'Code & Migrations')
  const [roleTitle, setRoleTitle] = useState(initial?.roleTitle ?? '')
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
      <div className="lc-dialog" role="dialog" aria-modal="true" aria-label={editing ? 'Edit teammate' : 'New teammate'}>
        <div className="lc-dialog__head">
          <span className="lc-dialog__title">{editing ? 'Edit teammate' : 'New teammate'}</span>
          <span className="lc-dialog__sub lc-mono">lives on this machine</span>
          <button type="button" className="lc-dialog__close" aria-label="Close" onClick={onCancel}>
            ✕
          </button>
        </div>

        <div className="lc-dialog__body">
          <div className="lc-dialog__identity">
            {/* The preview works, so the person sees the behaviour a live teammate has. */}
            <PixelFace hue={hue} avatar={avatar} size={56} activity="working" presence="working" />
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
                    <PixelFace hue={option.hue} avatar={avatar} size={24} />
                  </button>
                ))}
                <button
                  type="button"
                  className="lc-ghostbutton lc-shuffle"
                  onClick={() => setAvatar((current) => shuffledAvatar(current))}
                >
                  Shuffle look
                </button>
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
            {role === 'Custom' && (
              // The words that stand in for a role name everywhere: beside the
              // name in the sidebar, and in the brief every runtime on the
              // roster is given. Short, because it sits in both places.
              <label className="lc-field lc-field--roletitle">
                <span className="lc-fieldlabel lc-mono">What they do</span>
                <input
                  type="text"
                  value={roleTitle}
                  maxLength={60}
                  placeholder="e.g. Release manager, or Reviews every PR for security"
                  onChange={(event) => setRoleTitle(event.target.value)}
                />
                <span className="lc-field__hint">Shown beside their name, and told to their runtime as their role.</span>
              </label>
            )}
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
            onClick={() =>
              onCreate({
                name: trimmed,
                hue,
                role,
                ...(role === 'Custom' && roleTitle.trim().length > 0 ? { roleTitle: roleTitle.trim() } : {}),
                avatar
              })
            }
          >
            {editing ? 'Save changes' : 'Create teammate'}
          </button>
        </div>
      </div>
    </div>
  )
}
