import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'

import { seedAvatar } from '../../../shared/avatar.js'
import { parseAgentText, splitInlineCode } from '../agentText.js'
import { splitSettled } from '../settledText.js'
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
/** One run of prose, with inline code and link labels drawn. */
function inline(text: string): ReactElement {
  return (
    <>
      {splitInlineCode(text).map((span, index) => {
        if (span.kind === 'code') {
          return (
            <code className="lc-code--inline" key={`s${String(index)}`}>
              {span.text}
            </code>
          )
        }
        if (span.kind === 'link') {
          // Shown, not linked: a thread must not become a way to navigate the
          // app -- or the machine -- somewhere a model chose. The target
          // rides on the title so it is available without sitting in the
          // middle of the sentence. Deliberate, and kept after the 0.21.2 QA
          // pass asked for "actionable links": what it asked for is what a
          // prompt injection would ask for.
          return (
            <span className="lc-linklabel" key={`s${String(index)}`} title={span.href}>
              {span.text}
            </span>
          )
        }
        if (span.kind === 'strong') {
          return <strong key={`s${String(index)}`}>{span.text}</strong>
        }
        if (span.kind === 'em') {
          return <em key={`s${String(index)}`}>{span.text}</em>
        }
        return <span key={`s${String(index)}`}>{span.text}</span>
      })}
    </>
  )
}

export function AgentText({
  text,
  streaming
}: {
  readonly text: string
  readonly streaming: boolean
}): ReactElement {
  /*
   * While streaming, only what has SETTLED is parsed as Markdown.
   *
   * Re-parsing the whole reply on every delta meant a delta that completed
   * a token -- the closing `*`, the closing fence -- reclassified text a
   * person had already read: a plain sentence turned bold, a paragraph
   * became a code block. Text changing shape after it was read is the
   * "glitchy" in Colin's report (2026-09-10). Claude Code lands formatting
   * when a block closes; so does this. The tail is one plain paragraph at
   * most, which is exactly the part still being written. See settledText.ts.
   */
  const { settled, tail } = streaming ? splitSettled(text) : { settled: text, tail: '' }
  const blocks = parseAgentText(settled)
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
        if (block.kind === 'heading') {
          // One element per level so a screen reader gets the outline too;
          // the sizes are the thread's own, a step above the prose and
          // nowhere near the screen titles.
          const Tag = block.level === 1 ? 'h3' : block.level === 2 ? 'h4' : 'h5'
          return (
            <Tag className={`lc-heading lc-heading--${String(block.level)}`} key={`b${String(index)}`}>
              {inline(block.text)}
            </Tag>
          )
        }
        if (block.kind === 'list') {
          const items = block.items.map((item, itemIndex) => (
            <li key={`i${String(itemIndex)}`}>{inline(item)}</li>
          ))
          return block.ordered ? (
            <ol className="lc-list" key={`b${String(index)}`}>
              {items}
            </ol>
          ) : (
            <ul className="lc-list" key={`b${String(index)}`}>
              {items}
            </ul>
          )
        }
        // Line breaks inside a paragraph are kept (`lc-para` is pre-line):
        // asked for "every file, one per line", Composer answered
        // "README.md\nstatus.ts" and the thread drew "README.md status.ts",
        // which reads as the teammate ignoring the request. User session 3,
        // 2026-09-05, checked against the ledger.
        return (
          <p className="lc-para" key={`b${String(index)}`}>
            {inline(block.text)}
            {streaming && last && tail.length === 0 && <span className="lc-caret" />}
          </p>
        )
      })}
      {/* The part still being written, as plain text. It becomes Markdown the
          moment it settles, and nothing above it changes shape. */}
      {tail.trim().length > 0 && (
        <p className="lc-para lc-para--arriving">
          {tail.trimStart()}
          <span className="lc-caret" />
        </p>
      )}
      {/* A reply that has arrived with nothing in it yet still shows it is coming. */}
      {blocks.length === 0 && tail.trim().length === 0 && streaming && (
        <p>
          <span className="lc-caret" />
        </p>
      )}
    </>
  )
}

/**
 * A plan's steps, in either of the two jobs a plan does.
 *
 * One component with one question behind it -- **does this plan have step
 * outcomes** -- because markers versus ordinals, meta size versus reading
 * size, and header versus none all follow from that single answer. Two
 * components that looked alike is what let the same markup do the wrong job in
 * one of the two places (design, 2026-09-09).
 *
 * `outcomes: true` -- inside an activity fold. A run happened, the steps have
 * states, and the counter is a fact about it. Markers, meta size, and the
 * `PLAN · 2 of 5 done` header. Exactly as shipped; do not touch.
 *
 * `outcomes: false` -- a Plan-mode turn, which is the whole answer to the
 * question and has no fold to live in. It was a bordered card with a `PLAN`
 * label, a `0 of 5 done` counter and five identical dots, which read as a run
 * stalled at step one. All three of those were reporting on a run that by
 * contract never happened:
 *
 *   - A dot is a STATE, meaning "not done yet". Nothing was attempted and
 *     nothing will be, so five dots say something false five times. Ordinals
 *     say the true thing instead -- order, which is the entire content of a
 *     plan.
 *   - The counter counts outcomes there are none of.
 *   - The `PLAN` label only ever named which kind of box you were looking at,
 *     and there is no box. The teammate's own sentence above the list says
 *     what it is better than a five-letter caption.
 *
 * A real `<ol>`, so it is an ordered list to a screen reader as well as to the
 * eye. The ordinals are `user-select: none`, so copying the plan yields the
 * steps and not the numbering.
 */
