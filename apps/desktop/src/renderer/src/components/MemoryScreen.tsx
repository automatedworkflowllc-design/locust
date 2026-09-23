import type { ReactElement } from 'react'
import { useState } from 'react'

import type { MemoryMode, MemoryScope, MemoryUpdateRequest, PublicMemory, PublicTeammate } from '../../../shared/ipc.js'
import { TeammateBot } from './TeammateBot.js'

/**
 * What the team remembers, and the person's hand on it.
 *
 * The shared memory Claude Code and Cursor keep, with the management both
 * of them put behind a settings page brought to the front: every memory
 * says who wrote it, in which folder, from which conversation; each can be
 * edited, switched off, or removed; one a teammate proposed waits here for
 * a keep or a forget. Only kept, switched-on memories reach a teammate.
 */
export function MemoryScreen({
  memories,
  workspaceId,
  workspaceName,
  teammates,
  mode,
  onModeChange,
  onAdd,
  onUpdate,
  onRemove,
  onClear,
  onOpenMission,
  notice,
  onDismissNotice
}: {
  readonly memories: readonly PublicMemory[]
  readonly workspaceId: string
  readonly workspaceName: string
  readonly teammates: readonly PublicTeammate[]
  readonly mode: MemoryMode
  readonly onModeChange: (mode: MemoryMode) => void
  readonly onAdd: (text: string, scope: MemoryScope) => Promise<string | undefined>
  readonly onUpdate: (request: MemoryUpdateRequest) => Promise<string | undefined>
  readonly onRemove: (memoryId: string) => Promise<string | undefined>
  readonly onClear: (scope: 'workspace' | 'all') => Promise<string | undefined>
  readonly onOpenMission: (missionId: string) => void
  /** The host's last word about memory, when it had one. */
  readonly notice: string | undefined
  /**
   * Clearing it. Without this the sentence stayed for the rest of the session
   * -- its siblings on the Automations and Rooms screens both have one, and
   * this is the screen where the person is already acting on what it says.
   */
  readonly onDismissNotice: () => void
}): ReactElement {
  const [draft, setDraft] = useState('')
  const [draftScope, setDraftScope] = useState<MemoryScope>('workspace')
  const [editing, setEditing] = useState<{ readonly memoryId: string; readonly text: string }>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [confirmClear, setConfirmClear] = useState<'workspace' | 'all'>()

  const proposed = memories.filter((memory) => memory.status === 'proposed')
  const here = memories.filter((memory) => memory.status === 'kept' && memory.scope === 'workspace' && memory.workspaceId === workspaceId)
  const everywhere = memories.filter((memory) => memory.status === 'kept' && memory.scope === 'global')
  const elsewhere = memories.filter((memory) => memory.status === 'kept' && memory.scope === 'workspace' && memory.workspaceId !== workspaceId)

  const act = async (work: () => Promise<string | undefined>): Promise<void> => {
    setError(undefined)
    setBusy(true)
    const refused = await work()
    setBusy(false)
    if (refused !== undefined) setError(refused)
  }

  const add = async (): Promise<void> => {
    if (draft.trim().length === 0) return
    await act(async () => {
      const refused = await onAdd(draft, draftScope)
      if (refused === undefined) setDraft('')
      return refused
    })
  }

  const saveEdit = async (): Promise<void> => {
    if (editing === undefined) return
    await act(async () => {
      const refused = await onUpdate({ memoryId: editing.memoryId, text: editing.text })
      if (refused === undefined) setEditing(undefined)
      return refused
    })
  }

  const when = (iso: string): string => {
    const at = new Date(iso)
    return Number.isNaN(at.getTime()) ? '' : at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }

  const row = (memory: PublicMemory): ReactElement => {
    const author = memory.by.teammateId === undefined ? undefined : teammates.find((entry) => entry.teammateId === memory.by.teammateId)
    const isEditing = editing?.memoryId === memory.memoryId
    return (
      <div key={memory.memoryId} className={`lc-memory${memory.enabled ? '' : ' is-off'}${memory.status === 'proposed' ? ' is-proposed' : ''}`}>
        <button
          type="button"
          role="switch"
          aria-checked={memory.enabled}
          aria-label={memory.enabled ? 'Switch this memory off' : 'Switch this memory on'}
          className={`lc-memory__switch${memory.enabled ? ' is-on' : ''}`}
          disabled={busy || memory.status === 'proposed'}
          title={memory.status === 'proposed' ? 'Keep it first' : memory.enabled ? 'On: teammates read this' : 'Off: kept, but not read'}
          onClick={() => void act(() => onUpdate({ memoryId: memory.memoryId, enabled: !memory.enabled }))}
        >
          <span className="lc-memory__knob" />
        </button>
        <div className="lc-memory__body">
          {isEditing ? (
            <textarea
              className="lc-input lc-memory__edit"
              aria-label="Memory text"
              rows={2}
              maxLength={300}
              value={editing.text}
              onChange={(event) => setEditing({ memoryId: memory.memoryId, text: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void saveEdit()
                }
                if (event.key === 'Escape') setEditing(undefined)
              }}
            />
          ) : (
            <p className="lc-memory__text">{memory.text}</p>
          )}
          <p className="lc-memory__meta lc-mono">
            {author === undefined ? (
              <span>{memory.by.name}</span>
            ) : (
              <span className="lc-memory__author">
                <TeammateBot hue={author.hue} avatar={author.avatar} size={14} activity="idle" presence="none" />
                {author.name}
              </span>
            )}
            <span> · {memory.scope === 'global' ? `everywhere, from ${memory.workspaceName}` : memory.workspaceName}</span>
            <span> · {when(memory.createdAt)}</span>
            {memory.missionId !== undefined && (
              <>
                <span> · </span>
                <button type="button" className="lc-linkbutton" onClick={() => onOpenMission(memory.missionId!)}>
                  Open the conversation
                </button>
              </>
            )}
          </p>
        </div>
        <span className="lc-memory__actions">
          {memory.status === 'proposed' ? (
            <>
              <button type="button" className="lc-button is-active" disabled={busy} onClick={() => void act(() => onUpdate({ memoryId: memory.memoryId, keep: true }))}>
                Keep
              </button>
              <button type="button" className="lc-ghostbutton" disabled={busy} onClick={() => void act(() => onRemove(memory.memoryId))}>
                Forget
              </button>
            </>
          ) : isEditing ? (
            <>
              <button type="button" className="lc-button is-active" disabled={busy || editing.text.trim().length === 0} onClick={() => void saveEdit()}>
                Save
              </button>
              <button type="button" className="lc-ghostbutton" onClick={() => setEditing(undefined)}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button type="button" className="lc-ghostbutton" disabled={busy} onClick={() => setEditing({ memoryId: memory.memoryId, text: memory.text })}>
                Edit
              </button>
              <button type="button" className="lc-ghostbutton" disabled={busy} onClick={() => void act(() => onRemove(memory.memoryId))}>
                Remove
              </button>
            </>
          )}
        </span>
      </div>
    )
  }

  const kept = here.length + everywhere.length + elsewhere.length

  return (
    <div className="lc-screen">
      <div className="lc-screen__header">
        <span className="lc-screen__title">Memory</span>
        <span className="lc-screen__meta lc-mono">
          {kept === 0 ? 'nothing remembered yet' : `${String(kept)} remembered`}
          {proposed.length > 0 ? ` · ${String(proposed.length)} waiting for you` : ''}
          {mode === 'off' ? ' · off' : ''}
        </span>
      </div>
      <div className="lc-screen__scroll">
        {notice !== undefined && notice.length > 0 && (
          <p className="lc-settings__note lc-memory__notice">
            {notice}{' '}
            <button type="button" className="lc-ghostbutton" onClick={onDismissNotice}>
              Dismiss
            </button>
          </p>
        )}
        {error !== undefined && <p className="lc-dialog__error">{error}</p>}

        <section className="lc-settings__section">
          <h2 className="lc-settings__heading">How memory is kept</h2>
          <p className="lc-settings__lede">
            Every teammate in a folder reads what is remembered for that folder and everything marked
            everywhere. A teammate writes a memory by ending a reply with one; you can also write one
            below. Nothing here is uploaded: memory lives in Locust&rsquo;s own data on this machine.
          </p>
          <div className="lc-segmented" role="radiogroup" aria-label="How a teammate's memory is treated">
            {(
              [
                ['auto', 'Keep and tell me'],
                ['ask', 'Ask me first'],
                ['off', 'Off']
              ] as const
            ).map(([value, label]) => (
              <button key={value} type="button" role="radio" aria-checked={mode === value} className={`lc-button${mode === value ? ' is-active' : ''}`} onClick={() => onModeChange(value)}>
                {label}
              </button>
            ))}
          </div>
          <p className="lc-settings__note">
            {mode === 'auto'
              ? 'A memory a teammate writes is kept at once and said in the conversation; undo it here.'
              : mode === 'ask'
                ? 'A memory a teammate writes waits below until you keep or forget it.'
                : 'Teammates are not told what is remembered and cannot write memory. What is kept stays here.'}
          </p>
        </section>

        {proposed.length > 0 && (
          <section className="lc-settings__section">
            <h2 className="lc-settings__heading">Waiting for you</h2>
            <div className="lc-memorylist">{proposed.map(row)}</div>
          </section>
        )}

        <section className="lc-settings__section">
          {/* The folder's own name keeps its own spelling: titles are set in
            * capitals, and a name is an identifier, not a title. */}
          <h2 className="lc-settings__heading">
            This folder · <span className="lc-title__name">{workspaceName}</span>
          </h2>
          {here.length === 0 ? <p className="lc-settings__note">Nothing remembered for this folder yet.</p> : <div className="lc-memorylist">{here.map(row)}</div>}
        </section>

        <section className="lc-settings__section">
          <h2 className="lc-settings__heading">Everywhere</h2>
          {everywhere.length === 0 ? <p className="lc-settings__note">Nothing remembered for every folder yet.</p> : <div className="lc-memorylist">{everywhere.map(row)}</div>}
        </section>

        {elsewhere.length > 0 && (
          <section className="lc-settings__section">
            <h2 className="lc-settings__heading">Other folders</h2>
            <p className="lc-settings__note">Remembered for folders Locust has been opened in. Teammates here do not read these.</p>
            <div className="lc-memorylist">{elsewhere.map(row)}</div>
          </section>
        )}

        <section className="lc-settings__section">
          <h2 className="lc-settings__heading">Remember something</h2>
          <div className="lc-memoryform">
            <textarea
              className="lc-input"
              aria-label="What to remember"
              placeholder="One sentence, specific enough to act on"
              rows={2}
              maxLength={300}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <div className="lc-memoryform__row">
              <div className="lc-segmented" role="radiogroup" aria-label="Where it applies">
                {(
                  [
                    ['workspace', 'This folder'],
                    ['global', 'Everywhere']
                  ] as const
                ).map(([value, label]) => (
                  <button key={value} type="button" role="radio" aria-checked={draftScope === value} className={`lc-button${draftScope === value ? ' is-active' : ''}`} onClick={() => setDraftScope(value)}>
                    {label}
                  </button>
                ))}
              </div>
              <button type="button" className="lc-primarybutton" disabled={busy || draft.trim().length === 0} onClick={() => void add()}>
                Remember
              </button>
            </div>
          </div>
        </section>

        {kept + proposed.length > 0 && (
          <section className="lc-settings__section">
            <h2 className="lc-settings__heading">Forget</h2>
            {confirmClear === undefined ? (
              <div className="lc-memoryform__row">
                <button type="button" className="lc-ghostbutton" onClick={() => setConfirmClear('workspace')}>
                  Forget everything for this folder
                </button>
                <button type="button" className="lc-ghostbutton" onClick={() => setConfirmClear('all')}>
                  Forget everything
                </button>
              </div>
            ) : (
              <div className="lc-memoryform__row">
                <span className="lc-settings__note">
                  {confirmClear === 'all' ? 'Every memory, every folder, gone. ' : `Everything remembered for ${workspaceName}, gone. `}
                  This cannot be undone.
                </span>
                <button
                  type="button"
                  className="lc-button is-active"
                  disabled={busy}
                  onClick={() => {
                    const scope = confirmClear
                    setConfirmClear(undefined)
                    void act(() => onClear(scope))
                  }}
                >
                  Yes, forget
                </button>
                <button type="button" className="lc-ghostbutton" onClick={() => setConfirmClear(undefined)}>
                  Cancel
                </button>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
