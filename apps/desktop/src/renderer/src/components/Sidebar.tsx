import { useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'

import type { PublicRecoveredMission, PublicRoutine, PublicRuntimeStatus, PublicTeammate, PublicRoom } from '../../../shared/ipc.js'
import { roleLabelOf } from '../../../shared/ipc.js'
import type { LiveActivity } from '../faceState.js'
import { modelDisplayName, shortRuntimeName } from '../routeName.js'
import { runtimeDisplayName } from '../../../shared/runtimes.js'
import { branchNameFor } from '../../../shared/worktree-name.js'
import mark from '../assets/locust-mark.svg'
import wordmark from '../assets/locust-wordmark.svg'
import {
  connectedRuntimeCount,
  facePresenceFor,
  missionPhaseView,
  missionsMatching,
  runtimeIsUsable,
  shortMissionId,
  runtimeOfTeammate,
  teammateStatusView
} from '../status.js'
import { PixelFace } from './PixelFace.js'
import type { TeammateStatusView } from '../status.js'
import { Icon } from './Icon.js'
import { teammateTooltip } from '../teammateTooltip.js'
import { railCountBadge } from '../railFlyout.js'
import { RailFlyout } from './RailFlyout.js'
import { routineStepLabel } from '../routines.js'

/**
 * A teammate's sidebar line is "<role> · <state>". When the state is the
 * news ("subagent working"), the role is the part allowed to be cut short.
 */
export function labelRole(label: string): string {
  const at = label.lastIndexOf(' · ')
  return at === -1 ? '' : label.slice(0, at)
}

export function labelState(label: string): string {
  const at = label.lastIndexOf(' · ')
  return at === -1 ? label : ' · ' + label.slice(at + 3)
}


export interface SidebarMission {
  /**
   * Who the mission belongs to, when the shell knows before the host has
   * recorded it -- a run that is still starting has no missionId to look up.
   */
  readonly ownerId?: string
  readonly missionId: string
  readonly title: string
  readonly phase: PublicRecoveredMission['phase'] | 'running'
  /** Which runtime this mission is on, when it is known. */
  readonly runtime?: PublicRecoveredMission['runtime']
  readonly integrityIssueCount: number
  /**
   * The mission that began this conversation, and the turn immediately
   * before this one. A reply is its own mission -- one run, one receipt --
   * so without these the sidebar lists an exchange as several entries while
   * the thread beside it shows it as one.
   */
  readonly rootId?: string
  readonly parentId?: string
  /** Every turn this row stands for, so selecting any of them lights it. */
  readonly memberIds?: readonly string[]
  /** Turns in the conversation; 1 is an ordinary single-run mission. */
  readonly turns?: number
  /** When this conversation last moved, for the rail flyout's age column. */
  readonly lastAt?: string
}

/** Whether a row is the conversation the workroom is showing. */
function isShown(mission: SidebarMission, selectedMissionId: string | undefined): boolean {
  if (selectedMissionId === undefined) return false
  return (mission.memberIds ?? [mission.missionId]).includes(selectedMissionId)
}

/**
 * The workspace sidebar.
 *
 * There is no teammate list yet and none is drawn: teammates arrive in P2 as a
 * real local store. Showing the reference's four sample teammates here would
 * put fictional colleagues beside a live mission, which is the one thing the
 * design spec forbids -- so the region is simply absent until it is real.
 */
/**
 * A sidebar group that folds.
 *
 * Colin, 2026-09-06: *"make them all collapsible dropdowns to give the user
 * more space"*. The heading keeps the same label type it always had -- this
 * adds the chevron and the count, not a new look -- and it is a real button,
 * so the whole row is the target rather than a caret a person has to hit.
 *
 * An empty group still draws: *"if no automations dont remove, just have it
 * as a holder, we want the user to know its possible even if none are setup"*.
 * A count of zero is information; a missing section is not.
 */
function SidebarSection({
  label,
  count,
  open,
  onToggle,
  children
}: {
  readonly label: string
  readonly count: number
  readonly open: boolean
  readonly onToggle: () => void
  readonly children?: ReactNode
}): ReactElement {
  return (
    <>
      <button
        type="button"
        className={`lc-sectionlabel lc-sectionlabel--fold${open ? ' is-open' : ''}`}
        aria-expanded={open}
        onClick={onToggle}
      >
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={11} />
        <span>{label}</span>
        <span className="lc-sectionlabel__count">{String(count)}</span>
      </button>
      {open && children}
    </>
  )
}

export function Sidebar({
  runtimes,
  missions,
  teammates,
  viewByTeammate,
  routineStepByTeammate,
  missionOwners,
  selectedMissionId,
  selectedTeammateId,
  onSelectMission,
  onMissionMenu,
  onTeammateMenu,
  pendingApprovals,
  liveActivity,
  starting,
  recentlyDone,
  recentlyReceived,
  onSelectTeammate,
  onNewConversationWith,
  onNewTeammate,
  composerShown,
  onOpenSettings,
  onOpenMissions,
  onOpenTeammates,
  rooms,
  routines,
  currentRoomId,
  onOpenRoom,
  onOpenRooms,
  onOpenAutomations,
  onHome,
  compact = false
}: {
  readonly runtimes: readonly PublicRuntimeStatus[]
  readonly missions: readonly SidebarMission[]
  readonly teammates: readonly PublicTeammate[]
  /**
   * Every teammate's state, decided once in App. The sidebar draws it; it
   * does not work it out, because two surfaces working out one fact is how
   * they come to disagree.
   */
  readonly viewByTeammate: Readonly<Record<string, TeammateStatusView>>
  /** Which routine each teammate is replaying right now, if any. */
  readonly routineStepByTeammate: Readonly<Record<string, { readonly name: string; readonly step: number; readonly of: number }>>
  readonly missionOwners: Readonly<Record<string, string>>
  readonly selectedMissionId: string | undefined
  /** Who the composer is addressing. Selecting a teammate makes them the next mission's owner. */
  readonly selectedTeammateId: string | undefined
  readonly onSelectMission: (missionId: string) => void
  /** Right-click on a mission row, so it can be acted on without opening it. */
  readonly onMissionMenu: (missionId: string, at: { readonly x: number; readonly y: number }) => void
  /** Right-click on a teammate. Same menu shape as a mission row, on the row above them. */
  readonly onTeammateMenu: (teammateId: string, at: { readonly x: number; readonly y: number }) => void
  /** Approvals waiting on each teammate's live run, by teammate id. */
  readonly pendingApprovals: Readonly<Record<string, number>>
  /** What each teammate's live run is doing, by teammate id; absent means no live run. */
  readonly liveActivity: Readonly<Record<string, LiveActivity>>
  /** Teammates whose automatic reply the host is starting but has not started yet. */
  readonly starting: readonly string[]
  /** Teammates whose mission just finished, or who just received a message. */
  readonly recentlyDone: readonly string[]
  readonly recentlyReceived: readonly string[]
  readonly onSelectTeammate: (teammateId: string) => void
  /** A blank page with that teammate on it, not their newest conversation. */
  readonly onNewConversationWith: (teammateId: string) => void
  readonly onNewTeammate: () => void
  /** Whether the composer is on screen; the empty state says "below" only then. */
  readonly composerShown: boolean
  readonly onOpenSettings: () => void
  readonly onOpenMissions: () => void
  readonly onOpenTeammates: () => void
  /** Rooms a person can write to at once; the one open now is highlighted. */
  readonly rooms: readonly PublicRoom[]
  /** Saved routines, listed under Routines. */
  readonly routines: readonly PublicRoutine[]
  readonly currentRoomId: string | undefined
  readonly onOpenRoom: (roomId: string) => void
  readonly onOpenRooms: () => void
  readonly onOpenAutomations: () => void
  /** Back to the home screen: nothing picked, nothing open. */
  readonly onHome: () => void
  /**
   * The 64px avatar rail is on. The rail draws no conversation rows -- four
   * pixels of a title is not a smaller list -- so hovering an avatar opens
   * that teammate's conversations as a flyout beside it, and clicking pins it
   * (design agent, 2026-09-08). None of that exists in the full sidebar, where
   * the rows are already drawn.
   */
  readonly compact?: boolean
}): ReactElement {
  const [query, setQuery] = useState('')
  // The rail flyout: who it is open for, whether a click pinned it, and where
  // its trigger sits on screen. Hover opens after 120ms of intent and closes
  // a moment after the pointer leaves both the avatar and the panel; a pin
  // survives the pointer and is undone by Esc, a click outside, or clicking
  // the same avatar again.
  const [railHovered, setRailHovered] = useState<string | undefined>(undefined)
  const [railPinned, setRailPinned] = useState<string | undefined>(undefined)
  const [railAnchor, setRailAnchor] = useState<{ readonly top: number; readonly left: number } | undefined>(undefined)
  const railOpenTimer = useRef<number | undefined>(undefined)
  const railCloseTimer = useRef<number | undefined>(undefined)
  const railSlots = useRef(new Map<string, HTMLDivElement>())
  const measureRail = (teammateId: string): void => {
    // From the trigger's MEASURED rect, never a row-pitch constant: the mock's
    // first draft guessed a pitch and drifted 4px further out with every
    // teammate down the rail, pointing at the wrong face by the sixth.
    const slot = railSlots.current.get(teammateId)
    if (slot === undefined) return
    const box = slot.getBoundingClientRect()
    // Top from the slot, so the panel lines up with the face it belongs to.
    // Left from the RAIL's edge, not the slot's: the slot is inset by the row
    // margins, and anchoring on it put the panel one pixel inside the rail
    // instead of eight past it (measured by drive-compact, 2026-09-08).
    const rail = slot.closest('.lc-sidebar')?.getBoundingClientRect()
    setRailAnchor({ top: Math.max(8, box.top - 6), left: (rail?.right ?? box.right) + 8 })
  }
  const railEnter = (teammateId: string): void => {
    if (!compact) return
    window.clearTimeout(railCloseTimer.current)
    window.clearTimeout(railOpenTimer.current)
    railOpenTimer.current = window.setTimeout(() => {
      if (railPinned === undefined) {
        measureRail(teammateId)
        setRailHovered(teammateId)
      }
    }, 120)
  }
  const railLeave = (): void => {
    window.clearTimeout(railOpenTimer.current)
    if (railPinned !== undefined) return
    railCloseTimer.current = window.setTimeout(() => setRailHovered(undefined), 160)
  }
  const railPin = (teammateId: string): void => {
    if (!compact) return
    window.clearTimeout(railOpenTimer.current)
    window.clearTimeout(railCloseTimer.current)
    if (railPinned === teammateId) {
      setRailPinned(undefined)
      setRailHovered(undefined)
      return
    }
    measureRail(teammateId)
    setRailPinned(teammateId)
    setRailHovered(teammateId)
  }
  const railClose = (): void => {
    window.clearTimeout(railOpenTimer.current)
    window.clearTimeout(railCloseTimer.current)
    setRailPinned(undefined)
    setRailHovered(undefined)
  }
  const railOpenFor = compact ? (railPinned ?? railHovered) : undefined
  // Which groups are open. All three start open, which is how the sidebar
  // has always read; folding is for making room, not a new default.
  const [openSections, setOpenSections] = useState({ rooms: true, teammates: true, missions: true, automations: true })
  const connected = connectedRuntimeCount(runtimes)
  const unowned = missions.filter((mission) => (mission.ownerId ?? missionOwners[mission.missionId]) === undefined)
  const shownUnowned = missionsMatching(unowned, query)
  return (
    <nav className="lc-sidebar" aria-label="Workspace">
      <div className="lc-sidebar__brand">
        {/* The logo is the way back to the home screen (Colin, 2026-09-05). */}
        <button type="button" className="lc-brand__lockup" onClick={onHome} title="Home" aria-label="Home">
          <img className="lc-brand__mark" src={mark} alt="" aria-hidden="true" />
          <img className="lc-brand__wordmark" src={wordmark} alt="Locust" />
        </button>
        <button
          type="button"
          className="lc-iconbutton"
          aria-label="New teammate"
          title="New teammate"
          onClick={onNewTeammate}
        >
          <Icon name="plus" size={14} />
        </button>
      </div>

      <div className="lc-search">
        <Icon name="search" size={13} />
        <input
          type="text"
          /*
           * CONVERSATIONS, because that is what this list holds.
           *
           * Astra's acceptance pass, 2026-09-14, finding 2: typing here left
           * the screen titled Missions showing all twelve, while the sidebar
           * said "No missions match that". Two surfaces, one word, one of
           * them not responding -- and the reasonable conclusion from the
           * page you are looking at is that search is broken.
           *
           * The sidebar collapses missions into conversations; the Missions
           * screen lists missions. Naming each for what it holds is the
           * smaller and truer fix, and the different noun is itself the
           * signal that the scopes differ. Sharing one query between them is
           * a product decision, not a wording repair.
           */
          placeholder="Search conversations"
          aria-label="Search conversations"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
        />
      </div>

      <div className="lc-sidebar__scroll">
        {/*
          * Rooms sit above the roster: a room is where several teammates
          * are written to at once, so it reads before any one of them. Only
          * DRAWN EVEN WITH NO ROOMS, which is the opposite of what this
          * comment used to say. It said the way in is the Rooms screen, "one
          * palette entry or Ctrl 4 away, so an empty section has nothing to
          * say here" -- and that is exactly backwards. An empty section's
          * whole job is to say the feature exists.
          *
          * The result was a feature nobody could reach without already having
          * used it: rooms appeared in the sidebar only once you had made one,
          * and the only ways to make a first one were a keyboard shortcut and
          * a palette entry. Colin, who owns the app and had watched a day of
          * work go into rooms, 2026-09-09: "sorry if this is dumb but how
          * does one create a room for teammates, i cant figure it out lol."
          * Not dumb -- there was nothing on screen to find.
          */}
        {/*
          * The same section as its neighbours: a fold and a count. It was a
          * bare label over the rows, so TEAMMATES 3 and ROUTINES 0 folded and
          * counted while ROOMS did neither (design agent, 2026-09-10).
          * Always drawn and foldable are not in tension -- the section is
          * always THERE; whether it is open is the person's.
          */}
        <SidebarSection
          label="Rooms"
          count={rooms.length}
          open={openSections.rooms}
          onToggle={() => setOpenSections((current) => ({ ...current, rooms: !current.rooms }))}
        >
          <>
            {rooms.map((room) => (
              <button
                key={room.roomId}
                type="button"
                className={`lc-row lc-row--button lc-roomrow${currentRoomId === room.roomId ? ' is-selected' : ''}`}
                aria-current={currentRoomId === room.roomId ? 'true' : undefined}
                title={`Open ${room.name}`}
                onClick={() => onOpenRoom(room.roomId)}
              >
                <Icon name="users" size={14} />
                <span className="lc-row__text">
                  <span className="lc-row__name">{room.name}</span>
                  <span className="lc-row__meta">
                    {String(room.teammateIds.length)} teammate{room.teammateIds.length === 1 ? '' : 's'}
                    {room.posts.length > 0 ? ` · ${String(room.posts.length)} post${room.posts.length === 1 ? '' : 's'}` : ''}
                  </span>
                </span>
              </button>
            ))}
            {/*
              * Two words, and the sentence on hover. It read "New room — ask
              * several teammates at once", which the rail ellipsised mid-word
              * -- on the one sentence carrying a feature nobody could find
              * (design agent, 2026-09-10). Since 0.62.0 a room is made from
              * the ask, so this row is the way BACK to rooms, not the way in,
              * and it no longer has to carry the whole explanation.
              */}
            <button type="button" className="lc-row lc-row--button lc-roomrow lc-roomrow--new" onClick={onOpenRooms} title="New room — ask several teammates at once, or tick two names in the message box">
              <Icon name="plus" size={12} />
              <span className="lc-row__text">
                <span className="lc-row__meta">New room</span>
              </span>
            </button>
          </>
        </SidebarSection>
        <SidebarSection
          label="Teammates"
          count={teammates.length}
          open={openSections.teammates}
          onToggle={() => setOpenSections((current) => ({ ...current, teammates: !current.teammates }))}
        >
        {teammates.map((teammate) => {
          const owned = missions.filter(
            (mission) => (mission.ownerId ?? missionOwners[mission.missionId]) === teammate.teammateId
          )
          // What this teammate's rows show while a search is running. Their
          // status still comes from ALL their work: a teammate does not stop
          // working because someone typed in a box.
          const shownOwned = missionsMatching(owned, query)
          // The runtime this teammate's own work is on, or is set to use.
          // Asking about Codex for everyone told a person their teammate
          // needed a sign-in while she was visibly working on Claude Code;
          // asking only their MISSIONS said "idle" for a teammate that had
          // never run and could not. See `runtimeOfTeammate`.
          /*
           * One answer per teammate, decided in App and handed down.
           *
           * This row used to call `teammateStatusView` itself with inputs
           * that had drifted from the ones the Team roster's map used -- so
           * the same teammate read "working" here and idle there, which Grok
           * caught on screen in 0.116.0. Nothing is computed here now.
           */
          const status = viewByTeammate[teammate.teammateId] ?? teammateStatusView({
            runtime: undefined,
            anyRuntimeUsable: runtimes.some(runtimeIsUsable),
            hasRunningMission: false,
            pendingApprovals: 0,
            roleLabel: roleLabelOf(teammate)
          })
          const selected = teammate.teammateId === selectedTeammateId
          return (
            <div
              key={teammate.teammateId}
              className={`lc-teammate lc-railslot${selected ? ' is-selected' : ''}`}
              ref={(node) => {
                if (node === null) railSlots.current.delete(teammate.teammateId)
                else railSlots.current.set(teammate.teammateId, node)
              }}
              onMouseEnter={() => railEnter(teammate.teammateId)}
              onMouseLeave={railLeave}
            >
              {/* The rail's one new mark: how many conversations sit behind
                  this face, drawn only past one. Hidden outside the rail. */}
              {railCountBadge(owned.length) !== undefined && (
                <span className="lc-railbadge" aria-hidden="true">{railCountBadge(owned.length)}</span>
              )}
              {/*
                * The hover says name, role AND model -- not just the name. In
                * the compact rail all three are drawn as text and the rail
                * hides text, so an avatar there was a coloured square with no
                * way to find out whose it was (Colin, 2026-09-07).
                */}
              <button
                type="button"
                className="lc-row lc-row--button"
                aria-current={selected ? 'true' : undefined}
                // No native title in the rail: the flyout says the same three
                // facts as real text, and a tooltip fading in over a panel is
                // two answers to one question. The full sidebar keeps it.
                {...(compact ? { 'aria-label': teammateTooltip(teammate) } : { title: teammateTooltip(teammate) })}
                aria-expanded={compact ? railOpenFor === teammate.teammateId : undefined}
                onClick={() => {
                  onSelectTeammate(teammate.teammateId)
                  railPin(teammate.teammateId)
                }}
                onContextMenu={(event) => {
                  event.preventDefault()
                  onTeammateMenu(teammate.teammateId, { x: event.clientX, y: event.clientY })
                }}
              >
                <PixelFace
                  hue={teammate.hue}
                  avatar={teammate.avatar}
                  size={30}
                  activity={status.activity}
                  presence={facePresenceFor(status.status)}
                  teammateId={teammate.teammateId}
                />
                <span className="lc-row__text">
                  <span className="lc-row__name">
                    {teammate.name}
                    {status.pulse && <span className={`lc-dot is-pulsing lc-tone-${status.tone} lc-namedot`} />}
                  </span>
                  {status.activity === 'delegating' ? (
                    // "subagent working" is the news; the role gives way to it
                    // when the line is short, instead of the other way round.
                    <span className="lc-row__meta is-delegating">
                      {/* One glyph app-wide for "there is another agent in this" -- the same one the helper row uses. */}
                      <span className="lc-teammate__delegating" aria-hidden="true">
                        <Icon name="users" size={11} />
                      </span>
                      {/* The role stays muted here too: it is identity and has no
                          state to borrow. This branch tinted the whole line while
                          the ordinary one had already been split (RULINGS 2026-09-10). */}
                      <span className="lc-row__metarole">{labelRole(status.label)}</span>
                      <span className={`lc-row__metastate lc-tone-${status.tone === 'muted' ? 'muted' : status.tone}`}>
                        {labelState(status.label)}
                      </span>
                    </span>
                  ) : (
                    /*
                     * The role in muted, the STATE in the tone -- never the
                     * whole line. "Finance Bro · thinking" was lime end to
                     * end, so the role was wearing the state's colour and a
                     * reader could not tell which word the lime was about
                     * (design agent, 2026-09-10). The delegating branch above
                     * already split it this way; the ordinary line now does
                     * too, through the same two helpers.
                     */
                    <span className="lc-row__meta">
                      <span className="lc-row__metarole">{labelRole(status.label)}</span>
                      <span className={`lc-row__metastate lc-tone-${status.tone === 'muted' ? 'muted' : status.tone}`}>
                        {labelState(status.label)}
                      </span>
                    </span>
                  )}
                  {/*
                    * Which step of which routine is running. Derived in the
                    * shell from the live runs, so it disappears when the work
                    * does rather than being cleared by hand.
                    */}
                  {teammate.route !== undefined && (
                    // Which model this teammate IS. People pit models against
                    // each other on purpose, and that only reads if each row
                    // says who is who without opening a thread. This line
                    // earns its place; the two below it were one line's worth
                    // of fact spread over two.
                    <span
                      className="lc-row__route lc-mono"
                      title={`${runtimeDisplayName(teammate.route.runtime)} / ${teammate.route.model}`}
                    >
                      {/*
                        * Spelled as a name, the same way the composer's chip
                        * spells it -- `Cursor / Grok 4.6`, not `Cursor Agent
                        * / cursor-grok-4.6-medium`, which says cursor twice
                        * and then spells a product in lowercase. The exact id
                        * is the tooltip.
                        */}
                      {shortRuntimeName(teammate.route.runtime)} / {modelDisplayName(teammate.route.runtime, teammate.route.model)}
                    </span>
                  )}
                  {/*
                    * ONE situational line, never two.
                    *
                    * The routine step and the worktree branch answer the same
                    * question -- where and how is this teammate working right
                    * now -- and the row was drawing both, so a teammate on its
                    * own branch replaying a routine stacked five lines in a
                    * 268px rail. Four teammates made it a wall of mono
                    * (design review, 2026-09-06).
                    *
                    * The routine step wins while one is running, because it is
                    * the thing that is changing; the branch is a standing
                    * fact and comes back when the routine finishes.
                    */}
                  {routineStepByTeammate[teammate.teammateId] !== undefined ? (
                    <span className="lc-row__route lc-mono" title={routineStepByTeammate[teammate.teammateId]!.name}>
                      {routineStepLabel(routineStepByTeammate[teammate.teammateId]!)}
                    </span>
                  ) : (
                    teammate.worktree === true && (
                      <span className="lc-row__route lc-mono" title="Works on its own branch, in its own worktree of the folder">
                        on {branchNameFor(teammate.name)}
                      </span>
                    )
                  )}
                </span>
              </button>
              {shownOwned.length > 0 && (
                <div className="lc-teammate__missions">
                  {shownOwned.map((mission) => (
                    <div className="lc-teammate__missionrow" key={mission.missionId}>
                    <button
                      type="button"
                      className={`lc-teammate__mission${isShown(mission, selectedMissionId) ? ' is-active' : ''}`}
                      onContextMenu={(event) => {
                        event.preventDefault()
                        onMissionMenu(mission.missionId, { x: event.clientX, y: event.clientY })
                      }}
                      onClick={() => onSelectMission(mission.missionId)}
                    >
                      <span
                        className={`lc-dot lc-tone-${missionPhaseView(mission.phase, mission.integrityIssueCount > 0).tone}`}
                      />
                      <span className="lc-teammate__title">{mission.title}</span>
                      {(mission.turns ?? 1) > 1 && (
                        <span className="lc-teammate__turns lc-mono">{mission.turns}</span>
                      )}
                    </button>
                    {/*
                      * The same menu the right-click opens, with something to
                      * press. `Save as routine` lives in there and had no
                      * visible way in at all: a tester concluded routines did
                      * not exist (2026-09-07). Shown on hover and whenever it
                      * has focus, so it is reachable by keyboard and does not
                      * add a permanent object to every row.
                      */}
                    <button
                      type="button"
                      className="lc-teammate__missionmenu"
                      aria-label={`Actions for ${mission.title}`}
                      title="Actions — including Save as routine"
                      onClick={(event) => {
                        event.stopPropagation()
                        const box = event.currentTarget.getBoundingClientRect()
                        onMissionMenu(mission.missionId, { x: box.right, y: box.bottom })
                      }}
                    >
                      <Icon name="dots" size={13} />
                    </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
          })}
        </SidebarSection>
        {railOpenFor !== undefined && railAnchor !== undefined && (() => {
          const open = teammates.find((entry) => entry.teammateId === railOpenFor)
          if (open === undefined) return null
          const theirs = missions.filter(
            (mission) => (mission.ownerId ?? missionOwners[mission.missionId]) === open.teammateId
          )
          const theirRuntime = runtimeOfTeammate(open, theirs)
          const status = teammateStatusView({
            runtime: theirRuntime === undefined ? undefined : runtimes.find((entry) => entry.id === theirRuntime),
            anyRuntimeUsable: runtimes.some(runtimeIsUsable),
            hasRunningMission:
              theirs.some((mission) => mission.phase === 'running') || starting.includes(open.teammateId),
            pendingApprovals: pendingApprovals[open.teammateId] ?? 0,
            roleLabel: roleLabelOf(open),
            ...(liveActivity[open.teammateId] === undefined ? {} : { liveActivity: liveActivity[open.teammateId] }),
            recentlyDone: recentlyDone.includes(open.teammateId),
            recentlyReceived: recentlyReceived.includes(open.teammateId)
          })
          return (
            <RailFlyout
              teammate={open}
              statusLabel={status.label}
              statusTone={status.tone === 'muted' ? 'muted' : status.tone}
              route={open.route === undefined ? undefined : `${shortRuntimeName(open.route.runtime)} / ${modelDisplayName(open.route.runtime, open.route.model)}`}
              missions={theirs}
              selectedMissionId={selectedMissionId}
              top={railAnchor.top}
              left={railAnchor.left}
              pinned={railPinned !== undefined}
              onSelectMission={(missionId) => {
                onSelectMission(missionId)
                railClose()
              }}
              onMissionMenu={onMissionMenu}
              onOpenMissions={() => {
                onOpenMissions()
                railClose()
              }}
              onNewConversation={() => {
                // Was `onSelectTeammate`, which selects a teammate who is
                // already selected and opens the conversation that is
                // already open -- so the control did nothing at all.
                onNewConversationWith(open.teammateId)
                railClose()
              }}
              onPointerEnter={() => window.clearTimeout(railCloseTimer.current)}
              onPointerLeave={railLeave}
              onClose={railClose}
            />
          )
        })()}

        {/*
          "Missions", not "Other missions". The old label drew a distinction
          that only makes sense from inside the code -- these are the ones no
          teammate owns -- and Colin read it the way anyone would: "just have
          it say missions lol, why other missions?"

          Drawn only when it holds something, which is the answer to his next
          question: are these two redundant? Not in content -- every
          conversation appears exactly once, under its teammate or here, and
          all of them stay on the sidebar either way. But once a person has
          teammates almost nothing is unowned, so this stood as a heading
          reading 0 for good. Automations keeps its empty holder because an
          empty Automations teaches what the app can do; an empty Missions
          teaches nothing.
        */}
        {shownUnowned.length > 0 && (
        <SidebarSection
          label="Missions"
          count={shownUnowned.length}
          open={openSections.missions}
          onToggle={() => setOpenSections((current) => ({ ...current, missions: !current.missions }))}
        >
          <>
            {shownUnowned.map((mission) => {
              const view = missionPhaseView(mission.phase, mission.integrityIssueCount > 0)
              return (
                <button
                  type="button"
                  key={mission.missionId}
                  className="lc-row lc-row--mission"
                  aria-current={isShown(mission, selectedMissionId)}
                  onClick={() => onSelectMission(mission.missionId)}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    onMissionMenu(mission.missionId, { x: event.clientX, y: event.clientY })
                  }}
                >
                  <span
                    className={`lc-dot lc-tone-${view.tone}${mission.phase === 'running' ? ' is-pulsing' : ''}`}
                  />
                  <span className="lc-row__text">
                    <span className="lc-row__name">{mission.title}</span>
                    <span className="lc-row__meta">
                      {view.label}
                      {(mission.turns ?? 1) > 1 && ` · ${String(mission.turns)} turns`} ·{' '}
                      <span className="lc-mono">{shortMissionId(mission.missionId)}</span>
                    </span>
                  </span>
                </button>
              )
            })}
          </>
        </SidebarSection>
        )}

        <SidebarSection
          label="Routines"
          count={routines.length}
          open={openSections.automations}
          onToggle={() => setOpenSections((current) => ({ ...current, automations: !current.automations }))}
        >
          {routines.length === 0 ? (
            /*
              * The empty row is a DOOR, not a status.
              *
              * It read "Nothing saved yet", which is a fact about the shelf
              * and tells nobody that pressing it goes anywhere -- the same
              * mistake the Rooms row made until 0.60.0. It now says what is
              * behind it, which is the screen that lists the finished
              * conversations you can save.
              *
              * Not "New routine": a routine cannot be made from nothing, so a
              * button promising a blank one would lie about what it is.
              */
            <button
              type="button"
              className="lc-row lc-row--button lc-roomrow lc-roomrow--new"
              onClick={onOpenAutomations}
              title="Save a finished conversation so a teammate can replay it"
            >
              <Icon name="clock" size={12} />
              <span className="lc-row__text">
                <span className="lc-row__meta">Save one from a finished conversation</span>
              </span>
            </button>
          ) : (
            routines.map((routine) => (
              <button
                key={routine.routineId}
                type="button"
                className="lc-row lc-row--button"
                title={`Open Routines · ${routine.name}`}
                onClick={onOpenAutomations}
              >
                <Icon name="clock" size={14} />
                <span className="lc-row__text">
                  <span className="lc-row__name">{routine.name}</span>
                  <span className="lc-row__meta">
                    {String(routine.steps.length)} step{routine.steps.length === 1 ? '' : 's'}
                    {routine.schedule === undefined ? '' : ' · scheduled'}
                  </span>
                </span>
              </button>
            ))
          )}
        </SidebarSection>

        {/*
          Only one empty state, and only when it is true: no missions at all.
          When every mission belongs to a teammate they are already listed
          above, so an "other missions" section with a note in it would be a
          heading for nothing.
        */}
        {/*
          A search that matches nothing says so. Without this the sidebar
          simply empties, which reads as "you have no missions" rather than
          "none of them match".
        */}
        {query.trim().length > 0 && missionsMatching(missions, query).length === 0 && (
          <p className="lc-sidebar__empty lc-row__meta">No conversations match that.</p>
        )}

        {/*
          The folding Missions section above carries its own one-liner, so
          this no longer draws a heading of its own -- with both, an empty
          sidebar showed "Missions" twice (seen in the settings drive,
          2026-09-06). What it still owns is the sentence that tells a first
          person what to do, which depends on the composer being on screen
          and on whether a teammate is picked.
        */}
        {missions.length === 0 && (
          <>
            <p className="lc-sidebar__empty lc-row__meta">
              {/*
                * "below" means the composer, which only the workroom has. On
                * Teammates and Settings this pointed at a box that was not on
                * the screen -- spotted while touring the screens, 2026-09-03.
                */}
              {!composerShown
                ? 'No missions yet. They are recorded here as they run.'
                : teammates.length === 0
                  ? 'No missions yet. Describe one below and it is recorded locally as it runs.'
                  : // A message with nobody picked belongs to nobody now (0.21.6), so this
                    // must not promise the first teammate will pick it up -- the composer
                    // right under it said "Write a message…" while this said Juno would
                    // take it (user session, 2026-09-05). With a teammate actually
                    // picked, the promise is true and it says their name.
                    (() => {
                      const picked = teammates.find((teammate) => teammate.teammateId === selectedTeammateId)
                      return picked === undefined
                        ? 'No missions yet. Pick a teammate, or write below and assign it to one later.'
                        : `No missions yet. Describe one below and ${picked.name} picks it up.`
                    })()}
            </p>
          </>
        )}
      </div>

      <div className="lc-sidebar__footer">
        {/*
          * An equal-thirds grid with min-width: 0. The row is a fixed 266px
          * and three labelled buttons laid out by content came to 371px of it
          * -- so the count was pushed off the edge entirely rather than
          * merely squeezed. Cells that share the width cannot overflow
          * whatever the labels ever say.
          */}
        <div className="lc-sidebar__nav">
          <button type="button" onClick={onOpenMissions} title="All missions (Ctrl 1)">
            <Icon name="inbox" size={14} />
            <span>Missions</span>
          </button>
          <button type="button" onClick={onOpenTeammates} title="Team (Ctrl 2)">
            <Icon name="users" size={14} />
            {/* "Team", not "Teammates": Colin's call, and the design agent's
              * original. The full name needed 63px of a cell and rendered as
              * "Teamma…"; the screen it opens is still titled Teammates, and
              * the tooltip says so. */}
            <span>Team</span>
          </button>
          <button type="button" onClick={onOpenSettings} title="Settings (Ctrl 3)">
            <Icon name="settings" size={14} />
            <span>Settings</span>
          </button>
        </div>
        <div className="lc-connected">
          <span className={`lc-connected__dot${connected === 0 ? ' is-none' : ''}`} />
          <span>
            {connected} runtime{connected === 1 ? '' : 's'} connected
          </span>
        </div>
      </div>
    </nav>
  )
}
