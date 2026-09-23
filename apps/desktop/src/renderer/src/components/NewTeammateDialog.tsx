import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { useModal } from '../useModal.js'

import { BOT_SHAPES, botFor, seedAvatar, shuffledAvatar } from '../../../shared/avatar.js'
import type { AvatarSpec, BotShape } from '../../../shared/avatar.js'
import type { MissionMode, PublicTeammate, TeammateHue, TeammateRole, PublicConnector} from '../../../shared/ipc.js'
import { modeSummary } from '../status.js'
import { TeammateBot } from './TeammateBot.js'
import { branchNameFor } from '../../../shared/worktree-name.js'

const HUES: readonly { readonly hue: TeammateHue; readonly label: string }[] = [
  { hue: 'lime', label: 'Lime' },
  { hue: 'blue', label: 'Blue' },
  { hue: 'violet', label: 'Violet' },
  { hue: 'clay', label: 'Clay' },
  { hue: 'teal', label: 'Teal' },
  { hue: 'butter', label: 'Butter' },
  { hue: 'rose', label: 'Rose' },
  { hue: 'slate', label: 'Slate' },
  { hue: 'pearl', label: 'Pearl' }
]

/** What each shape is called in the Look grid; Locust's own two say so. */
const SHAPE_NAMES: Readonly<Record<BotShape, string>> = {
  clover: 'Clover',
  flower: 'Flower',
  triangle: 'Triangle',
  square: 'Square',
  blob: 'Blob',
  ghost: 'Ghost',
  circle: 'Circle',
  drop: 'Drop',
  star: 'Star',
  droid: 'Droid',
  mech: 'Mech',
  alien: 'Alien',
  hexagon: 'Hexagon',
  cat: 'Cat',
  cloud: 'Cloud',
  pill: 'Pill',
  pebble: 'Pebble',
  puddle: 'Puddle',
  hopper: 'Hopper, a Locust',
  swarm: 'Swarm, a Locust'
}

const ROLES: readonly { readonly role: TeammateRole; readonly description: string }[] = [
  { role: 'Code & Migrations', description: 'Repo work, refactors, test runs' },
  { role: 'Research & Briefs', description: 'Reading, comparing, summarising' },
  { role: 'Ops & Scheduling', description: 'Routine jobs and reminders' },
  { role: 'Docs & QA', description: 'Written output and checking' },
  { role: 'Data & Reporting', description: 'Spreadsheets, figures, digests' },
  { role: 'Chief of Staff', description: 'Routes work to the team, reports back' },
  { role: 'Custom', description: 'Describe the work yourself' }
]

/**
 * The face is generated, then owned: the dialog seeds a look the moment it
 * opens (from a throwaway id, so two dialogs opened in a row start from
 * different faces), the person can shuffle it or recolour it, and whatever is
 * on the preview when they create is what gets persisted with the record.
 * Never derived from the name -- a rename must not change a face.
 */
/**
 * What the next mission may do, in the words the mode menu uses.
 *
 * A `switch` with no default, so the union is exhausted and a mode added
 * later cannot fall through. It used to end in a bare `return 'Ask ...'`,
 * and `auto` -- added after this was written -- landed there: a composer
 * reading "may edit anything on this machine" opened a dialog promising
 * "every write refused". Caught 2026-09-09 in the folder drive's capture,
 * which is the THIRD time this dialog has claimed a permission the run did
 * not have, and the first time in the direction that understates it.
 */
/* `modeSummary` now lives in `status.ts` with every other mode phrasing. */

