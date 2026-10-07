import type { ReactElement } from 'react'

import { BACKGROUND_TRADE, backgroundStateWords } from '../../../shared/background.js'
import type { PublicBackgroundRun } from '../../../shared/background.js'
import { agoLabel } from '../teammateWork.js'
import { Icon } from './Icon.js'

/**
 * IN THE BACKGROUND (W10, 0.683): the Claude turns handed to Claude Code's own background sessions, which keep
 * going if Locust closes. Beside the conversation, as Cloud tasks are: Locust watches these, it does not run them.
 * A run waiting for a yes is answered in Claude Code (Open), never here; a finished one comes back into its
 * conversation by itself.
 */
export function BackgroundRuns({
  runs,
  note,
  onOpen,
  onStop,
  onShow,
  onDismiss,
  onSetUp,
  onClose
}: {
  readonly runs: readonly PublicBackgroundRun[]
  /** Said when the last send could not start: the folder is not trusted yet, or Claude Code refused. */
  readonly note?: { readonly text: string; readonly setUp?: true }
  readonly onOpen: (id: string) => void
  readonly onStop: (id: string) => void
  /** Opens the conversation turn a finished run came back as. */
  readonly onShow: (missionId: string) => void
  readonly onDismiss: (id: string) => void
  /** Claude Code in this folder, in a terminal, to answer its trust question once. */
  readonly onSetUp: () => void
  readonly onClose: () => void
}): ReactElement {
  const newestFirst = [...runs].sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))
  return (
    <aside className="lc-viewer lc-beside lc-cloudtasks" aria-label="In the background">
      <div className="lc-viewer__head">
        <Icon name="clock" size={14} />
        <span className="lc-beside__who">
          <span className="lc-viewer__name">In the background</span>
          <span className="lc-beside__title lc-mono">Claude Code</span>
        </span>
        <span className="lc-viewer__spacer" />
        <button type="button" className="lc-viewer__close" aria-label="Close" title="Close" onClick={onClose}>
          <Icon name="close" size={13} />
        </button>
      </div>
      <div className="lc-beside__thread lc-cloudtasks__list">
        {note !== undefined && (
          <div className="lc-cloudtasks__elsewhere">
            <p className="lc-cloudtasks__problem" role="alert">{note.text}</p>
            {note.setUp === true && (
              <div className="lc-cloudtask__actions">
                <button type="button" className="lc-button" onClick={onSetUp}>Open Claude Code in this folder</button>
              </div>
            )}
          </div>
        )}
        <p className="lc-cloudtasks__note">{BACKGROUND_TRADE}</p>
        {newestFirst.length === 0 && note === undefined && (
          <p className="lc-cloudtasks__empty">Nothing in the background yet. Pick Background in the chat type menu, then send.</p>
        )}
        {newestFirst.map((run) => {
          const live = run.state === 'working' || run.state === 'blocked' || run.state === 'unknown'
          const tone = run.state === 'blocked' || run.state === 'failed' ? 'failed' : live ? 'pending' : 'ready'
          return (
            <section key={run.id} className={`lc-cloudtask is-${tone}`} aria-label={run.name ?? run.prompt}>
              <div className="lc-cloudtask__prompt">{run.prompt}</div>
              <div className="lc-cloudtask__state">
                {live && <span className="lc-cloudtask__dot" aria-hidden="true" />}
                <span>{backgroundStateWords(run)}</span>
                {agoLabel(run.startedAt) !== undefined && <span className="lc-mono">· {agoLabel(run.startedAt)}</span>}
              </div>
              <div className="lc-cloudtask__actions">
                {live && (
                  <button type="button" className={run.state === 'blocked' ? 'lc-primarybutton' : 'lc-button'} onClick={() => onOpen(run.id)}>
                    {run.state === 'blocked' ? 'Open it to answer' : 'Open in a terminal'}
                  </button>
                )}
                {live && <button type="button" className="lc-button" onClick={() => onStop(run.id)}>Stop</button>}
                {!live && run.broughtIn !== undefined && (
                  <button type="button" className="lc-button" onClick={() => onShow(run.broughtIn!)}>Show in the conversation</button>
                )}
                {!live && <button type="button" className="lc-button" onClick={() => onDismiss(run.id)}>Remove from this list</button>}
              </div>
            </section>
          )
        })}
      </div>
    </aside>
  )
}
