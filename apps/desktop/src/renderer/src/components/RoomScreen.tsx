import type { ReactElement } from 'react'
import { useState } from 'react'

import type { PublicRoom, PublicTeammate, RoomTaskRequest } from '../../../shared/ipc.js'
import { MAX_LIVE_MISSIONS } from '../../../shared/live-missions.js'
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

/**
 * What a post to this many teammates will really do, or undefined when the
 * cap does not bite.
 *
 * A post starts one mission per member and only MAX_LIVE_MISSIONS run at
 * once, so a bigger room has members who never start at all. Nothing said
 * that until 2026-09-09: a six-member room offered six, took six, started
 * four, and drew the other two as empty cards reading "did not start".
 *
 * A function rather than two inline strings because it is said twice -- once
 * in the form, where the number can still be changed, and once under the
 * composer for a room that already exists -- and because a sentence in JSX
 * driven by component state cannot be tested without a browser.
 */
export function overCapNote(members: number): string | undefined {
  if (members <= MAX_LIVE_MISSIONS) return undefined
  return `Only ${String(MAX_LIVE_MISSIONS)} missions run at once, so a post to ${String(members)} starts ${String(MAX_LIVE_MISSIONS)} and ${String(members - MAX_LIVE_MISSIONS)} will not start.`
}

/**
 * The people a post did not reach, as one line.
 *
 * A member with no mission used to get an ANSWER CARD with nothing in it --
 * an avatar, a name, `did not start` beside it, and then about 90px of void
 * where a route, a phase, an Open button and an answer belong. In a grid of
 * answers a card is a promise that an answer is inside it, so an empty one
 * reads as broken however it is coloured; and because a grid forces
 * equal-height cells, those two empty cards took their height from an
 * unrelated string in a neighbouring cell (the model name wrapping to two
 * lines) rather than from anything of their own.
 *
 * They share one fact, so they are one line.
 *
 * The reason is NOT in the record -- the refusal is a transient response, so
 * a reload has only the absence -- and this must not invent one. The cap is
 * named only when the cap can actually have been what bit: as many missions
 * started as are allowed to run.
 */
export function absentLine(absent: readonly { readonly name: string; readonly reason?: string }[]): string | undefined {
  if (absent.length === 0) return undefined
  const say = (names: readonly string[]): string =>
    names.length === 1
      ? String(names[0])
      : `${names.slice(0, -1).join(', ')} and ${String(names[names.length - 1] ?? '')}`
  const verb = (names: readonly string[]): string => (names.length === 1 ? 'was' : 'were')

  // Grouped by reason, so people turned away by the same thing are one
  // sentence rather than one each -- the mistake the composer note used to
  // make, repeated once per person in the smallest text on the screen.
  const byReason = new Map<string, string[]>()
  for (const entry of absent) byReason.set(entry.reason ?? '', [...(byReason.get(entry.reason ?? '') ?? []), entry.name])

  return [...byReason]
    .map(([reason, names]) =>
      reason === ''
        ? // No recorded reason: posts written before refusals were kept, and
          // anything the host declined to explain. Says less rather than
          // inventing why.
          `${say(names)} ${verb(names)} not asked.`
        : `${say(names)} ${verb(names)} not asked — ${reason.charAt(0).toLowerCase()}${reason.slice(1)}`
    )
    .join(' ')
}

/**
 * The host's refusals as one notice, said once per REASON.
 *
 * This was written inline as one sentence per refused teammate, joined with
 * a separator, so a room where the live cap turned two people away read:
 *
 *   Otto: Up to 4 missions can run at once. Wait for one to finish or stop
 *   it first. · Pike: Up to 4 missions can run at once. Wait for one to
 *   finish or stop it first.
 *
 * The same sentence twice, in the smallest text on the screen, 500px below
 * the cards it explains, and repeated once per person it happened to. It
 * also displaces `overCapNote()`, which shares that slot.
 *
 * Grouped by message, because the message is what they actually share. Two
 * people turned away by the cap are one fact with two names; two turned away
 * for different reasons stay two lines.
 */
/**
 * Whether a post's answers are laid out as a grid or as a list.
 *
 * A grid forces EQUAL-HEIGHT CELLS, and answers are of wildly unequal
 * length, so every row is as tall as its longest cell. It is paid in
 * whitespace and it worsens with width, because a wider row has more
 * chances to contain one long answer. It is visible even when every answer
 * is one word: on 2026-09-09 two cards took their height from
 * `opencode/muse-spark-1.3-contributor-free` wrapping to two mono lines in
 * the card beside them.
 *
 * Survivable at six, where a row is three cells and one glance. Past that a
 * grid scrolls, and it is then costing the only thing it was for -- seeing
 * the room at once -- while still paying the whitespace. A list gives every
 * answer one column width and its own height, which is what prose wants,
 * and puts the room in the same shape as the thread.
 *
 * Counted on RENDERED answers rather than room members, because rows are
 * what break. A room of eight where three were never asked draws five.
 */
