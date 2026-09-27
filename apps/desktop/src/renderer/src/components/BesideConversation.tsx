import type { ComponentProps, ReactElement } from 'react'

import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import type { PublicPeerMessage, PublicRecoveredMission, PublicTeammate } from '../../../shared/ipc.js'
import type { LiveStarter, TurnSwitch } from '../missionView.js'
import { Icon } from './Icon.js'
import { TeammateBot } from './TeammateBot.js'
import { Thread } from './Thread.js'

/**
 * A SECOND CONVERSATION, BESIDE THE ONE YOU ARE IN (0.396).
 *
 * Orca's list, item 4: two agents side by side. Opened from a conversation's
 * right-click menu, "Open beside", into the panel a file opens in. It is
 * READ-ONLY by design -- the chat box stays with the conversation in the
 * middle, so a message never has to guess which one it is for -- and it is
 * LIVE: a run still going streams into it as it would in the middle. "Open
 * it here" swaps it into the middle when you want to answer it.
 */
interface BesideRun {
  readonly prompt: string
  readonly startedBy?: LiveStarter
  readonly earlierTurns?: ComponentProps<typeof Thread>['earlierTurns']
  readonly events: readonly NormalizedRuntimeEvent[]
  readonly phase: string
  readonly restored?: boolean
  readonly restoredMission?: PublicRecoveredMission
  readonly error?: string
  readonly errorIsPersistence?: boolean
  readonly handoff?: ComponentProps<typeof Thread>['handoff']
  readonly switchedFrom?: TurnSwitch
  readonly peerMessages?: readonly PublicPeerMessage[]
  /** When the person pressed send: the waiting line clocks a run from here before it says anything. */
  readonly startedAtIso?: string
  readonly data?: { readonly missionId: string; readonly sandbox?: ComponentProps<typeof Thread>['sandbox'] }
}

// The phases a run is still going in (App's LiveRunPhase): it streams while these hold.
const GOING = new Set(['starting', 'running', 'cancelling'])

export function BesideConversation({
  run,
  title,
  owner,
  teammates,
  workspacePath,
  onOpenHere,
  onClose
}: {
  readonly run: BesideRun
  readonly title: string
  readonly owner: PublicTeammate | undefined
  readonly teammates: readonly PublicTeammate[]
  readonly workspacePath: string | undefined
  readonly onOpenHere: () => void
  readonly onClose: () => void
}): ReactElement {
  const running = GOING.has(run.phase)
  return (
    <aside className="lc-viewer lc-beside" aria-label={`Beside: ${title}`}>
      <div className="lc-viewer__head">
        {owner !== undefined && <TeammateBot hue={owner.hue} avatar={owner.avatar} size={18} teammateId={owner.teammateId} activity={running ? 'working' : 'idle'} />}
        <span className="lc-beside__who">
          <span className="lc-viewer__name">{owner?.name ?? 'Conversation'}</span>
          <span className="lc-beside__title">{title}</span>
        </span>
        <span className="lc-viewer__spacer" />
        <button type="button" className="lc-viewer__action" aria-label="Open it here" title="Open it here, to answer it" onClick={onOpenHere}>
          <Icon name="maximize" size={13} />
        </button>
        <button type="button" className="lc-viewer__close" aria-label="Close" title="Close" onClick={onClose}>
          <Icon name="close" size={13} />
        </button>
      </div>
      <div className="lc-beside__thread">
        <Thread
          prompt={run.prompt}
          {...(run.startedBy === undefined ? {} : { startedBy: run.startedBy })}
          onOpenPeerRun={() => undefined}
          earlierTurns={run.earlierTurns ?? []}
          events={run.events}
          running={running}
          restoredMission={run.restored === true ? run.restoredMission : undefined}
          {...(run.data === undefined ? {} : { shownMissionId: run.data.missionId })}
          {...(run.data?.sandbox === undefined ? {} : { sandbox: run.data.sandbox })}
          workspacePath={workspacePath}
          error={run.error}
          errorIsPersistence={run.errorIsPersistence === true}
          startedAt={undefined}
          {...(run.startedAtIso === undefined ? {} : { startedAtIso: run.startedAtIso })}
          // Approvals and questions are answered in the middle, where the chat box is.
          approvals={[]}
          onDecide={() => undefined}
          onAnswerQuestion={() => undefined}
          decidingIds={[]}
          cancelled={run.phase === 'cancelled'}
          handoff={run.handoff}
          {...(run.switchedFrom === undefined ? {} : { switchedFrom: run.switchedFrom })}
          peers={{ self: owner, teammates, messages: run.peerMessages ?? [], notices: [] }}
        />
      </div>
    </aside>
  )
}
