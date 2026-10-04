import type { ReactElement } from 'react'

import type { PublicRoom, PublicTeammate } from '../../../shared/ipc.js'
import { runtimeDisplayName } from '../../../shared/runtimes.js'
import { BOT_SIZE } from '../botSizes.js'
import { conversationBoard, conversationColumn } from '../conversationBoard.js'
import { conversationKeys } from '../conversationList.js'
import type { ConversationBoardFacts, ConversationBoardKey, ConversationCard } from '../conversationBoard.js'
import { isOwnRoute } from '../routeName.js'
import { agoLabel } from '../teammateWork.js'
import { Icon } from './Icon.js'
import { RuntimeMark } from './RuntimeMark.js'
import type { SidebarMission } from './Sidebar.js'
import { TeammateBot } from './TeammateBot.js'

/**
 * THE BOARD (0.585): every conversation, in columns by what it needs from
 * the person -- Needs you, Working, Ready to look at, Done -- over every
 * runtime at once. Devin Desktop's Command Center is the reference; Locust
 * can draw it across Claude Code, Codex, Cursor, OpenCode, Copilot and
 * Antigravity, which Devin cannot. The columns are decided in
 * `conversationBoard.ts`; this draws them with the team board's sections
 * (`.lc-boardsection`), so the two boards read the same.
 *
 * A card is the sidebar row with its face, its title and one line of state:
 * what it is waiting for, that it is working, when it finished. Pressing it
 * opens the conversation, which is also what takes a finish out of Ready to
 * look at. A quiet app -- nothing waiting, nothing working, nothing to look
 * at -- says so and lists what is done, rather than drawing one column.
 */
export function BoardScreen({
  missions,
  rooms,
  trashed,
  facts,
  waitingFor,
  teammates,
  missionOwners,
  onOpen,
  now
}: {
  readonly missions: readonly SidebarMission[]
  readonly rooms: readonly PublicRoom[]
  readonly trashed: ReadonlySet<string>
  readonly facts: ConversationBoardFacts
  /** What a conversation in Needs you is waiting for, in one line, by turn id. */
  readonly waitingFor: ReadonlyMap<string, string>
  readonly teammates: readonly PublicTeammate[]
  readonly missionOwners: Readonly<Record<string, string>>
  readonly onOpen: (missionId: string) => void
  readonly now?: Date
}): ReactElement {
  const board = conversationBoard(missions, rooms, trashed, facts)
  const ownerOf = (row: SidebarMission): PublicTeammate | undefined => {
    const id = row.ownerId ?? missionOwners[row.missionId] ?? (row.memberIds ?? []).map((member) => missionOwners[member]).find((owner) => owner !== undefined)
    return id === undefined ? undefined : teammates.find((teammate) => teammate.teammateId === id)
  }
  const titleOf = (card: ConversationCard): string | undefined => {
    const parent = card.parentId === undefined ? undefined : missions.find((row) => row.missionId === card.parentId)
    return parent === undefined ? undefined : `under ${parent.title}`
  }
  const stateOf = (card: ConversationCard, key: ConversationBoardKey): string => {
    const row = card.row
    const ago = row.lastAt === undefined ? undefined : agoLabel(row.lastAt, now)
    if (key === 'needs-you') {
      const what = (row.memberIds ?? [row.missionId]).map((id) => waitingFor.get(id)).find((line) => line !== undefined) ?? waitingFor.get(row.missionId)
      return what ?? 'waiting on you'
    }
    if (key === 'working') return 'working'
    const word = row.phase === 'completed' ? (key === 'to-look-at' ? 'finished' : 'done') : row.phase === 'failed' ? 'failed' : row.phase === 'running' ? 'working' : 'stopped'
    return ago === undefined ? word : `${word} · ${ago}`
  }
  const card = (entry: ConversationCard, key: ConversationBoardKey): ReactElement => {
    const row = entry.row
    const by = ownerOf(row)
    const under = titleOf(entry)
    return (
      <button type="button" key={row.missionId} className="lc-convcard" data-column={key} onClick={() => onOpen(row.missionId)} title={row.title}>
        {by === undefined ? (
          row.runtime === undefined || row.model === undefined || isOwnRoute(row.model) ? (
            <span className="lc-conv__nobody" aria-hidden="true" />
          ) : (
            <span className="lc-conv__runtime">
              <RuntimeMark runtime={row.runtime} size={13} label={runtimeDisplayName(row.runtime)} />
            </span>
          )
        ) : (
          <TeammateBot hue={by.hue} avatar={by.avatar} size={BOT_SIZE.conversationOwner} teammateId={by.teammateId} name={by.name} />
        )}
        <span className="lc-convcard__title">{row.title}</span>
        <span className="lc-convcard__meta lc-mono">
          {by !== undefined && <span className="lc-convcard__who">{by.name}</span>}
          {under !== undefined && <span className="lc-convcard__under">{under}</span>}
          <span className="lc-convcard__state">{stateOf(entry, key)}</span>
        </span>
      </button>
    )
  }
  const waiting = board?.find((section) => section.key === 'needs-you')?.members.length ?? 0
  const working = board?.find((section) => section.key === 'working')?.members.length ?? 0
  const meta = board === undefined
    ? 'all quiet'
    : [waiting > 0 ? `${String(waiting)} waiting on you` : undefined, working > 0 ? `${String(working)} working` : undefined].filter((part) => part !== undefined).join(' · ') || 'nothing running'
  const quiet = board === undefined
    ? missions.filter((row) => conversationColumn(row, facts) === 'done' && !conversationKeys(row).some((id) => trashed.has(id)))
    : []
  return (
    <section className="lc-screen lc-board" aria-label="Board">
      <div className="lc-screen__header">
        <span className="lc-screen__title">Board</span>
        <span className="lc-screen__meta lc-mono">{meta}</span>
      </div>
      <div className="lc-screen__scroll">
        {board === undefined ? (
          <>
            <p className="lc-screen__note">
              <Icon name="columns" size={12} /> Nothing is waiting on you and nothing is running. Conversations land here by what they need from you: a card to answer, work under way, a finish you have not looked at.
            </p>
            {quiet.length > 0 && (
              <section className="lc-boardsection lc-boardsection--done" data-column="done" aria-label="Done">
                <h2 className="lc-boardsection__title">
                  <span className="lc-boardsection__mark" aria-hidden="true" />
                  Done
                  <span className="lc-boardsection__count lc-mono">{quiet.length}</span>
                </h2>
                <div className="lc-convgrid">{quiet.slice(0, 12).map((row) => card({ row }, 'done'))}</div>
              </section>
            )}
          </>
        ) : (
          <div className="lc-teamboard lc-convboard">
            {board.map((section) => (
              <section key={section.key} className={`lc-boardsection lc-boardsection--${section.key}`} data-column={section.key} aria-label={section.title}>
                <h2 className="lc-boardsection__title">
                  <span className="lc-boardsection__mark" aria-hidden="true" />
                  {section.title}
                  <span className="lc-boardsection__count lc-mono">{section.members.length}</span>
                </h2>
                <div className="lc-convgrid">{section.members.map((entry) => card(entry, section.key))}</div>
              </section>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