export function PlanSteps({
  steps,
  doneCount,
  outcomes
}: {
  readonly steps: readonly PlanStep[]
  readonly doneCount: number
  /** Whether a run happened and these steps have states to report. */
  readonly outcomes: boolean
}): ReactElement | null {
  // A Plan-mode turn that produced no steps is not a plan -- it is the
  // silent-turn case, which already has its own diagnostic. An empty list with
  // a header would be this component inventing a plan nobody made.
  if (steps.length === 0) return null
  if (!outcomes) {
    return (
      <ol className={`lc-plan is-answer${steps.length > 9 ? ' is-wide' : ''}`}>
        {steps.map((step, index) => (
          <li key={`${String(index)}-${step.text}`} className="lc-plan__step">
            <span className="lc-plan__ordinal lc-mono" aria-hidden="true">
              {index + 1}
            </span>
            <span>{step.text}</span>
          </li>
        ))}
      </ol>
    )
  }
  return (
    <>
      <div className="lc-rail__meta lc-mono">
        PLAN · {doneCount} of {steps.length} done
      </div>
      <ul className="lc-plan">
        {steps.map((step, index) => (
          <li key={`${String(index)}-${step.text}`} className={`lc-plan__step is-${step.state}`}>
            <span className="lc-plan__marker" aria-hidden="true">
              {step.state === 'done' ? <Icon name="check" size={11} /> : <span className="lc-dot" />}
            </span>
            <span>{step.text}</span>
          </li>
        ))}
      </ul>
    </>
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

/** What a live line IS, in the words a person would use for it. */
const REGISTER_WORD: Record<LiveRegister, string> = {
  starting: 'starting',
  working: 'working',
  thinking: 'thinking',
  writing: 'writing',
  tool: 'using a tool',
  // Named as its own thing because it IS its own thing: a connector reaches
  // off this machine, which is the one fact the permission chip exists to
  // say. "Using a tool" for a call that can send mail would be a quiet lie.
  connector: 'using a connector'
}

export type LiveRegister = 'starting' | 'working' | 'thinking' | 'writing' | 'tool' | 'connector'

/**
 * The running step, as one avatar-led line. A tool or turn step is the
 * teammate doing something, so their face works; a reasoning step is thought,
 * so the face is still and three staggered dots carry the "still going". No
 * bar, no spinner, no synthetic percentage -- elapsed time from the event's
 * own timestamp (so a step already running when the view opened reports its
 * real age) and whatever the runtime actually said.
 *
 * IT SAYS WHOSE AND WHICH REGISTER, always.
 *
 * Colin, 2026-09-11: thinking, tool calls and connector calls all have to be
 * distinguishable from text the teammate actually wrote. The line used to be
 * whatever the runtime said -- "Exploring the repository" -- in the same
 * place, shape and colour as a sentence of the reply, with only a face and
 * three dots between them. Now the name and the register are the line, in the
 * standing register, and the runtime's own words sit beside the clock as the
 * detail they are. Same treatment as a room's live turn, for the same reason.
 */
export function LiveStepCard({
  label,
  detail,
  startedAt,
  kind,
  register,
  waiting = false,
  owner,
  activity
}: {
  readonly label: string
  readonly detail: string | undefined
  readonly startedAt: string
  readonly kind: 'turn' | 'reasoning' | 'item'
  /** Derived from the step, never from its wording. */
  readonly register: LiveRegister
  /** Waiting on the model with no step to name; draws the dots. */
  readonly waiting?: boolean
  readonly owner:
    | { readonly teammateId?: string; readonly name?: string; readonly hue: PixelFaceHueLike; readonly avatar: AvatarSpecLike }
    | undefined
  /** Decided once from the events, the same way the sidebar and header decide it. */
  readonly activity: FaceActivity
}): ReactElement {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const elapsed = elapsedLabel(startedAt, now)
  // The dots meant "a reasoning step is open", which most runtimes never
  // report -- so the nicest signal in the app almost never appeared (Colin,
  // 2026-09-04: "I feel like i never see the '...'"). They now mean the
  // honest thing: the teammate is waiting on the model and has nothing to
  // show yet. That covers the reasoning step AND the launch and the gaps
  // between steps, which is most of the time a person spends waiting.
  const thinking = activity === 'thinking' || waiting
  const face = owner ?? { hue: 'lime' as const, avatar: RUNTIME_FACE }
  const word = REGISTER_WORD[register]
  /*
   * The runtime's own words, when they ARE words and not the register said
   * twice. `label` is "Thinking" or "Working" whenever the runtime named no
   * step, and printing that beside "thinking" is the app stuttering.
   */
  const said = label.trim().toLowerCase() === word || /^(thinking|working|starting)$/i.test(label.trim())
    ? undefined
    : label.trim()
  const aside = [said, detail].filter((part) => part !== undefined && part.length > 0)
  return (
    <div className={`lc-livestep${thinking ? ' is-thinking' : ''}`} data-step-kind={kind} data-register={register}>
      <PixelFace
        hue={face.hue}
        avatar={face.avatar}
        size={26}
        activity={activity}
        {...(owner?.teammateId === undefined ? {} : { teammateId: owner.teammateId })}
      />
      <span className="lc-livestep__label">
        {owner?.name !== undefined && <span className="lc-livestep__who">{owner.name}</span>}
        <span className="lc-livestep__register lc-mono">
          {word}
          {thinking && (
            <span className="lc-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          )}
        </span>
      </span>
      {/* The clock sits beside the words, not at the far edge: "using a tool ·
          read_file · 57s" reads as one statement about what is happening. */}
      <span className="lc-rail__meta lc-livestep__meta">
        {aside.map((part) => `${String(part)} · `)}
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
