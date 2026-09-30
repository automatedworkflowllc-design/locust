import { useState } from 'react'
import type { ReactElement } from 'react'

import type { PublicCloudFolder, PublicCloudTask, PublicCloudWhere } from '../../../shared/ipc.js'
import { fileCounts, parseUnifiedDiff } from '../diff.js'
import { agoLabel } from '../teammateWork.js'
import { DiffView } from './DiffView.js'
import { Icon } from './Icon.js'

/**
 * CLOUD TASKS (0.503): what was handed to Codex Cloud from this folder, how
 * each is going, and its change -- shown, and brought home only on Apply.
 * Beside the conversation, as the side question and the review are: the
 * cloud's work is not a turn of this conversation, and it can outlast it.
 */
export function CloudTasks({
  tasks,
  where,
  notes,
  problem,
  applying,
  onShowChange,
  onApply,
  onOpen,
  onClose,
  folders,
  onOpenFolder,
  onChooseFolder
}: {
  readonly tasks: readonly PublicCloudTask[]
  readonly where: PublicCloudWhere | undefined
  /** What the cloud will not see, said when the newest task started. */
  readonly notes: readonly string[]
  readonly problem: string | undefined
  readonly applying: string | undefined
  readonly onShowChange: (taskId: string) => Promise<string | undefined>
  readonly onApply: (taskId: string) => void
  readonly onOpen: (url: string) => void
  readonly onClose: () => void
  /** The person's folders that ARE on GitHub, offered when this one is not (0.504). */
  /** Undefined while Locust is still asking which of them have a cloud environment. */
  readonly folders: readonly PublicCloudFolder[] | undefined
  readonly onOpenFolder: (id: string) => void
  readonly onChooseFolder: () => void
}): ReactElement {
  const known = folders ?? []
  const [open, setOpen] = useState<{ readonly taskId: string; readonly diff: string | undefined; readonly loading: boolean }>()
  const newestFirst = [...tasks].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
  const show = (taskId: string): void => {
    if (open?.taskId === taskId) {
      setOpen(undefined)
      return
    }
    setOpen({ taskId, diff: undefined, loading: true })
    void onShowChange(taskId).then((diff) => setOpen((current) => (current?.taskId === taskId ? { taskId, diff, loading: false } : current)))
  }
  return (
    <aside className="lc-viewer lc-beside lc-cloudtasks" aria-label="Cloud tasks">
      <div className="lc-viewer__head">
        <Icon name="cloud" size={14} />
        <span className="lc-beside__who">
          <span className="lc-viewer__name">Cloud tasks</span>
          <span className="lc-beside__title lc-mono">
            {where?.repo === undefined ? 'Codex Cloud' : `${where.repo}${where.branch === undefined ? '' : ` · ${where.branch}`}`}
          </span>
        </span>
        <span className="lc-viewer__spacer" />
        <button type="button" className="lc-viewer__close" aria-label="Close" title="Close" onClick={onClose}>
          <Icon name="close" size={13} />
        </button>
      </div>
      <div className="lc-beside__thread lc-cloudtasks__list">
        {problem !== undefined && <p className="lc-cloudtasks__problem" role="alert">{problem}</p>}
        {/*
          * NOT ON GITHUB, SAID WITH THE WAY ON (0.504). Colin, at the old
          * refusal: "i have no idea what folder the cloud is in". The folder
          * is named, what the cloud needs is said, and the person's folders
          * that are on GitHub are one click away.
          */}
        {where !== undefined && where.repo === undefined && (
          <div className="lc-cloudtasks__elsewhere">
            <p className="lc-cloudtasks__note">
              <strong>{where.folderName ?? 'This folder'}</strong> is not on GitHub. A cloud task runs on a copy of a GitHub
              repository in Codex Cloud, not on this computer, so it needs a folder that is on GitHub.
            </p>
            {folders === undefined ? (
              <p className="lc-cloudtasks__note">Checking your other folders…</p>
            ) : known.length > 0 ? (
              <>
                <p className="lc-cloudtasks__note">Your folders that are:</p>
                <ul className="lc-cloudtasks__folders">
                  {known.map((folder) => (
                    <li key={folder.id}>
                      <span className="lc-cloudtasks__foldername">{folder.name}</span>
                      <span className="lc-cloudtasks__repo lc-mono">{folder.environment === 'ready' ? folder.repo : `${folder.repo} · no cloud environment`}</span>
                      <button type="button" className="lc-button" onClick={() => onOpenFolder(folder.id)}>Open</button>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="lc-cloudtasks__note">None of the folders Locust knows is on GitHub yet. Push this project to GitHub, or open one that is.</p>
            )}
            <button type="button" className="lc-button" onClick={onChooseFolder}>
              <Icon name="folder" size={13} /> Choose a folder…
            </button>
          </div>
        )}
        {notes.map((note) => (
          <p key={note} className="lc-cloudtasks__note">{note}</p>
        ))}
        {/*
          * ON GITHUB, BUT NO CLOUD ENVIRONMENT (0.505). Colin's brief went
          * to Codex Cloud from his Locust folder and came back refused: the
          * repository was right, it had no environment. Said before a send,
          * with how to make one, and the folders that have one.
          */}
        {where?.repo !== undefined && where.environment === 'missing' && (
          <div className="lc-cloudtasks__elsewhere">
            <p className="lc-cloudtasks__note">
              <strong>{where.repo}</strong> has no Codex Cloud environment yet, so a task sent from here would be refused. Make
              one in the Codex app: Settings &gt; Legacy Codex Cloud, pick this repository, then Save and publish.
            </p>
            {folders === undefined && <p className="lc-cloudtasks__note">Checking your other folders for one that has an environment…</p>}
            {known.some((folder) => folder.environment === 'ready') && (
              <>
                <p className="lc-cloudtasks__note">Or use a folder that has one:</p>
                <ul className="lc-cloudtasks__folders">
                  {known.filter((folder) => folder.environment === 'ready').map((folder) => (
                    <li key={folder.id}>
                      <span className="lc-cloudtasks__foldername">{folder.name}</span>
                      <span className="lc-cloudtasks__repo lc-mono">{folder.repo}</span>
                      <button type="button" className="lc-button" onClick={() => onOpenFolder(folder.id)}>Open</button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <button type="button" className="lc-button" onClick={onChooseFolder}>
              <Icon name="folder" size={13} /> Choose a folder…
            </button>
          </div>
        )}
        {newestFirst.length === 0 && where?.repo !== undefined && where.environment !== 'missing' && (
          <p className="lc-cloudtasks__empty">
            Pick Cloud in the chat-type menu and describe a task. It runs in Codex Cloud on this repository, as GitHub has
            it; its change stays there until you apply it here.
          </p>
        )}
        {newestFirst.map((task) => {
          const state = task.status.state
          const counts = task.status.added === undefined ? undefined : `+${String(task.status.added)} −${String(task.status.removed ?? 0)} in ${String(task.status.files ?? 0)} ${task.status.files === 1 ? 'file' : 'files'}`
          const line = state === 'pending'
            ? `Working in the cloud · started ${agoLabel(task.createdAt) ?? 'just now'}`
            : state === 'ready'
              ? `Ready${counts === undefined ? '' : ` · ${counts}`}`
              : state === 'applied'
                ? `Applied to this folder${task.appliedAt === undefined ? '' : ` ${agoLabel(task.appliedAt) ?? ''}`}${counts === undefined ? '' : ` · ${counts}`}`
                : state === 'failed'
                  ? 'The cloud could not finish it. Open it in Codex to see why.'
                  : 'Codex has not said how it is going yet.'
          const showing = open?.taskId === task.taskId
          const files = showing && open?.diff !== undefined ? parseUnifiedDiff(open.diff) : []
          return (
            <section key={task.taskId} className={`lc-cloudtask is-${state}`} aria-label={task.status.title ?? task.prompt}>
              <div className="lc-cloudtask__prompt">{task.status.title ?? task.prompt}</div>
              <div className="lc-cloudtask__state">
                {state === 'pending' && <span className="lc-cloudtask__dot" aria-hidden="true" />}
                <span>{line}</span>
              </div>
              <div className="lc-cloudtask__actions">
                {(state === 'ready' || state === 'applied') && (
                  <button type="button" className="lc-button" aria-expanded={showing} onClick={() => show(task.taskId)}>
                    <Icon name="diff" size={13} /> {showing ? 'Hide the change' : 'Show the change'}
                  </button>
                )}
                {state === 'ready' && (
                  <button type="button" className="lc-primarybutton" disabled={applying !== undefined} onClick={() => onApply(task.taskId)} title="Its change comes into this folder, not committed, so you can look before you keep it">
                    {applying === task.taskId ? 'Applying…' : 'Apply to this folder'}
                  </button>
                )}
                <button type="button" className="lc-button" onClick={() => onOpen(task.url)} title="The task in Codex, in your browser">
                  Open in Codex
                </button>
              </div>
              {showing && (
                <div className="lc-review__files">
                  {open?.loading === true && <p className="lc-cloudtasks__note">Reading the change…</p>}
                  {open?.loading === false && open.diff === undefined && <p className="lc-cloudtasks__note">Codex did not return a change for it.</p>}
                  {files.map((file) => {
                    const fileCountsNow = fileCounts(file)
                    return (
                      <section key={`${task.taskId}:${file.path}`} aria-label={file.path}>
                        <div className="lc-review__path lc-mono">
                          <span className="lc-review__name">{file.path}</span>
                          {file.status !== 'MODIFIED' && <span className="lc-review__status">{file.status.toLowerCase()}</span>}
                          <span className="lc-diff__addmark">+{fileCountsNow.added}</span> <span className="lc-diff__delmark">−{fileCountsNow.removed}</span>
                        </div>
                        <DiffView file={file} truncated={false} reported={undefined} />
                      </section>
                    )
                  })}
                </div>
              )}
            </section>
          )
        })}
      </div>
    </aside>
  )
}
