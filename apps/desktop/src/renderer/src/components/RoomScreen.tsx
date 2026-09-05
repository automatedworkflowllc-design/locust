import type { ReactElement } from 'react'
import { useState } from 'react'

import type { PublicRoom, PublicTeammate } from '../../../shared/ipc.js'
import { PixelFace } from './PixelFace.js'

/**
 * A room: a named set of teammates and the thread of what a person said to
 * all of them, with each one's answer under each post.
 *
 * A surface over records the window already holds (vision #2, "a surface,
 * not a new engine"): a post starts one ordinary mission per teammate on
 * that teammate's own route, the room remembers which, and the answer card
 * under a post is read from that mission -- its phase and its last words.
 * Each card opens the mission it was read from, so nothing here is a
 * summary a person cannot check.
 */

export interface RoomAnswer {
  readonly teammateId: string
  readonly missionId: string
  /** What the record says: starting, running, completed, failed, cancelled, interrupted -- or unknown. */
  readonly phase: string
  /** The teammate's final words in that mission, when there are any yet. */
  readonly text: string | undefined
  readonly runtime: string
  readonly model: string
}

export function RoomScreen({
  rooms,
  teammates,
  currentRoomId,
  answersFor,
  runtimeNameOf,
  onSelectRoom,
  onCreateRoom,
  onRemoveRoom,
  onPost,
  onOpenMission,
  notice
}: {
  readonly rooms: readonly PublicRoom[]
  readonly teammates: readonly PublicTeammate[]
  readonly currentRoomId: string | undefined
  /** The answers under one post, read from the missions it started. */
  readonly answersFor: (room: PublicRoom, postId: string) => readonly RoomAnswer[]
  readonly runtimeNameOf: (id: string) => string
  readonly onSelectRoom: (roomId: string | undefined) => void
  readonly onCreateRoom: (name: string, teammateIds: readonly string[]) => Promise<string | undefined>
  readonly onRemoveRoom: (roomId: string) => void
  readonly onPost: (roomId: string, text: string) => Promise<string | undefined>
  readonly onOpenMission: (missionId: string) => void
  /** The host's last word about a post or a room, when it had one. */
  readonly notice: string | undefined
}): ReactElement {
  const room = rooms.find((entry) => entry.roomId === currentRoomId)
  const [draftName, setDraftName] = useState('')
  const [draftMembers, setDraftMembers] = useState<readonly string[]>([])
  const [draftText, setDraftText] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string>()

  const members = room === undefined ? [] : room.teammateIds.map((id) => teammates.find((entry) => entry.teammateId === id))

  const create = async (): Promise<void> => {
    setFormError(undefined)
    setBusy(true)
    const error = await onCreateRoom(draftName, draftMembers)
    setBusy(false)
    if (error !== undefined) {
      setFormError(error)
      return
    }
    setDraftName('')
    setDraftMembers([])
  }

  const post = async (): Promise<void> => {
    if (room === undefined || draftText.trim().length === 0) return
    setFormError(undefined)
    setBusy(true)
    const error = await onPost(room.roomId, draftText)
    setBusy(false)
    if (error !== undefined) {
      setFormError(error)
      return
    }
    setDraftText('')
  }

  if (room === undefined) {
    return (
      <div className="lc-screen">
        <div className="lc-screen__header">
          <span className="lc-screen__title">Rooms</span>
          <span className="lc-screen__meta lc-mono">
            {rooms.length === 0 ? 'none yet' : `${String(rooms.length)} room${rooms.length === 1 ? '' : 's'}`} · one post, every teammate answers
          </span>
        </div>
        <div className="lc-screen__scroll">
          {rooms.length > 0 && (
            <section className="lc-settings__section">
              <h2 className="lc-settings__heading">Your rooms</h2>
              <div className="lc-roomlist">
                {rooms.map((entry) => (
                  <button key={entry.roomId} type="button" className="lc-roomcard" onClick={() => onSelectRoom(entry.roomId)}>
                    <span className="lc-roomcard__name">{entry.name}</span>
                    <span className="lc-roomcard__meta lc-mono">
                      {String(entry.teammateIds.length)} teammate{entry.teammateIds.length === 1 ? '' : 's'} · {String(entry.posts.length)} post{entry.posts.length === 1 ? '' : 's'}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
          <section className="lc-settings__section">
            <h2 className="lc-settings__heading">New room</h2>
            <p className="lc-settings__lede">
              Name it and pick who is in it. A post goes to everyone in the room at once, each on their own
              runtime and model; their answers land here, and each one opens the conversation it came from.
            </p>
            {teammates.length === 0 ? (
              <p className="lc-settings__note">Make a teammate first; a room is a set of them.</p>
            ) : (
              <form
                className="lc-roomform"
                onSubmit={(event) => {
                  event.preventDefault()
                  void create()
                }}
              >
                <input
                  className="lc-roomform__name"
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  placeholder="Room name"
                  aria-label="Room name"
                  maxLength={60}
                />
                <div className="lc-roomform__members" role="group" aria-label="Teammates in the room">
                  {teammates.map((teammate) => {
                    const on = draftMembers.includes(teammate.teammateId)
                    return (
                      <button
                        key={teammate.teammateId}
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        className={`lc-button${on ? ' is-active' : ''}`}
                        onClick={() =>
                          setDraftMembers((current) =>
                            on ? current.filter((id) => id !== teammate.teammateId) : [...current, teammate.teammateId]
                          )
                        }
                      >
                        <PixelFace hue={teammate.hue} avatar={teammate.avatar} size={16} activity="idle" presence="none" />
                        {teammate.name}
                      </button>
                    )
                  })}
                </div>
                <div className="lc-roomform__actions">
                  <button type="submit" className="lc-button is-active" disabled={busy || draftName.trim().length === 0 || draftMembers.length === 0}>
                    Create room
                  </button>
                  {formError !== undefined && <span className="lc-settings__note lc-tone-red">{formError}</span>}
                </div>
              </form>
            )}
          </section>
        </div>
      </div>
    )
  }

  return (
    <div className="lc-screen lc-room">
      <div className="lc-screen__header">
        {/* A way back, pointing back: the only chevron in the icon set points
          * forward, and it read as "go deeper" on the way out. */}
        <button type="button" className="lc-ghostbutton" onClick={() => onSelectRoom(undefined)} title="All rooms">
          ← Rooms
        </button>
        <span className="lc-screen__title">{room.name}</span>
        <span className="lc-screen__meta lc-mono">
          {members.filter((entry) => entry !== undefined).map((entry) => entry!.name).join(' · ')}
        </span>
        <button type="button" className="lc-ghostbutton lc-room__remove" onClick={() => onRemoveRoom(room.roomId)} title="Remove this room. The conversations it started stay.">
          Remove room
        </button>
      </div>
      <div className="lc-screen__scroll lc-room__thread">
        {room.posts.length === 0 && (
          <p className="lc-settings__note">Nothing posted yet. Whatever you write below goes to everyone in the room.</p>
        )}
        {room.posts.map((entry) => {
          const answers = answersFor(room, entry.postId)
          return (
            <section key={entry.postId} className="lc-roompost">
              <div className="lc-roompost__you">
                <span className="lc-roompost__text">{entry.text}</span>
                <span className="lc-roompost__at lc-mono">
                  {new Date(entry.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <div className="lc-roompost__answers">
                {room.teammateIds.map((teammateId) => {
                  const teammate = teammates.find((candidate) => candidate.teammateId === teammateId)
                  const answer = answers.find((candidate) => candidate.teammateId === teammateId)
                  const name = teammate?.name ?? teammateId
                  return (
                    <div key={teammateId} className={`lc-roomanswer${answer === undefined ? ' is-absent' : ''}`}>
                      <div className="lc-roomanswer__who">
                        {teammate !== undefined && (
                          <PixelFace
                            hue={teammate.hue}
                            avatar={teammate.avatar}
                            size={22}
                            activity={answer?.phase === 'running' || answer?.phase === 'starting' ? 'thinking' : 'idle'}
                            presence={answer?.phase === 'running' || answer?.phase === 'starting' ? 'working' : 'none'}
                          />
                        )}
                        <span className="lc-roomanswer__name">{name}</span>
                        {answer !== undefined && (
                          <span className="lc-roomanswer__route lc-mono">
                            {runtimeNameOf(answer.runtime)} / {answer.model === 'account-default' ? 'default' : answer.model}
                          </span>
                        )}
                        <span className={`lc-roomanswer__phase lc-mono${answer?.phase === 'failed' ? ' lc-tone-red' : ''}`}>
                          {answer === undefined ? 'did not start' : answer.phase}
                        </span>
                        {answer !== undefined && (
                          <button type="button" className="lc-ghostbutton" onClick={() => onOpenMission(answer.missionId)}>
                            Open
                          </button>
                        )}
                      </div>
                      {answer?.text !== undefined && <p className="lc-roomanswer__text lc-para">{answer.text}</p>}
                      {answer !== undefined && answer.text === undefined && (answer.phase === 'running' || answer.phase === 'starting') && (
                        <p className="lc-roomanswer__text lc-settings__note">working…</p>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>
      <form
        className="lc-roomcompose"
        onSubmit={(event) => {
          event.preventDefault()
          void post()
        }}
      >
        <textarea
          className="lc-roomcompose__box"
          value={draftText}
          onChange={(event) => setDraftText(event.target.value)}
          placeholder={`Post to ${room.name}…`}
          aria-label={`Post to ${room.name}`}
          rows={2}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void post()
            }
          }}
        />
        <div className="lc-roomcompose__row">
          <span className="lc-settings__note">
            {notice ?? formError ?? `Goes to ${String(room.teammateIds.length)} teammate${room.teammateIds.length === 1 ? '' : 's'}, each on their own route.`}
          </span>
          <button type="submit" className="lc-button is-active" disabled={busy || draftText.trim().length === 0}>
            {busy ? 'Posting…' : 'Post'}
          </button>
        </div>
      </form>
    </div>
  )
}
