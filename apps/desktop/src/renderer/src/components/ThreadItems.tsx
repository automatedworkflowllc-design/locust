import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'

import { seedAvatar } from '../../../shared/avatar.js'
import { parseAgentText, splitInlineCode } from '../agentText.js'
import type { PlanStep } from '../missionView.js'
import { PixelFace } from './PixelFace.js'
import type { FaceActivity } from '../faceState.js'
import { Icon } from './Icon.js'

/** One fixed face for the runtime itself, when a mission belongs to nobody. */
const RUNTIME_FACE = seedAvatar('locust-runtime')

/**
 * The face beside a mission's turns: the teammate's own when the mission has
 * one, otherwise the runtime's fixed face -- a generated-looking avatar for an
 * unnamed agent would imply a teammate that does not exist. Thread faces are
 * always still: the header and the sidebar carry the working motion, and a
 * transcript of moving faces would be noise.
 */
export function AgentAvatar({
  size = 24,
  teammate
}: {
  readonly size?: number
  readonly teammate?: { readonly hue: PixelFaceHueLike; readonly avatar: AvatarSpecLike }
}): ReactElement {
  return teammate === undefined
    ? <PixelFace hue="lime" avatar={RUNTIME_FACE} size={size} />
    : <PixelFace hue={teammate.hue} avatar={teammate.avatar} size={size} />
}

type PixelFaceHueLike = Parameters<typeof PixelFace>[0]['hue']
type AvatarSpecLike = Parameters<typeof PixelFace>[0]['avatar']

/**
 * A model's reply, drawn the way it was written.
 *
 * Models answer in Markdown whether or not anyone asked, and this used to be
 * one flat paragraph -- worst exactly where it mattered most, because a
 * read-only run pastes its patch into the answer and a unified diff with
 * every newline collapsed is unreadable. Fenced blocks are code; a matched
 * pair of backticks is inline code; everything else is prose, unchanged.
 *
 * React escapes every value here, so nothing a model writes can become
 * markup. Wide code scrolls inside its own box rather than stretching the
 * thread.
 */
export function AgentText({
  text,
  streaming
}: {
  readonly text: string
  readonly streaming: boolean
}): ReactElement {
  const blocks = parseAgentText(text)
  return (
    <>
      {blocks.map((block, index) => {
        const last = index === blocks.length - 1
        if (block.kind === 'code') {
          return (
            <pre className="lc-code" key={`b${String(index)}`}>
              {block.language !== undefined && <span className="lc-code__lang lc-mono">{block.language}</span>}
              <code>{block.code}</code>
              {streaming && last && <span className="lc-caret" />}
            </pre>
          )
        }
        return (
          <p key={`b${String(index)}`}>
            {splitInlineCode(block.text).map((span, spanIndex) =>
              span.kind === 'code' ? (
                <code className="lc-code--inline" key={`s${String(spanIndex)}`}>
                  {span.text}
                </code>
              ) : (
                <span key={`s${String(spanIndex)}`}>{span.text}</span>
              )
            )}
            {streaming && last && <span className="lc-caret" />}
          </p>
        )
      })}
      {/* A reply that has arrived with nothing in it yet still shows it is coming. */}
      {blocks.length === 0 && streaming && (
        <p>
          <span className="lc-caret" />
        </p>
      )}
    </>
  )
}

export function PlanCard({
  steps,
  doneCount
}: {
  readonly steps: readonly PlanStep[]
  readonly doneCount: number
}): ReactElement {
  return (
    <div className="lc-card">
      <div className="lc-card__head">
        <span className="lc-mono lc-rail__meta">PLAN</span>
        <span className="lc-rail__meta">
          {doneCount} of {steps.length} done
        </span>
      </div>
      <ul className="lc-plan">
        {steps.map((step, index) => (
          <li key={`${index}-${step.text}`} className={`lc-plan__step is-${step.state}`}>
            <span className="lc-plan__marker" aria-hidden="true">
              {step.state === 'done' ? <Icon name="check" size={11} /> : <span className="lc-dot" />}
            </span>
            <span>{step.text}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function elapsedLabel(startedAt: string, now: number): string {
  const started = Date.parse(startedAt)
  if (!Number.isFinite(started)) return ''
  const seconds = Math.max(0, Math.round((now - started) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${seconds % 60}s`
}

/**
 * The running step, as one avatar-led line. A tool or turn step is the
 * teammate doing something, so their face works; a reasoning step is thought,
 * so the face is still and three staggered dots carry the "still going". No
 * bar, no spinner, no synthetic percentage -- elapsed time from the event's
 * own timestamp (so a step already running when the view opened reports its
 * real age) and whatever the runtime actually said.
 */
export function LiveStepCard({
  label,
  detail,
  startedAt,
  kind,
  owner,
  activity
}: {
  readonly label: string
  readonly detail: string | undefined
  readonly startedAt: string
  readonly kind: 'turn' | 'reasoning' | 'item'
  readonly owner: { readonly teammateId?: string; readonly hue: PixelFaceHueLike; readonly avatar: AvatarSpecLike } | undefined
  /** Decided once from the events, the same way the sidebar and header decide it. */
  readonly activity: FaceActivity
}): ReactElement {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const elapsed = elapsedLabel(startedAt, now)
  const thinking = activity === 'thinking'
  const face = owner ?? { hue: 'lime' as const, avatar: RUNTIME_FACE }
  return (
    <div className={`lc-livestep${thinking ? ' is-thinking' : ''}`} data-step-kind={kind}>
      <PixelFace
        hue={face.hue}
        avatar={face.avatar}
        size={26}
        activity={activity}
        {...(owner?.teammateId === undefined ? {} : { teammateId: owner.teammateId })}
      />
      <span className="lc-livestep__label">
        {label}
        {thinking && (
          <span className="lc-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        )}
      </span>
      {/* The clock sits beside the word, not at the far edge: "Working · 57s"
          reads as one statement about what is happening right now. */}
      <span className="lc-rail__meta lc-livestep__meta">
        {detail !== undefined && `${detail} · `}
        {elapsed}
      </span>
    </div>
  )
}

/**
 * A provider notice. Deliberately quiet: these are runtime housekeeping
 * messages, and the design's rule is that logs never dump into the thread. A
 * full-width red card for "skill descriptions were shortened" reads as a
 * failure and buries the actual work, so the thread gets one line and the
 * Signal Rail keeps the detail.
 */
export function DiagnosticLine({
  level,
  message
}: {
  readonly level: 'info' | 'warning' | 'error'
  readonly message: string
}): ReactElement {
  return (
    <div className={`lc-diagnostic lc-tone-${level === 'error' ? 'red' : level === 'warning' ? 'amber' : 'muted'}`}>
      <Icon name="shield" size={12} />
      <span>{message}</span>
    </div>
  )
}
