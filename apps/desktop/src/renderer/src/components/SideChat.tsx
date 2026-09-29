import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'

import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import { Icon } from './Icon.js'
import { Thread } from './Thread.js'

/**
 * ASK ON THE SIDE (0.461; Devin's side chats).
 *
 * A question about the conversation in the middle, answered from a COPY of
 * its session -- read-only, on the same model -- while the conversation keeps
 * working. Nothing asked here reaches it. Opened from the conversation's
 * `...` menu into the panel a file opens in, the way "Open beside" is.
 *
 * One thread: the questions asked so far and their answers, each follow-up on
 * a copy of the side chat before it, so the side chat remembers itself.
 */
export interface SideTurn {
  readonly key: string
  readonly prompt: string
  readonly events: readonly NormalizedRuntimeEvent[]
  readonly phase: string
  readonly missionId?: string
  readonly error?: string
  readonly startedAtIso?: string
}

const GOING = new Set(['starting', 'running', 'cancelling'])

export function SideChat({
  turns,
  model,
  workspacePath,
  onAsk,
  onClose
}: {
  readonly turns: readonly SideTurn[]
  /** What answers here: the conversation's own model, by name. */
  readonly model: string
  readonly workspacePath: string | undefined
  /** Ask; resolves to why it could not be asked, or nothing when it was. */
  readonly onAsk: (question: string) => Promise<string | undefined>
  readonly onClose: () => void
}): ReactElement {
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState<string>()
  const [asking, setAsking] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)
  useEffect(() => box.current?.focus(), [])
  const latest = turns.at(-1)
  const answering = latest !== undefined && GOING.has(latest.phase)
  const send = async (): Promise<void> => {
    const question = draft.trim()
    if (question.length === 0 || asking || answering) return
    setAsking(true)
    setProblem(undefined)
    const why = await onAsk(question).catch(() => 'The question could not be asked. The conversation is unchanged, and nothing was sent.')
    setAsking(false)
    if (why !== undefined) {
      setProblem(why)
      return
    }
    setDraft('')
  }
  return (
    <aside className="lc-viewer lc-beside lc-sidechat" aria-label="Ask on the side">
      <div className="lc-viewer__head">
        <span className="lc-beside__who">
          <span className="lc-viewer__name">On the side</span>
          <span className="lc-beside__title">{model} · a copy of this conversation</span>
        </span>
        <span className="lc-viewer__spacer" />
        <button type="button" className="lc-viewer__close" aria-label="Close" title="Close" onClick={onClose}>
          <Icon name="close" size={13} />
        </button>
      </div>
      <div className="lc-beside__thread">
        {latest === undefined ? (
          <p className="lc-sidechat__empty">
            Ask anything about this conversation: why it chose something, or what it has done so far. It keeps working while you ask.
            Nothing asked here reaches it, and nothing here changes a file.
          </p>
        ) : (
          <Thread
            prompt={latest.prompt}
            onOpenPeerRun={() => undefined}
            earlierTurns={turns.slice(0, -1).flatMap((turn) => (turn.missionId === undefined ? [] : [{ missionId: turn.missionId, prompt: turn.prompt, events: turn.events }]))}
            events={latest.events}
            running={answering}
            restoredMission={undefined}
            {...(latest.missionId === undefined ? {} : { shownMissionId: latest.missionId })}
            sandbox="read-only"
            workspacePath={workspacePath}
            error={latest.error}
            errorIsPersistence={false}
            startedAt={undefined}
            {...(latest.startedAtIso === undefined ? {} : { startedAtIso: latest.startedAtIso })}
            approvals={[]}
            onDecide={() => undefined}
            onAnswerQuestion={() => undefined}
            decidingIds={[]}
            cancelled={latest.phase === 'cancelled'}
            handoff={undefined}
            peers={{ self: undefined, teammates: [], messages: [], notices: [] }}
          />
        )}
      </div>
      <form
        className="lc-sidechat__ask"
        onSubmit={(event) => {
          event.preventDefault()
          void send()
        }}
      >
        {problem !== undefined && <p className="lc-sidechat__problem" role="alert">{problem}</p>}
        <textarea
          ref={box}
          className="lc-sidechat__box"
          rows={2}
          value={draft}
          placeholder={answering ? 'Answering...' : 'Ask about this conversation...'}
          aria-label="Ask about this conversation"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void send()
            }
          }}
        />
        <button type="submit" className="lc-send lc-sidechat__send" aria-label="Ask on the side" disabled={draft.trim().length === 0 || asking || answering}>
          <Icon name="arrow-up" size={14} />
        </button>
      </form>
    </aside>
  )
}
