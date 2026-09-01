import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'

import type { PlanStep } from '../missionView.js'
import { FACE_PRESETS, PixelFace } from './PixelFace.js'
import { Icon } from './Icon.js'

/**
 * The agent's face beside its turns. Until teammates are real (P2) this is the
 * runtime's own identity rather than a person's, so it uses one fixed hue and
 * face -- a generated-looking avatar for an unnamed agent would imply a
 * teammate that does not exist.
 */
export function AgentAvatar({ size = 24 }: { readonly size?: number }): ReactElement {
  return <PixelFace hue="lime" pixels={FACE_PRESETS.wren!} size={size} />
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
 * The live step. Elapsed time ticks from the event's own timestamp rather than
 * from when this component mounted, so a step that was already running when the
 * view opened reports its real age instead of restarting at zero.
 */
export function LiveStepCard({
  label,
  detail,
  startedAt
}: {
  readonly label: string
  readonly detail: string | undefined
  readonly startedAt: string
}): ReactElement {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const elapsed = elapsedLabel(startedAt, now)
  return (
    <div className="lc-card is-live">
      <div className="lc-card__head">
        <span className="lc-livestep__label">
          <span className="lc-dot is-pulsing lc-tone-lime" /> {label}
        </span>
        <span className="lc-rail__meta">
          {detail !== undefined && `${detail} · `}
          {elapsed}
        </span>
      </div>
      <div className="lc-card__body">
        <div className="lc-progress">
          <span />
        </div>
      </div>
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