export const ANSWERS_BEFORE_A_LIST = 6

export function refusalNotice(refused: readonly { readonly name: string; readonly message: string }[]): string | undefined {
  if (refused.length === 0) return undefined
  const byReason = new Map<string, string[]>()
  for (const entry of refused) byReason.set(entry.message, [...(byReason.get(entry.message) ?? []), entry.name])
  return [...byReason].map(([message, names]) => `${names.join(', ')}: ${message}`).join(' · ')
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
  onTask,
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
  /** A person moving the board. Resolves with the host's refusal, if any. */
  readonly onTask: (request: RoomTaskRequest) => Promise<string | undefined>
  /** The host's last word about a post or a room, when it had one. */
  readonly notice: string | undefined
}): ReactElement {
  const room = rooms.find((entry) => entry.roomId === currentRoomId)
  const [draftName, setDraftName] = useState('')
  const [draftMembers, setDraftMembers] = useState<readonly string[]>([])
  const [draftText, setDraftText] = useState('')
  const [draftTask, setDraftTask] = useState('')
  const [assigning, setAssigning] = useState<string>()
  const [boardError, setBoardError] = useState<string>()
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

  const move = async (request: RoomTaskRequest): Promise<void> => {
    setBoardError(undefined)
    setAssigning(undefined)
    const error = await onTask(request)
    if (error !== undefined) setBoardError(error)
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
                {/* Said HERE, while the room is being built, because this
                  * is the only screen where the number can still be changed. */}
                {overCapNote(draftMembers.length) !== undefined && (
                  <span className="lc-settings__note lc-tone-amber">{overCapNote(draftMembers.length)}</span>
                )}
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
        {/*
          * The board. A task is a line of text, an owner, a state, and the
          * mission that last touched it. Teammates move it with a block at
          * the end of a reply; this is where a person moves it by hand.
          */}
        <section className="lc-board" aria-label="Task board">
          <div className="lc-board__head">
            <span className="lc-sectionlabel">Tasks</span>
            <span className="lc-board__count lc-mono">
              {room.tasks.length === 0
                ? 'none yet'
                : `${String(room.tasks.filter((task) => task.state !== 'done').length)} open · ${String(room.tasks.filter((task) => task.state === 'done').length)} done`}
            </span>
          </div>
          {room.tasks.map((task) => {
            const owner = teammates.find((entry) => entry.teammateId === task.ownerId)
            return (
              <div key={task.taskId} className={`lc-task is-${task.state}`}>
                <span className={`lc-tag lc-task__state${task.state === 'done' ? ' is-green' : task.state === 'in-hand' ? ' is-amber' : ''}`}>
                  {task.state === 'in-hand' ? 'IN HAND' : task.state.toUpperCase()}
                </span>
                <span className="lc-task__text">{task.text}</span>
                <span className="lc-task__owner">
                  {owner === undefined ? (
                    <span className="lc-settings__note">nobody</span>
                  ) : (
                    <>
                      <PixelFace hue={owner.hue} avatar={owner.avatar} size={16} activity="idle" presence="none" />
                      {owner.name}
                    </>
                  )}
                </span>
                {task.missionId !== undefined && (
                  <button type="button" className="lc-ghostbutton" title="The conversation whose reply last moved this task" onClick={() => onOpenMission(task.missionId!)}>
                    Open
                  </button>
                )}
                <span className="lc-task__actions">
                  {assigning === task.taskId ? (
                    <span className="lc-task__assign" role="group" aria-label="Assign to">
                      {members.filter((entry) => entry !== undefined).map((entry) => (
                        <button key={entry!.teammateId} type="button" className="lc-button" onClick={() => void move({ roomId: room.roomId, op: 'assign', taskId: task.taskId, ownerId: entry!.teammateId })}>
                          {entry!.name}
                        </button>
                      ))}
                      <button type="button" className="lc-button" onClick={() => void move({ roomId: room.roomId, op: 'assign', taskId: task.taskId })}>
                        Nobody
                      </button>
                      <button type="button" className="lc-ghostbutton" onClick={() => setAssigning(undefined)}>
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <>
                      <button type="button" className="lc-ghostbutton" onClick={() => setAssigning(task.taskId)}>
                        Assign
                      </button>
                      {task.state === 'done' ? (
                        <button type="button" className="lc-ghostbutton" onClick={() => void move({ roomId: room.roomId, op: 'reopen', taskId: task.taskId })}>
                          Reopen
                        </button>
                      ) : (
                        <button type="button" className="lc-ghostbutton" onClick={() => void move({ roomId: room.roomId, op: 'done', taskId: task.taskId })}>
                          Done
                        </button>
                      )}
                      <button type="button" className="lc-ghostbutton" title="Take it off the board" onClick={() => void move({ roomId: room.roomId, op: 'remove', taskId: task.taskId })}>
                        Remove
                      </button>
                    </>
                  )}
                </span>
              </div>
            )
          })}
          <form
            className="lc-board__add"
            onSubmit={(event) => {
              event.preventDefault()
              if (draftTask.trim().length === 0) return
              void move({ roomId: room.roomId, op: 'add', text: draftTask }).then(() => setDraftTask(''))
            }}
          >
            <input
              className="lc-roomform__name"
              value={draftTask}
              onChange={(event) => setDraftTask(event.target.value)}
              placeholder="Add a task"
              aria-label="Add a task"
              maxLength={200}
            />
            <button type="submit" className="lc-button" disabled={draftTask.trim().length === 0}>
              Add
            </button>
            {boardError !== undefined && <span className="lc-settings__note lc-tone-red">{boardError}</span>}
          </form>
        </section>
        {room.posts.length === 0 && (
          <p className="lc-settings__note">Nothing posted yet. Whatever you write below goes to everyone in the room.</p>
        )}
        {room.posts.map((entry) => {
          const answers = answersFor(room, entry.postId)
          const absent = absentLine(
            room.teammateIds
              .filter((id) => answers.every((candidate) => candidate.teammateId !== id))
              .map((id) => ({
                name: teammates.find((candidate) => candidate.teammateId === id)?.name ?? id,
                ...(entry.refused?.[id] === undefined ? {} : { reason: entry.refused[id] })
              }))
          )
          return (
            <section key={entry.postId} className="lc-roompost">
              <div className="lc-roompost__you">
                <span className="lc-roompost__text">{entry.text}</span>
                <span className="lc-roompost__at lc-mono">
                  {new Date(entry.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <div className={`lc-roompost__answers${answers.length > ANSWERS_BEFORE_A_LIST ? ' is-list' : ''}`}>
                {room.teammateIds.map((teammateId) => {
                  const teammate = teammates.find((candidate) => candidate.teammateId === teammateId)
                  const answer = answers.find((candidate) => candidate.teammateId === teammateId)
                  const name = teammate?.name ?? teammateId
                  // No mission, no card. They are named together underneath.
                  if (answer === undefined) return null
                  return (
                    <div key={teammateId} className="lc-roomanswer">
                      <div className="lc-roomanswer__who">
                        {teammate !== undefined && (
                          <PixelFace
                            hue={teammate.hue}
                            avatar={teammate.avatar}
                            size={22}
                            activity={answer.phase === 'running' || answer.phase === 'starting' ? 'thinking' : 'idle'}
                            presence={answer.phase === 'running' || answer.phase === 'starting' ? 'working' : 'none'}
                          />
                        )}
                        <span className="lc-roomanswer__name">{name}</span>
                        <span className="lc-roomanswer__route lc-mono">
                          {runtimeNameOf(answer.runtime)} / {answer.model === 'account-default' ? 'default' : answer.model}
                        </span>
                        <span className={`lc-roomanswer__phase lc-mono${answer.phase === 'failed' ? ' lc-tone-red' : ''}`}>
                          {answer.phase}
                        </span>
                        <button type="button" className="lc-ghostbutton" onClick={() => onOpenMission(answer.missionId)}>
                          Open
                        </button>
                      </div>
                      {answer.text !== undefined && <p className="lc-roomanswer__text lc-para">{answer.text}</p>}
                      {answer.text === undefined && (answer.phase === 'running' || answer.phase === 'starting') && (
                        <p className="lc-roomanswer__text lc-settings__note">working…</p>
                      )}
                    </div>
                  )
                })}
              </div>
              {absent !== undefined && <p className="lc-roomabsent">{absent}</p>}
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
            {notice ??
              formError ??
              // The same truth at the moment of posting, for a room that
              // already exists -- or was made before any of this was said.
              (overCapNote(room.teammateIds.length) ??
                `Goes to ${String(room.teammateIds.length)} teammate${room.teammateIds.length === 1 ? '' : 's'}, each on their own route.`)}
          </span>
          <button type="submit" className="lc-button is-active" disabled={busy || draftText.trim().length === 0}>
            {busy ? 'Posting…' : 'Post'}
          </button>
        </div>
      </form>
    </div>
  )
}
