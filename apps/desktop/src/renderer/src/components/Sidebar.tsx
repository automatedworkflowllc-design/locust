import { useState } from 'react'
import type { ReactElement, ReactNode } from 'react'

import type { PublicRecoveredMission, PublicRoutine, PublicRuntimeStatus, PublicTeammate, PublicRoom } from '../../../shared/ipc.js'
import { roleLabelOf } from '../../../shared/ipc.js'
import type { LiveActivity } from '../faceState.js'
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
  teammateStatusView
} from '../status.js'
import { PixelFace } from './PixelFace.js'
import { Icon } from './Icon.js'
import { teammateTooltip } from '../teammateTooltip.js'
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
  routineStepByTeammate,
  missionOwners,
  selectedMissionId,
  selectedTeammateId,
  onSelectMission,
  onMissionMenu,
  onTeammateMenu,
  pendingApprovals,
  liveActivity,
  recentlyDone,
  recentlyReceived,
  onSelectTeammate,
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
  onHome
}: {
  readonly runtimes: readonly PublicRuntimeStatus[]
  readonly missions: readonly SidebarMission[]
  readonly teammates: readonly PublicTeammate[]
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
  /** Teammates whose mission just finished, or who just received a message. */
  readonly recentlyDone: readonly string[]
  readonly recentlyReceived: readonly string[]
  readonly onSelectTeammate: (teammateId: string) => void
  readonly onNewTeammate: () => void
  /** Whether the composer is on screen; the empty state says "below" only then. */
  readonly composerShown: boolean
  readonly onOpenSettings: () => void
  readonly onOpenMissions: () => void
  readonly onOpenTeammates: () => void
  /** Rooms a person can write to at once; the one open now is highlighted. */
  readonly rooms: readonly PublicRoom[]
  /** Saved routines, listed under Automations. */
  readonly routines: readonly PublicRoutine[]
  readonly currentRoomId: string | undefined
  readonly onOpenRoom: (roomId: string) => void
  readonly onOpenRooms: () => void
  readonly onOpenAutomations: () => void
  /** Back to the home screen: nothing picked, nothing open. */
  readonly onHome: () => void
}): ReactElement {
  const [query, setQuery] = useState('')
  // Which groups are open. All three start open, which is how the sidebar
  // has always read; folding is for making room, not a new default.
  const [openSections, setOpenSections] = useState({ teammates: true, missions: true, automations: true })
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
          placeholder="Search missions"
          aria-label="Search missions"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
        />
      </div>

      <div className="lc-sidebar__scroll">
        {/*
          * Rooms sit above the roster: a room is where several teammates
          * are written to at once, so it reads before any one of them. Only
          * drawn once a room exists -- the way in is the Rooms screen, one
          * palette entry or Ctrl 4 away, so an empty section has nothing to
          * say here.
          */}
        {rooms.length > 0 && (
          <>
            <div className="lc-sectionlabel">Rooms</div>
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
            <button type="button" className="lc-row lc-row--button lc-roomrow lc-roomrow--new" onClick={onOpenRooms} title="New room">
              <Icon name="plus" size={12} />
              <span className="lc-row__text"><span className="lc-row__meta">New room</span></span>
            </button>
          </>
        )}
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
          // The runtime this teammate's own work is on. Asking about Codex
          // for everyone told a person their teammate needed a sign-in while
          // she was visibly working on Claude Code.
          const theirRuntime = owned.find((mission) => mission.phase === 'running')?.runtime
            ?? owned.at(0)?.runtime
          const status = teammateStatusView({
            // A teammate with no work of their own is judged by nothing in
            // particular, so the roster says idle rather than borrowing some
            // other runtime's sign-in state.
            runtime: theirRuntime === undefined
              ? undefined
              : runtimes.find((entry) => entry.id === theirRuntime),
            anyRuntimeUsable: runtimes.some(runtimeIsUsable),
            hasRunningMission: owned.some((mission) => mission.phase === 'running'),
            pendingApprovals: pendingApprovals[teammate.teammateId] ?? 0,
            roleLabel: roleLabelOf(teammate),
            ...(liveActivity[teammate.teammateId] === undefined ? {} : { liveActivity: liveActivity[teammate.teammateId] }),
            recentlyDone: recentlyDone.includes(teammate.teammateId),
            recentlyReceived: recentlyReceived.includes(teammate.teammateId)
          })
          const selected = teammate.teammateId === selectedTeammateId
          return (
            <div key={teammate.teammateId} className={`lc-teammate${selected ? ' is-selected' : ''}`}>
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
                title={teammateTooltip(teammate)}
                onClick={() => onSelectTeammate(teammate.teammateId)}
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
                    <span className={`lc-row__meta is-delegating lc-tone-${status.tone === 'muted' ? 'muted' : status.tone}`}>
                      {/* One glyph app-wide for "there is another agent in this" -- the same one the helper row uses. */}
                      <span className="lc-teammate__delegating" aria-hidden="true">
                        <Icon name="users" size={11} />
                      </span>
                      <span className="lc-row__metarole">{labelRole(status.label)}</span>
                      <span className="lc-row__metastate">{labelState(status.label)}</span>
                    </span>
                  ) : (
                    <span className={`lc-row__meta lc-tone-${status.tone === 'muted' ? 'muted' : status.tone}`}>{status.label}</span>
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
                    <span className="lc-row__route lc-mono" title="The route this teammate last ran on; replies on their own run here">
                      {runtimeDisplayName(teammate.route.runtime)} / {teammate.route.model}
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
          label="Automations"
          count={routines.length}
          open={openSections.automations}
          onToggle={() => setOpenSections((current) => ({ ...current, automations: !current.automations }))}
        >
          {routines.length === 0 ? (
            <button
              type="button"
              className="lc-row lc-row--button lc-roomrow lc-roomrow--new"
              onClick={onOpenAutomations}
              title="What automations are"
            >
              <Icon name="clock" size={12} />
              <span className="lc-row__text">
                <span className="lc-row__meta">Nothing saved yet</span>
              </span>
            </button>
          ) : (
            routines.map((routine) => (
              <button
                key={routine.routineId}
                type="button"
                className="lc-row lc-row--button"
                title={`Open Automations · ${routine.name}`}
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
          <p className="lc-sidebar__empty lc-row__meta">No missions match that.</p>
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
