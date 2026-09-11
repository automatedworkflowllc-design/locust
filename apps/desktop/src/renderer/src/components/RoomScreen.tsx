import type { ReactElement } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { PublicRoom, PublicTeammate, RoomTaskRequest } from '../../../shared/ipc.js'
import { MAX_ROOM_TEAMMATES } from '../../../shared/live-missions.js'
import { PixelFace } from './PixelFace.js'
import { footLine } from '../roomExchange.js'
import type { RoomExchange } from '../roomExchange.js'

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
  /** When the asking started: the first event, or the post for a run with none. */
  readonly startedAt: string | undefined
  /** The teammate's final words in that mission, when there are any yet. */
  readonly text: string | undefined
  readonly runtime: string
  readonly model: string
}

/**
 * What is wrong with a room this size, while it can still be changed.
 *
 * This used to warn that a room bigger than `MAX_LIVE_MISSIONS` would only
 * start that many -- true when the cap was 4 and the room limit 8. The cap
 * has since been measured and raised to 8, and the two are now held equal by
 * `room-and-mission-caps-agree`, so that sentence can never be true again
 * and has gone.
 *
 * What replaced it is the fact that IS true past eight and was said nowhere:
 * the store refuses the room. Ticking a ninth teammate was allowed, and
 * Create room then failed with "A room needs between 1 and 8 teammates." --
 * offered and then refused, in the one place the number can still change.
 *
 * The design agent's note about register applies here and resolves the other
 * way. Amber says a person has something to do, and their objection was that
 * the cap is a fact about the machine while ticking is allowed. This is not
 * that: the room cannot be made, and unticking is the reader's to do. The
 * register was wrong because the fact was wrong.
 */