export function NewTeammateDialog({
  onCancel,
  onCreate,
  error,
  initial,
  mode,
  onChooseFolder,
  folderNotice,
  connectors,
  onSetConnectors
}: {
  readonly onCancel: () => void
  readonly onCreate: (input: { name: string; hue: TeammateHue; role: TeammateRole; roleTitle?: string; worktree?: boolean; avatar: AvatarSpec }) => void
  readonly error: string | undefined
  /** Set to edit an existing teammate: the same dialog, filled in, saving instead of creating. */
  readonly initial?: PublicTeammate
  /** The mode the next mission would actually run in, so the card cannot promise another. */
  readonly mode: MissionMode
  /**
   * Ask the host for this teammate's own folder, or clear it.
   *
   * Takes effect at once rather than on Save, because the path is the HOST's
   * to name -- the renderer is handed a teammate back, never a path it could
   * have typed. Absent while creating: a teammate with no id yet has nothing
   * to write the folder onto.
   */
  readonly onChooseFolder?: (clear: boolean) => void
  /** Why the last folder request did nothing. Absent when it worked, or was cancelled. */
  readonly folderNotice?: string
  /**
   * Every connector the person's Claude Code reports, for narrowing. Absent
   * while it is being read, or where narrowing is not offered.
   */
  readonly connectors?: readonly PublicConnector[]
  /** The whole list of ticked names; empty means every connector. Takes effect at once. */
  readonly onSetConnectors?: (names: readonly string[]) => void
}): ReactElement {
  const editing = initial !== undefined
  const [name, setName] = useState(initial?.name ?? '')
  const [hue, setHue] = useState<TeammateHue>(initial?.hue ?? 'lime')
  const [avatar, setAvatar] = useState<AvatarSpec>(
    () => initial?.avatar ?? seedAvatar(`draft_${Date.now()}_${Math.random()}`)
  )
  const [role, setRole] = useState<TeammateRole>(initial?.role ?? 'Code & Migrations')
  const [roleTitle, setRoleTitle] = useState(initial?.roleTitle ?? '')
  const [worktree, setWorktree] = useState(initial?.worktree === true)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  const trimmed = name.trim()
  const canCreate = trimmed.length > 0
  const look = botFor(avatar)

  // Focus in (the name field, above), Tab held inside, Escape closes -- from
  // anywhere now, not only while focus happened to be in the dialog.
  const box = useRef<HTMLDivElement>(null)
  useModal(box, onCancel)

  return (
    <div className="lc-scrim">
      <div ref={box} className="lc-dialog" role="dialog" aria-modal="true" aria-label={editing ? 'Edit teammate' : 'New teammate'}>
        <div className="lc-dialog__head">
          <span className="lc-dialog__title">{editing ? 'Edit teammate' : 'New teammate'}</span>
          <span className="lc-dialog__sub lc-mono">lives on this machine</span>
          <button type="button" className="lc-dialog__close" aria-label="Close" onClick={onCancel}>
            ✕
          </button>
        </div>

        <div className="lc-dialog__body">
          <div className="lc-dialog__identity">
            {/* The preview works, so the person sees the behaviour a live
                teammate has -- all of it, as the face in a conversation does. */}
            <TeammateBot hue={hue} avatar={avatar} size={56} activity="working" presence="working" motion="full" />
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
                    <TeammateBot hue={option.hue} avatar={avatar} size={24} />
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/*
            * CHOOSE A LOOK. Colin, 2026-09-22, on the bots: "we could just
            * have a choose your avatar option or both, whatever you decide".
            * Both: Shuffle rolls a look, and the grid picks one outright --
            * every shape in the teammate's own colour, still; the preview
            * above is the one that moves.
            */}
          <div className="lc-dialog__section">
            <div className="lc-lookhead">
              <span className="lc-fieldlabel lc-mono">Look</span>
              <div className="lc-lookface" role="radiogroup" aria-label="Face">
                {(['eyes', 'mouth'] as const).map((face) => (
                  <button
                    key={face}
                    type="button"
                    role="radio"
                    aria-checked={look.face === face}
                    className={look.face === face ? 'is-selected' : undefined}
                    onClick={() => setAvatar((current) => ({ ...current, bot: { shape: botFor(current).shape, face } }))}
                  >
                    {face === 'eyes' ? 'Eyes' : 'Mouth'}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="lc-ghostbutton lc-shuffle"
                onClick={() => setAvatar((current) => shuffledAvatar(current))}
              >
                Shuffle look
              </button>
            </div>
            <div className="lc-lookgrid" role="radiogroup" aria-label="Look">
              {BOT_SHAPES.map((shape) => (
                <button
                  key={shape}
                  type="button"
                  role="radio"
                  aria-checked={look.shape === shape}
                  aria-label={SHAPE_NAMES[shape]}
                  title={SHAPE_NAMES[shape]}
                  data-shape={shape}
                  className={`lc-look${look.shape === shape ? ' is-selected' : ''}`}
                  onClick={() => setAvatar((current) => ({ ...current, bot: { shape, face: botFor(current).face } }))}
                >
                  <TeammateBot hue={hue} avatar={{ ...avatar, bot: { shape, face: look.face } }} size={30} />
                </button>
              ))}
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
            * Own branch: the teammate's missions run in its own worktree of the
            * folder's repository, so two teammates editing one repository do
            * not collide (parity row 64). Bringing the branch back is a git
            * operation of the person's; Locust merges nothing.
            */}
          <div className="lc-field lc-field--switch">
            <button
              type="button"
              role="switch"
              aria-checked={worktree}
              aria-label="Own branch"
              className={`lc-memory__switch${worktree ? ' is-on' : ''}`}
              onClick={() => setWorktree(!worktree)}
            >
              <span className="lc-memory__knob" />
            </button>
            <span className="lc-field__text">
              <span className="lc-fieldlabel lc-mono">Own branch</span>
              <span className="lc-field__hint">
                Works in its own copy of the folder, on branch {branchNameFor(name.trim().length === 0 ? 'teammate' : name)}. Needs the folder to be a git repository.
                Merging back is yours to do.
              </span>
            </span>
          </div>

          {/*
            * The folder THIS teammate stands in.
            *
            * Not the project folder switch in Settings: that one reopens
            * Locust, because history, memory and worktrees are all scoped by
            * it. This moves one teammate and closes nothing. Colin,
            * 2026-09-09: "it should only change the folder for that
            * chat/teammate not the entire app."
            *
            * Only when editing. A teammate being created has no id yet, and
            * the host writes the folder onto a record.
            */}
          {editing && onChooseFolder !== undefined && (
            <div className="lc-field lc-field--folder">
              <span className="lc-fieldlabel lc-mono">Works in</span>
              <div className="lc-folderrow">
                <span
                  className={`lc-folderrow__path lc-mono${initial?.folder === undefined ? ' is-default' : ''}`}
                  title={initial?.folder ?? 'The project folder'}
                >
                  {initial?.folder ?? 'The project folder'}
                </span>
                <button type="button" className="lc-button" onClick={() => onChooseFolder(false)}>
                  {initial?.folder === undefined ? 'Choose folder' : 'Change'}
                </button>
                {initial?.folder !== undefined && (
                  <button type="button" className="lc-button" onClick={() => onChooseFolder(true)}>
                    Use the project folder
                  </button>
                )}
              </div>
              <span className="lc-field__hint">
                Its missions run here instead of the project folder, which is also how it reaches an MCP server registered
                to that folder. History and memory stay with the project either way.
              </span>
              {folderNotice !== undefined && <span className="lc-field__hint lc-tone-amber">{folderNotice}</span>}
            </div>
          )}

          {/*
            * Which connectors THIS teammate may use without asking.
            *
            * Nothing ticked is the ordinary state and means every connector
            * the person has -- Colin's ruling. Ticking some NARROWS: a
            * Finance Bro gets Robinhood and not Gmail, and a call to anything
            * else stops the run and asks. Every name here was read off
            * `claude mcp list`; none can be typed.
            *
            * Only when editing, like the folder: a teammate being created has
            * nothing to write a list onto.
            */}
          {editing && onSetConnectors !== undefined && connectors !== undefined && connectors.length > 0 && (
            <div className="lc-field lc-field--connectors">
              <span className="lc-fieldlabel lc-mono">Connectors</span>
              <div className="lc-connectorgrid" role="group" aria-label="Connectors this teammate may use">
                {connectors.map((connector) => {
                  const narrowed = initial?.connectors ?? []
                  const on = narrowed.length === 0 || narrowed.includes(connector.name)
                  const label = connector.name.replace(/^claude\.ai /, '')
                  return (
                    <button
                      key={connector.name}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      className={`lc-connectorpick${on ? ' is-on' : ''}${connector.status === 'connected' ? '' : ' is-unready'}`}
                      title={connector.status === 'connected' ? connector.location : `${connector.name} — ${connector.status === 'needs-auth' ? 'not signed in yet' : 'not responding'}`}
                      onClick={() => {
                        // From "everything" the first untick narrows to all-but-one;
                        // unticking the last one widens back to everything.
                        const current = narrowed.length === 0 ? connectors.map((entry) => entry.name) : [...narrowed]
                        const next = on ? current.filter((name) => name !== connector.name) : [...current, connector.name]
                        onSetConnectors(next.length === connectors.length ? [] : next)
                      }}
                    >
                      <span>{label}</span>
                    </button>
                  )
                })}
              </div>
              <span className="lc-field__hint">
                {(initial?.connectors ?? []).length === 0
                  ? 'All of them, without asking. Untick one and this teammate is limited to the rest; a call to anything else asks you first.'
                  : `Only these, without asking. A call to any other connector stops the run and asks you.`}
              </span>
            </div>
          )}

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
            {/*
              * The mode the next mission will ACTUALLY run in. This said
              * "Read-only · nothing outside the workspace" as fixed copy,
              * while the composer's default is Accept edits -- so a fresh
              * profile promised read-only in the dialog and then wrote files
              * (QA pass, 2026-09-05). Same defect as the idle teammate's
              * sentence, fixed in 0.18.3; this was its second home.
              */}
            <div className="lc-summarycard">
              <span className="lc-summarycard__text">{modeSummary(mode)}</span>
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
                ...(worktree ? { worktree: true } : {}),
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