export function roomFullNote(ticked: number): string | undefined {
  if (ticked <= MAX_ROOM_TEAMMATES) return undefined
  return `A room holds ${String(MAX_ROOM_TEAMMATES)} teammates. Untick ${String(ticked - MAX_ROOM_TEAMMATES)} to make this one.`
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
 * also displaced the room's own note, which shares that slot.
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

/**
 * Who is still waiting for a slot, as one recessed line.
 *
 * The design agent's answer to "queue, or don't", and the part of it that
 * makes the queue cheap: it needs ONE new state, not three.
 *
 * Waiting is the only real one -- nothing is happening, nothing is wrong,
 * nothing wants the reader -- so it is a roster line in the standing
 * register, not a card. No avatar, no box per person, no answer-shaped
 * container, because there is no answer and there is not going to be one
 * YET. A name leaves this line and becomes a card the moment its mission
 * starts, and that is the only transition the queue has to draw.
 *
 * "Next" is not a state, it is a position, and it changes with no action by
 * the reader -- drawing it would make the screen mutate to say which of two
 * identical waits is fractionally sooner. So the line is ordered and
 * position is left to be position.
 */
/**
 * An answer, folded when it is long.
 *
 * MEASURED, not counted. The first version split on newlines -- and the
 * design agent caught what my own fixture hid: a three-paragraph prose
 * answer has TWO newlines, so `3 <= 12` and it rendered whole, seventeen or
 * more rendered lines of it. The counting workload I tested with is one
 * number per line with 499 newlines, which folds perfectly. That is why it
 * looked right, and every real answer is the case that did not fold.
 *
 * So the clamp is on rendered line boxes and the control is drawn only when
 * the text actually overflows its clamp. The label loses its count with it:
 * "28 more lines" was a number I would otherwise defend, but it was only
 * ever knowable in the case that needed folding least.
 *
 * The elision stays a CONTROL rather than a sentence -- the shell output's
 * pattern, down to the class, because this app already ships that one.
 */
function RoomAnswerText({ text }: { readonly text: string }): ReactElement {
  const [open, setOpen] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const body = useRef<HTMLParagraphElement>(null)

  useLayoutEffect(() => {
    // Only while folded: once open the clamp is gone and scrollHeight equals
    // clientHeight, which would answer "no overflow" and retract the control
    // the reader just used.
    if (open) return
    const element = body.current
    if (element === null) return
    setOverflows(element.scrollHeight > element.clientHeight + 1)
  }, [text, open])

  return (
    <>
      <p ref={body} className={`lc-roomanswer__text lc-para${open ? '' : ' is-folded'}`}>
        {text}
      </p>
      {overflows && !open && (
        <button type="button" className="lc-shellout__more" onClick={() => setOpen(true)}>
          Show the rest
        </button>
      )}
    </>
  )
}

/**
 * How long a member has been quiet, past which it is worth saying so.
 *
 * From Astra's numbers rather than a guess: the solo write baseline is a 70s
 * process whose first record lands well inside twenty seconds, and the
 * eight-way case put 45s between a process starting and its notification. So
 * twenty is past normal and short of the observed bad case. Tune it once
 * launches have been visible for a while.
 */
export const QUIET_SECONDS_BEFORE_SAYING_SO = 20

/**
 * What a member is doing, and for how long.
 *
 * The design agent's three facts, and the naming is the point: it says
 * ASKED, not `starting`. "Starting" is the app's word for its own dispatch
 * loop; the reader's fact is that we asked and nothing has come back.
 *
 *   asked · 2s
 *   asked · 45s · no word back yet        (past 20s, amber)
 *   running · 52s                          (at the first event)
 *
 * The elapsed count is the whole argument, and it is the same one as
 * elapsed-seconds instead of a progress bar: two seconds of silence is
 * normal, forty-five is alarming, and the only thing separating them is a
 * number we already have. Without it both are the word "starting".
 *
 * Past twenty seconds it adds a SENTENCE rather than changing phase --
 * nothing has changed, the run is not failing, it is quiet, and those are
 * different claims. It never goes red on its own: a launch that never speaks
 * ends as a failure through the normal path, with the runtime's own reason.
 */
function AnswerState({ phase, startedAt }: { readonly phase: string; readonly startedAt: string | undefined }): ReactElement {
  const [now, setNow] = useState(() => Date.now())
  const live = phase === 'running' || phase === 'starting'
  useEffect(() => {
    if (!live) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [live])

  if (!live) return <span className="lc-roomanswer__phase lc-mono">{phase}</span>
  const began = startedAt === undefined ? undefined : Date.parse(startedAt)
  const seconds = began === undefined || Number.isNaN(began) ? undefined : Math.max(0, Math.round((now - began) / 1000))
  // `starting` means no event has arrived yet, which is the whole of "we
  // asked and nothing came back".
  const word = phase === 'starting' ? 'asked' : 'running'
  const quiet = word === 'asked' && seconds !== undefined && seconds >= QUIET_SECONDS_BEFORE_SAYING_SO
  return (
    <span className={`lc-roomanswer__phase lc-mono${quiet ? ' lc-tone-amber' : ''}`}>
      {word}
      {seconds !== undefined && ` · ${String(seconds)}s`}
      {quiet && ' · no word back yet'}
    </span>
  )
}

/**
 * One line about a post: what was asked, and what came of it.
 *
 * The design agent's rule, which is the trace line's rule: **count the
 * ordinary, name the exceptional.** A state one or two members are in gets
 * their names, because that is the fact you want; three or more goes back to
 * being a number, because four names is a list and a list is not a glance.
 *
 *   8 asked · all answered
 *   8 asked · 6 answered · Otto running · Sable failed
 *   8 asked · 5 answered · 3 failed
 *   6 asked · 2 answered · 4 running · 2 waiting for a slot
 *
 * A zero segment is absent rather than written as zero. And this is the
 * whole of "is anything wrong" -- a question asked ONCE, on arrival, which
 * needs a sentence that is true when you look rather than a view somebody
 * has to watch. Nobody watches a room while it runs; that was the argument
 * for the queue and it decides this too.
 */
export function postHeadline(
  members: readonly { readonly name: string; readonly state: 'answered' | 'running' | 'failed' | 'waiting' }[]
): string {
  const asked = members.filter((member) => member.state !== 'waiting').length
  const parts: string[] = [`${String(asked)} asked`]
  const of = (state: string): readonly string[] =>
    members.filter((member) => member.state === state).map((member) => member.name)

  const answered = of('answered')
  if (answered.length > 0 && answered.length === asked && asked > 0) parts.push('all answered')
  else if (answered.length > 0) parts.push(`${String(answered.length)} answered`)

  // Named at one or two, counted past that. `running` and `failed` are the
  // exceptions a person is looking for; `waiting` is always a count because
  // it is a queue position rather than something that happened.
  for (const [state, word] of [['running', 'running'], ['failed', 'failed']] as const) {
    const names = of(state)
    if (names.length === 0) continue
    parts.push(names.length <= 2 ? `${names.join(' and ')} ${word}` : `${String(names.length)} ${word}`)
  }
  const waiting = of('waiting')
  if (waiting.length > 0) parts.push(`${String(waiting.length)} waiting for a slot`)
  return parts.join(' · ')
}

export function waitingLine(names: readonly string[]): string | undefined {
  if (names.length === 0) return undefined
  return names.join(', ')
}

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
  exchangeFor,
  exchangeCostText,
  runtimeNameOf,
  onSelectRoom,
  onCreateRoom,
  onRemoveRoom,
  onRenameRoom,
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
  /**
   * The post as a CONVERSATION, when it became one.
   *
   * Undefined means nobody replied to anybody, and the grid of cards below is
   * the truth. Defined means the grid would be a lie -- it claims these
   * arrived in parallel and none is a reply to another -- so the post is
   * drawn as a sequence instead (design agent, 2026-09-11).
   */
  readonly exchangeFor?: (room: PublicRoom, postId: string) => RoomExchange | undefined
  /** What the exchange cost, in the runtime's own unit, already worded. */
  readonly exchangeCostText?: (room: PublicRoom, postId: string) => string | undefined
  readonly runtimeNameOf: (id: string) => string
  readonly onSelectRoom: (roomId: string | undefined) => void
  readonly onCreateRoom: (name: string, teammateIds: readonly string[]) => Promise<string | undefined>
  readonly onRemoveRoom: (roomId: string) => void
  /** Give the room a name. Absent where renaming is not offered. */
  readonly onRenameRoom?: (roomId: string, name: string) => void
  readonly onPost: (roomId: string, text: string) => Promise<string | undefined>
  readonly onOpenMission: (missionId: string) => void
  /** A person moving the board. Resolves with the host's refusal, if any. */
  readonly onTask: (request: RoomTaskRequest) => Promise<string | undefined>
  /** The host's last word about a post or a room, when it had one. */
  readonly notice: string | undefined
}): ReactElement {
  const room = rooms.find((entry) => entry.roomId === currentRoomId)
  const [draftName, setDraftName] = useState('')
  /** The title is an input while this is on. */
  const [renaming, setRenaming] = useState(false)
  const [draftMembers, setDraftMembers] = useState<readonly string[]>([])
  const [draftText, setDraftText] = useState('')
  const [draftTask, setDraftTask] = useState('')
  const [assigning, setAssigning] = useState<string>()
  const [boardError, setBoardError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string>()

  const members = room === undefined ? [] : room.teammateIds.map((id) => teammates.find((entry) => entry.teammateId === id))

  /**
   * Put one teammate's answer at the top of the room.
   *
   * The answer to "what did Booty actually say" was never a better preview
   * -- the fold and Open were already right. What was missing was a way to
   * GET to Booty among eight without scrolling and reading names.
   *
   * Arithmetic on `scrollTop` rather than `scrollIntoView`, which fights a
   * scroll container: it scrolls every ancestor that can scroll, so in a
   * pane inside a pane it moves the wrong one and the room jumps under the
   * reader.
   */
  const jumpTo = (postId: string, teammateId: string): void => {
    const card = document.querySelector(`[data-answer="${postId}:${teammateId}"]`)
    const scroller = card?.closest('.lc-screen__scroll')
    if (card === null || !(card instanceof HTMLElement) || !(scroller instanceof HTMLElement)) return
    // The sticky header sits over the top of the scroll area, so the card
    // has to clear it or it lands underneath the thing that sent you there.
    const header = scroller.querySelector('.lc-posthead')
    const clearance = header instanceof HTMLElement ? header.offsetHeight : 0
    scroller.scrollTo({ top: card.offsetTop - scroller.offsetTop - clearance, behavior: 'smooth' })
  }

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
                {roomFullNote(draftMembers.length) !== undefined && (
                  <span className="lc-settings__note lc-tone-amber">{roomFullNote(draftMembers.length)}</span>
                )}
                <div className="lc-roomform__actions">
                  <button
                    type="submit"
                    className="lc-button is-active"
                    // Not offered while it would be refused: the store turns
                    // a ninth teammate away, and finding that out by pressing
                    // the button is how it used to go.
                    disabled={
                      busy ||
                      draftName.trim().length === 0 ||
                      draftMembers.length === 0 ||
                      roomFullNote(draftMembers.length) !== undefined
                    }
                  >
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
        {/*
          * The name, which is also where it is changed.
          *
          * A room made from an ask starts as `Untitled room` on purpose --
          * charging a name before a room has a purpose is most of why nobody
          * made one (design agent, 2026-09-10) -- so the composer promises
          * "you can rename it there", and this is there. Click the title.
          */}
        {renaming ? (
          <input
            className="lc-input lc-room__rename"
            defaultValue={room.name}
            maxLength={60}
            aria-label="Room name"
            autoFocus
            onKeyDown={(event) => {
              if (event.key === 'Escape') setRenaming(false)
              if (event.key === 'Enter') {
                const next = event.currentTarget.value.trim()
                setRenaming(false)
                if (next.length > 0 && next !== room.name) onRenameRoom?.(room.roomId, next)
              }
            }}
            onBlur={(event) => {
              const next = event.currentTarget.value.trim()
              setRenaming(false)
              if (next.length > 0 && next !== room.name) onRenameRoom?.(room.roomId, next)
            }}
          />
        ) : (
          <button
            type="button"
            className="lc-screen__title lc-room__name"
            onClick={() => setRenaming(true)}
            title="Rename this room"
            disabled={onRenameRoom === undefined}
          >
            {room.name}
          </button>
        )}
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
          const exchange = exchangeFor?.(room, entry.postId)
          const waiting = waitingLine(
            (entry.queued ?? []).map((id) => teammates.find((candidate) => candidate.teammateId === id)?.name ?? id)
          )
          const absent = absentLine(
            room.teammateIds
              .filter((id) => answers.every((candidate) => candidate.teammateId !== id) && !(entry.queued ?? []).includes(id))
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
              {/*
                * One sticky line per post: the glance, and the way to one
                * answer. Chrome on the section, the same relationship the
                * workroom header has to its thread -- no card, no register,
                * and nothing in it that is not already in the records the
                * cards below are read from.
                */}
              <div className="lc-posthead">
                <span className="lc-posthead__counts lc-mono">
                  {postHeadline(
                    room.teammateIds.map((id) => {
                      const name = teammates.find((candidate) => candidate.teammateId === id)?.name ?? id
                      if ((entry.queued ?? []).includes(id)) return { name, state: 'waiting' as const }
                      const found = answers.find((candidate) => candidate.teammateId === id)
                      if (found === undefined) return { name, state: 'failed' as const }
                      if (found.phase === 'failed' || found.phase === 'cancelled') return { name, state: 'failed' as const }
                      if (found.text !== undefined) return { name, state: 'answered' as const }
                      return { name, state: 'running' as const }
                    })
                  )}
                </span>
                {/*
                  * The members as an index. The strip IS the roster, so a
                  * waiting member is here as a hollow pip rather than absent
                  * -- a name missing from it reads as someone not in the room.
                  */}
                <span className="lc-posthead__index" role="group" aria-label="Jump to an answer">
                  {room.teammateIds.map((id) => {
                    const teammate = teammates.find((candidate) => candidate.teammateId === id)
                    const found = answers.find((candidate) => candidate.teammateId === id)
                    const waiting = (entry.queued ?? []).includes(id)
                    const phase = waiting
                      ? 'waiting'
                      : found === undefined || found.phase === 'failed' || found.phase === 'cancelled'
                        ? 'failed'
                        : found.text !== undefined
                          ? 'answered'
                          : 'running'
                    return (
                      <button
                        key={id}
                        type="button"
                        className={`lc-posthead__face is-${phase}`}
                        title={`${teammate?.name ?? id} · ${phase}`}
                        aria-label={`${teammate?.name ?? id}, ${phase}`}
                        onClick={() => jumpTo(entry.postId, id)}
                      >
                        {teammate !== undefined && (
                          <PixelFace hue={teammate.hue} avatar={teammate.avatar} size={22} activity="idle" presence="none" />
                        )}
                        <span className="lc-posthead__pip" aria-hidden="true" />
                      </button>
                    )
                  })}
                </span>
              </div>
              {exchange !== undefined ? (
                /*
                  * A post that became an argument is a SEQUENCE, first answers
                  * included -- not a grid with the rest tucked somewhere.
                  *
                  * A grid is a claim: these arrived in parallel and none is a
                  * reply to another. False the instant message three answers
                  * message two, and the reader then has to merge two shapes in
                  * their head to recover one conversation. And not a fold: a
                  * fold means work summarised, this is what they SAID, and
                  * Said does not collapse (design agent, 2026-09-11).
                  */
                <div className="lc-roomsaid">
                  {exchange.items.map((item) => {
                    const who = teammates.find((candidate) => candidate.teammateId === item.teammateId)
                    const face =
                      who === undefined ? null : (
                        <PixelFace hue={who.hue} avatar={who.avatar} size={22} activity="idle" presence="none" />
                      )
                    if (item.kind === 'said') {
                      return (
                        <div
                          key={item.key}
                          className={`lc-roomsaid__turn${item.startsSpeaker ? '' : ' is-continued'}`}
                          data-said={`${entry.postId}:${item.missionId}`}
                        >
                          <span className="lc-roomsaid__gutter">{item.startsSpeaker ? face : null}</span>
                          <div className="lc-roomsaid__body">
                            {item.startsSpeaker && (
                              <span className="lc-roomsaid__who">
                                <span className="lc-roomsaid__name">{item.name}</span>
                                {/* The one case where a time is load-bearing:
                                    this arrived after a NEWER post exists, so
                                    without it the room looks like it inserted
                                    a message into the past. */}
                                {item.showTime && item.at !== undefined && (
                                  <span className="lc-roomsaid__at lc-mono">
                                    {new Date(item.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                )}
                              </span>
                            )}
                            <RoomAnswerText text={item.text} />
                          </div>
                        </div>
                      )
                    }
                    // Absence, drawn where it happened. Drop it and the reader
                    // watches the argument stop and blames the budget.
                    return (
                      <div key={item.key} className="lc-roomsaid__turn">
                        <span className="lc-roomsaid__gutter">{face}</span>
                        <p className="lc-roomsaid__absent">
                          {item.kind === 'silent'
                            ? `${item.name}\u2019s turn ended without a reply \u2014 the runtime finished and wrote nothing back. Nothing was changed.`
                            : `${item.name} is finishing another mission. Their reply is queued.`}
                        </p>
                      </div>
                    )
                  })}
                  {/* The budget, the cost and the ending, in one line, under
                      the thing they describe. Never amber: a rule working as
                      intended is not an alert. */}
                  <p className="lc-roomsaid__foot lc-mono">
                    {footLine(exchange.foot, exchangeCostText?.(room, entry.postId))}
                  </p>
                </div>
              ) : (
              <div className={`lc-roompost__answers${answers.length > ANSWERS_BEFORE_A_LIST ? ' is-list' : ''}`}>
                {room.teammateIds.map((teammateId) => {
                  const teammate = teammates.find((candidate) => candidate.teammateId === teammateId)
                  const answer = answers.find((candidate) => candidate.teammateId === teammateId)
                  const name = teammate?.name ?? teammateId
                  // No mission, no card. They are named together underneath.
                  if (answer === undefined) return null
                  return (
                    <div key={teammateId} className="lc-roomanswer" data-answer={`${entry.postId}:${teammateId}`}>
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
                        {answer.phase === 'failed' ? (
                          <span className="lc-roomanswer__phase lc-mono lc-tone-red">{answer.phase}</span>
                        ) : (
                          <AnswerState phase={answer.phase} startedAt={answer.startedAt} />
                        )}
                        <button type="button" className="lc-ghostbutton" onClick={() => onOpenMission(answer.missionId)}>
                          Open
                        </button>
                      </div>
                      {answer.text !== undefined && <RoomAnswerText text={answer.text} />}
                      {answer.text === undefined && (answer.phase === 'running' || answer.phase === 'starting') && (
                        <p className="lc-roomanswer__text lc-settings__note">working…</p>
                      )}
                    </div>
                  )
                })}
              </div>
              )}
              {waiting !== undefined && (
                <p className="lc-roomwaiting">
                  <span className="lc-roomwaiting__label lc-mono">Waiting for a slot</span>
                  <span className="lc-roomwaiting__names">{waiting}</span>
                  <span className="lc-roomwaiting__count lc-mono">{(entry.queued ?? []).length}</span>
                </p>
              )}
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
              `Goes to ${String(room.teammateIds.length)} teammate${room.teammateIds.length === 1 ? '' : 's'}, each on their own route.`}
          </span>
          <button type="submit" className="lc-button is-active" disabled={busy || draftText.trim().length === 0}>
            {busy ? 'Posting…' : 'Post'}
          </button>
        </div>
      </form>
    </div>
  )
}
