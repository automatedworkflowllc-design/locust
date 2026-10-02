import { Fragment, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { ORB_BOX, Orb } from './Orb.js'

import { seedAvatar } from '../../../shared/avatar.js'
import type { AvatarSpec } from '../../../shared/avatar.js'
import { parseAgentText, splitInlineCode } from '../agentText.js'
import type { ListItem } from '../agentText.js'
import { splitSettled } from '../settledText.js'
import { linkHost } from '../../../shared/outbound-links.js'
import type { OrbState, PlanStep } from '../missionView.js'
import { TeammateBot } from './TeammateBot.js'
import { MathTex } from './MathTex.js'
import type { FaceActivity } from '../faceState.js'
import { Icon } from './Icon.js'
import { ReplyPage } from './ReplyPage.js'
import { isWholePage } from '../../../shared/reply-page.js'

/**
 * A link in a reply, and what the host said if it would not open it.
 *
 * The click used to be `void window.desktop?.openLink(href)` -- the host
 * answers `{ok:false, message}` for every address it refuses, and the window
 * dropped it on the floor. Grok measured it on the second pass (2026-09-14,
 * finding 3): `file:`, `javascript:` and `ftp:` all came back with "Locust
 * does not open that address." and nothing whatsoever appeared on screen. A
 * refused link and a link that worked looked identical, which is the shape
 * this project keeps paying for -- a feature silently dead rather than wrong.
 *
 * The sentence belongs HERE rather than in some banner far from the press:
 * the person pressed one link among many and needs to know which one did not
 * open. It clears on the next press, because a stale refusal beside a link
 * that now works is the same lie in the other direction.
 */
function OutboundLink({
  href,
  text,
  host
}: {
  readonly href: string
  readonly text: string
  readonly host: string
}): ReactElement {
  const [refused, setRefused] = useState<string>()
  return (
    <>
      <button
        type="button"
        className="lc-link"
        title={href}
        onClick={() => {
          setRefused(undefined)
          const bridge = window.desktop
          if (bridge === undefined) return
          void bridge
            .openLink(href)
            .then((answer) => {
              setRefused(answer.ok ? undefined : answer.message)
            })
            // The host never answered. Say what is still true: the browser
            // did not open, and nothing here changed.
            .catch(() => setRefused('That link could not be opened. Nothing in the conversation changed.'))
        }}
      >
        {text}
        {/*
          * The host, beside the label, because the label is the MODEL's
          * words and the target is not. A citation reading "his essay"
          * that goes somewhere unrelated is the only real hazard in
          * making these clickable, and saying where it goes before the
          * person decides is the whole fix.
          */}
        <span className="lc-link__host"> ({host})</span>
      </button>
      {refused !== undefined && (
        <span className="lc-link__refusal" role="status">
          {refused}
        </span>
      )}
    </>
  )
}

/**
 * One fixed face for the runtime itself, when a mission belongs to nobody:
 * Locust's own bot, the Swarm -- the mark in flight.
 */
const RUNTIME_FACE: AvatarSpec = { ...seedAvatar('locust-runtime'), bot: { shape: 'swarm', face: 'eyes' } }

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
    ? <TeammateBot hue="lime" avatar={RUNTIME_FACE} size={size} />
    : <TeammateBot hue={teammate.hue} avatar={teammate.avatar} size={size} />
}

type PixelFaceHueLike = Parameters<typeof TeammateBot>[0]['hue']
type AvatarSpecLike = Parameters<typeof TeammateBot>[0]['avatar']

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
/**
 * The colour an inline code span names, when it is nothing but a hex colour.
 *
 * A design answer lists its palette as `#7a9e8e`, `#f6f3ee` -- and a column of
 * hex codes is a thing a designer has to imagine. A chip beside each, the way
 * design tools and GitHub draw them, shows it (first-impressions drive, 0.349).
 *
 * GitHub's rule: six hex digits, `#rrggbb`, and nothing else. The short forms
 * are left out on purpose -- `#123` is as likely an issue number as a colour,
 * and a chip beside an issue reference is a wrong statement. Only that
 * validated string ever reaches a style: nothing else a model writes does.
 */
export function hexColourOf(text: string): string | undefined {
  const trimmed = text.trim()
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed : undefined
}

/**
 * The inside of a bold or italic run: plain text as it always was, and only
 * a run that holds code, a link or a colour drawn through `inline`.
 */
function nested(text: string): ReactElement | string {
  const spans = splitInlineCode(text)
  return spans.length === 1 && spans[0]?.kind === 'plain' && hexColourOf(text) === undefined ? text : inline(text)
}

/** One run of prose, with inline code and link labels drawn. */
function inline(text: string): ReactElement {
  /*
   * A WHOLE CELL THAT IS A COLOUR, drawn as one in backticks is (0.362).
   *
   * A palette is as often a table -- "| Crust | #C8A27A |" -- as a line of
   * code spans, and then its colours were a column to imagine again (the
   * Write & design drive, packaged 0.361). Only a run that is NOTHING but
   * `#rrggbb` qualifies: a table cell, a list item, a line on its own. A hex
   * inside a sentence stays text, which is GitHub's rule for the same reason
   * -- "fixed in #123456" is not a colour.
   */
  const whole = hexColourOf(text)
  if (whole !== undefined) {
    return (
      <code className="lc-code--inline">
        <span className="lc-swatch" style={{ backgroundColor: whole }} aria-hidden="true" />
        {text.trim()}
      </code>
    )
  }
  return (
    <>
      {splitInlineCode(text).map((span, index) => {
        if (span.kind === 'code') {
          const colour = hexColourOf(span.text)
          return (
            <code className="lc-code--inline" key={`s${String(index)}`}>
              {colour !== undefined && <span className="lc-swatch" style={{ backgroundColor: colour }} aria-hidden="true" />}
              {span.text}
            </code>
          )
        }
        if (span.kind === 'link') {
          /*
           * A web address is clickable now; anything else still is not.
           *
           * It used to be neither -- "shown, not linked" -- and the note
           * beside it said an actionable link is what a prompt injection
           * would ask for. Right instinct, wrong risk. A reply is rendered as
           * TEXT and never as markup, so nothing here executes; what a model
           * can do is write a label that disagrees with its target. That is
           * phishing, and the answer to phishing is to show the destination,
           * not to break every honest citation -- Colin, 2026-09-14: "source
           * links are hoverable but not clickable".
           *
           * A local path keeps exactly the old behaviour, because the old
           * worry was about those: a thread must not become a way to reach
           * this machine, and `isWebLink` refuses every non-web scheme.
           */
          const host = linkHost(span.href)
          if (host === undefined) {
            return (
              <span className="lc-linklabel" key={`s${String(index)}`} title={span.href}>
                {span.text}
              </span>
            )
          }
          /*
           * A button, NOT an anchor with a prevented href.
           *
           * `no-dead-links.test.ts` refuses every `<a href>` in the renderer,
           * because the host cancels navigation away from its own URL and an
           * href that goes nowhere does it SILENTLY -- three of them shipped
           * dead once and an outside tester found them. Writing an href and
           * then calling preventDefault on every click would slip past the
           * spirit of that guard by satisfying nothing: the markup would
           * claim a destination the element never uses. A button says what
           * this is -- something you press, which asks the host to open your
           * browser.
           */
          return <OutboundLink key={`s${String(index)}`} href={span.href} text={span.text} host={host} />
        }
        /*
         * What is bold or italic can hold code (0.362). A palette written as
         * "**Crust Brown `#6B4226`** -- Primary" showed its backticks as
         * characters and no swatch, because a bold run was drawn as plain
         * text (Iris's brand guide, packaged 0.362). Its contents go through
         * this same function; the delimiters are already gone, so each level
         * is strictly shorter than the one around it.
         */
        if (span.kind === 'strong') {
          return <strong key={`s${String(index)}`}>{nested(span.text)}</strong>
        }
        if (span.kind === 'em') {
          return <em key={`s${String(index)}`}>{nested(span.text)}</em>
        }
        if (span.kind === 'math') {
          return <MathTex key={`s${String(index)}`} tex={span.text} display={false} />
        }
        return <span key={`s${String(index)}`}>{span.text}</span>
      })}
    </>
  )
}

/**
 * A list, drawn at the depths the model wrote it at.
 *
 * It was flat: every item became a top-level `<li>` whatever its indent, so a
 * three-level answer came out as one column of equal-weight lines and the
 * structure -- which is the content, in a list -- was thrown away. B5 of the
 * interaction plan, and the one Claude Code parity item Colin could see.
 *
 * Built by walking the flat items and recursing on any run that is deeper
 * than the current level. Depth can only ever step UP by one at a time (the
 * parser's indent stack guarantees it), so there is no case where a child
 * arrives with no parent.
 */
function NestedList({
  items,
  ordered,
  level = 0
}: {
  readonly items: readonly ListItem[]
  readonly ordered: boolean
  readonly level?: number
}): ReactElement | null {
  if (items.length === 0) return null
  const rows: ReactElement[] = []
  let index = 0
  while (index < items.length) {
    const item = items[index]
    if (item === undefined) break
    // Everything after it that is deeper belongs to it.
    let end = index + 1
    while (end < items.length && (items[end]?.depth ?? 0) > level) end += 1
    const children = items.slice(index + 1, end)
    rows.push(
      <li key={`i${String(index)}`}>
        {inline(item.text)}
        {item.paragraphs?.map((paragraph, at) => (
          <p className="lc-list__para" key={`p${String(at)}`}>
            {inline(paragraph)}
          </p>
        ))}
        {children.length > 0 && <NestedList items={children} ordered={ordered} level={level + 1} />}
      </li>
    )
    index = end
  }
  const className = level === 0 ? 'lc-list' : 'lc-list lc-list--nested'
  // Resume at the number written: a list split by a code block between its
  // steps starts its second half at 3, not at 1 again.
  const start = items[0]?.number
  return ordered ? (
    <ol className={className} {...(start !== undefined && start !== 1 ? { start } : {})}>
      {rows}
    </ol>
  ) : (
    <ul className={className}>{rows}</ul>
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
  // Parsed again only when something new has settled, not on every frame of
  // the tail (Sol's optimization check, 2026-10-02: ~1 ms a frame at 100k).
  const blocks = useMemo(() => parseAgentText(settled), [settled])
  return (
    <>
      {blocks.map((block, index) => {
        const last = index === blocks.length - 1
        if (block.kind === 'code') {
          // A whole web page runs on a stage, once its block has closed (0.553).
          if (!(streaming && last) && isWholePage(block.code, block.language)) {
            return <ReplyPage key={`b${String(index)}`} code={block.code} {...(block.language === undefined ? {} : { language: block.language })} />
          }
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
          // Nested, from each item's own depth. A flat list is the same markup
          // it always was; a nested one is the shape the model actually wrote.
          return <NestedList items={block.items} ordered={block.ordered} key={`b${String(index)}`} />
        }
        if (block.kind === 'table') {
          /*
           * Columns, which is what a teammate meant when it wrote pipes.
           *
           * Each cell goes through the same inline reader as prose, because
           * half the value of these tables is a bold figure in one cell. The
           * whole thing sits in its own scroller: a wide table must scroll
           * itself rather than make the conversation scroll sideways.
           */
          return (
            <div className="lc-tablewrap" key={`b${String(index)}`}>
              <table className="lc-table">
                <thead>
                  <tr>
                    {block.header.map((cell, cellIndex) => (
                      <th key={`h${String(cellIndex)}`} className={alignClass(block.align[cellIndex])}>
                        {inline(cell)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={`r${String(rowIndex)}`}>
                      {row.map((cell, cellIndex) => (
                        <td key={`c${String(cellIndex)}`} className={alignClass(block.align[cellIndex])}>
                          {inline(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
        if (block.kind === 'rule') {
          return <hr className="lc-hr" key={`b${String(index)}`} />
        }
        if (block.kind === 'math') {
          return <MathTex key={`b${String(index)}`} tex={block.tex} display />
        }
        // Line breaks inside a paragraph are kept (`lc-para` is pre-line):
        // asked for "every file, one per line", Composer answered
        // "README.md\nstatus.ts" and the thread drew "README.md status.ts",
        // which reads as the teammate ignoring the request. User session 3,
        // 2026-09-05, checked against the ledger.
        /*
         * A GAP THE RUNTIME LEFT, said as the app rather than as the teammate.
         *
         * Antigravity writes `<truncated N bytes>` into its own transcript
         * when it drops part of a record, and Locust passes it through
         * faithfully -- 7 message deltas and 48 tool outputs in Colin's
         * ledger, and no code in this repo writes that string. So it arrived
         * mid-reply on its own LINE, splitting a word across it: "...internal
         * Ollama i" / the marker / "yte-offset, tamper-evident receipts".
         * Colin, 2026-09-21: *"minor truncation bug"*.
         *
         * It is not our truncation and it is not wrong to show -- content
         * really was lost, and hiding the marker would hand someone a broken
         * sentence as a whole one. What was wrong is that a machine string
         * wore the teammate's voice.
         *
         * SPLIT INSIDE THE PARAGRAPH, not into blocks. A paragraph keeps its
         * newlines here (`lc-para` is `pre-line`, for the "one file per line"
         * reason below), so the marker is never a block of its own -- which
         * is what the first attempt at this assumed, and why it drew nothing.
         * Every character still reaches the screen; only the drawing changes.
         */
        const parts = block.text.split(/^<truncated (\d+) bytes>$/gm)
        if (parts.length > 1) {
          return (
            <Fragment key={`b${String(index)}`}>
              {parts.map((part, at) =>
                at % 2 === 1 ? (
                  <p className="lc-gap lc-mono" key={`g${String(at)}`} role="note">
                    {part} bytes the runtime did not keep
                  </p>
                ) : part.trim().length === 0 ? null : (
                  <p className="lc-para" key={`p${String(at)}`}>
                    {inline(part)}
                  </p>
                )
              )}
            </Fragment>
          )
        }
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
/** A column's alignment as a class, or none where the table did not say. */
function alignClass(align: 'left' | 'right' | 'center' | undefined): string | undefined {
  return align === undefined ? undefined : `is-${align}`
}

/**
 * The plan card's two orbs, and why they are two.
 *
 * THE HISTORY, because this one moved three times and each move was a real
 * finding. Colin asked for the rubik on the step underway -- *"i see it plan
 * consistently and i think it would look alot better as one of the more
 * spherical assets"*. It went there, then away when `solving` took every open
 * tool (two identical spheres a few pixels apart on one screen reads as a
 * glitch), then back when `solving` narrowed to connectors.
 *
 * AND THEN IT LOST ON ITS OWN MERITS, which is the part worth keeping: *"might
 * have to give up on rubix cube as the plan indicator... put the full sized
 * rubix next to PLAN so the user can see the plan is active, and then use the
 * previous smaller pulsing/bouncing sphere... for the active part of the
 * plan."*
 *
 * That is the same rule that cut the web and the braid, arriving on the orb we
 * had just fought to keep: A SHAPE MADE OF SCRAMBLING BANDS NEEDS ROOM. An
 * 11px row marker is not room. It is not that the rubik is wrong for a plan --
 * it is that a row marker is the wrong SIZE for a rubik. So the rubik goes
 * where there is room, once per card, and says what a card-level mark should
 * say: this plan is running.
 *
 * The step took `working` first -- four particles on tilted orbits -- and that
 * lasted one look: *"the particles were using rn are a little scattered for
 * that task"*. Right again, and for a reason worth keeping: a plan step is a
 * DISCRETE unit of work, and a mark made of loose particles says diffuse. A
 * step underway wants something that reads as one solid thing.
 *
 * So it is `listening` at the library's INLINE drawing -- the 20 preset at
 * 20px, which Colin picked by pointing at that cell on a contact sheet:
 * *"its honestly different enough from everything else and i think it would
 * work with the plan structure"*. At that size it is a small dense sphere,
 * which is exactly what a discrete unit of work should look like.
 *
 * NOTE THE ONE COLLISION IT ACCEPTS. `listening` is also the live line's
 * THINKING orb, and the plan card and the live line can be on screen at once
 * -- which is the very thing that cost the rubik this slot. It is a weaker
 * version of that problem: these are different drawings of the same shape
 * (inline 20 here, the 64 asset there) at different sizes and at opposite
 * ends of the view, where the rubik's clash was the same drawing at the same
 * size a few pixels apart. Colin made the call knowing the shape; if the two
 * ever read as one thing on screen, this is the line to come back to.
 */
const PLAN_ORB: OrbState = 'listening'

/** The header light: the rubik at a size its bands can actually be seen at. */
const PLAN_HEAD_ORB = 24

/**
 * The step marker, kept small on purpose.
 *
 * It sits in a narrow column beside a line of text. Anything bigger pushes
 * the step's words out of line with the ones above and below it, which is the
 * whole reason a plan reads as a list. 20 is the inline drawing's own size,
 * so this is neither scaled up nor down -- it is the picture as drawn.
 */
const PLAN_STEP_ORB = 20

export function PlanSteps({
  steps,
  doneCount,
  outcomes,
  underway = false,
  finished = false,
  stopped = false
}: {
  readonly steps: readonly PlanStep[]
  readonly doneCount: number
  /** Whether a run happened and these steps have states to report. */
  readonly outcomes: boolean
  /**
   * Whether the run has ENDED, which changes what an unfinished step means.
   *
   * While a run is going, `pending` means "not yet". Once it has stopped,
   * the same value means "never happened" -- and the card drew both the
   * same way, so a plan whose runtime never sent a closing `plan.updated`
   * sat under a finished answer with steps that read as still to come.
   *
   * The steps are NOT rewritten. Calling them done would be a lie about the
   * run; hiding them would hide that it planned something it did not do,
   * which is usually the most useful thing on the card. The card just stops
   * describing them in the present tense.
   */
  readonly finished?: boolean
  /**
   * Whether the run failed or was stopped before closing its list. Only
   * then is an unchecked step one it did not get to, drawn in amber; after
   * a run that completed it is the checklist left unticked, said plainly.
   */
  readonly stopped?: boolean
  /**
   * Whether the turn is still running, so the step underway gets its orb.
   *
   * Colin, 2026-09-20: *"lets use the orbs for the working portion of the
   * plan as well."* This was an `OrbState` until he looked at it — see
   * `PLAN_ORB` for why a boolean is the honest shape. The plan does not need
   * to be told WHICH orb; it needs to be told whether anything is underway.
   *
   * False on a finished plan, where a pulsing anything would say a step is
   * running after the run has ended.
   */
  readonly underway?: boolean
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
    /*
     * A BORDERED CARD, which is what the design package actually drew.
     *
     * The 2026-09-09 ruling that took the box off was about the Plan-MODE
     * answer -- the branch above, where the plan IS the reply and belongs in
     * prose beside the face. It was read too broadly and the box came off
     * this branch too, which is a different thing: a plan with STATES, a
     * done count, and rows that change while you watch. Colin, 2026-09-20,
     * against the design agent's own frame: "the plan in chat isnt showing
     * up with a border like it did from the design agent".
     */
    <div className="lc-plancard">
      <div className="lc-plancard__head lc-mono">
        {/*
          * THE RUBIK MOVED UP HERE, at the size it was drawn for.
          *
          * Colin, 2026-09-20, with a frame of it on a step: *"might have to
          * give up on rubix cube as the plan indicator... put the full sized
          * rubix next to PLAN so the user can see the plan is active"*. He is
          * right about the cause. An 11px row marker cannot hold a shape whose
          * whole identity is scrambling bands -- that is the same finding that
          * cut the web and the braid, arriving on the one orb we had just
          * fought to keep.
          *
          * So it stops being a marker and becomes a HEADER LIGHT, which is
          * what it is good at: one per card, big enough to read, and it says
          * the thing the card as a whole wants to say.
          *
          * LEFT OF THE WORD, not beside the count. The eye starts at the left
          * edge of a card and the claim is about the plan, not about the
          * arithmetic -- next to "1 of 4 done" it would read as decoration on
          * a number.
          *
          * Only while something is actually underway: a still rubik on a
          * finished plan would say "active" about a plan that is not.
          */}
        {underway && (
          <span className="lc-plancard__orb" aria-hidden="true">
            <Orb state="solving" box={PLAN_HEAD_ORB} />
          </span>
        )}
        <span>PLAN</span>
        {/*
          * One right-hand group, because the head is `space-between` with
          * two children: a third span would have pushed the count into the
          * middle of the card rather than adding to it.
          *
          * And said once, on the header, rather than on every row -- a
          * count is the shape of what happened, and "not reached" repeated
          * down the list would shout about the ordinary case of a run that
          * stopped early.
          */}
        <span className="lc-plancard__counts">
          <span>{doneCount} of {steps.length} done</span>
          {/*
            * "NOT CHECKED OFF", not "not reached" -- which was mine (0.255)
            * and claimed more than the evidence. The beta review of 0.255.0,
            * #2: a run that completed, whose file on disk had both requested
            * lines and whose tool receipts showed the edit and the read-back,
            * was drawn as "0 of 2 done · 2 not reached". The checklist is
            * the runtime's bookkeeping; whether the work happened is a
            * different fact, and this card can only report the first.
            */}
          {/*
            * AMBER ONLY WHEN THE RUN STOPPED SHORT (0.368). Amber says
            * interrupted; a run that completed and left its list unticked
            * was not -- Quill asking its questions and waiting for the
            * answers read as a fault. After a completed run it is said in the
            * header's own voice, after a separator.
            */}
          {finished && outcomes && steps.length - doneCount > 0 && (
            <>
              <span className="lc-separator" aria-hidden="true">
                ·
              </span>
              <span
                className={`lc-plancard__unreached${stopped ? ' is-stopped' : ''}`}
                title={
                  stopped
                    ? 'The run stopped before checking these off its list: see what it ran below.'
                    : "The run ended without checking these off its list. That is the runtime's checklist, not a check of the work: see what it ran below."
                }
              >
                {steps.length - doneCount} not checked off
              </span>
            </>
          )}
        </span>
      </div>
      <ul className="lc-plan">
        {steps.map((step, index) => (
          <li
            key={`${String(index)}-${step.text}`}
            className={`lc-plan__step is-${step.state}${finished && step.state !== 'done' ? ' is-unreached' : ''}`}
          >
            <span className="lc-plan__marker" aria-hidden="true">
              {/*
                * The step underway PULSES, with the same `lcPulse` the sidebar
                * uses for a working teammate and the design package uses for
                * the teammate writing now ("the same pulsing lime pip the
                * sidebar uses"). Colin, 2026-09-14: "wasnt there an animation
                * to show which part of the task/plan was underway like a light
                * pulse?"
                *
                * The running step already had the colour and the border and
                * was the only motionless thing in a view where motion means
                * "happening now" -- so on a six-step plan there was nothing to
                * catch the eye at the one row that was actually moving.
                */}
              {step.state === 'done' ? (
                <Icon name="check" size={11} />
              ) : step.state === 'running' && underway ? (
                // The orb REPLACES the pulsing pip rather than joining it:
                // two things pulsing on one row is the row saying "now" twice.
                <span className="lc-plan__orb" data-orb={PLAN_ORB}>
                  <Orb state={PLAN_ORB} box={PLAN_STEP_ORB} preset={20} />
                </span>
              ) : (
                // Nothing pulses once the run has stopped: a pulsing dot on
                // a finished plan says a step is running after the fact.
                <span className={`lc-dot${step.state === 'running' && !finished ? ' is-pulsing' : ''}`} />
              )}
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
 * A clock that runs while the line is on screen.
 *
 * From the event's OWN timestamp, so a step already running when the view
 * opened reports its real age rather than starting at zero.
 */
function useElapsed(startedAt: string): { readonly label: string; readonly now: number } {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return { label: elapsedLabel(startedAt, now), now }
}

/**
 * WHOSE, WHICH REGISTER, and what it is on -- the one live line this app has.
 *
 * Drawn without a face on purpose: a thread puts the teammate's face in its
 * own gutter and a room puts it in the room's, and the two gutters are
 * different widths. Everything to the right of the face is this, in both
 * places, because Colin asked for the room to behave like the thread --
 * 2026-09-11, on a room drawing a flat "Gem is replying…" while the thread
 * beside it animated and named the tool: "lets make this behave more like our
 * actual chat, where the animated ...'s appear and all the calls".
 */
export function LiveRegisterLine({
  register,
  label,
  detail,
  startedAt,
  orb,
  thinking
}: {
  /**
   * The orb, drawn BESIDE THE WORD IT IS ABOUT.
   *
   * Colin, 2026-09-20, with a frame of `[face] ○ Yurt · starting · 21s`:
   * *"dont we think it should be beside the thinking action? like the orb
   * next to starting/thinking etc?"* He is right and it is not a nicety —
   * sitting before the NAME the orb reads as a property of the teammate,
   * which is the one thing it is not. It is a property of what they are
   * doing, and the register word is what says that.
   */
  readonly orb?: OrbState
  // No name: the face beside the line carries it (see LiveStepCard).
  readonly register: LiveRegister
  /** Whatever the runtime called this step, if it called it anything. */
  readonly label?: string
  readonly detail?: string
  readonly startedAt: string
  /** Draws the dots: waiting on the model with nothing to show yet. */
  readonly thinking: boolean
}): ReactElement {
  const elapsed = useElapsed(startedAt)
  const word = REGISTER_WORD[register]
  /*
   * The runtime's own words, when they ARE words and not the register said
   * twice. `label` is "Thinking" or "Working" whenever the runtime named no
   * step, and printing that beside "thinking" is the app stuttering.
   */
  const said =
    label === undefined || label.trim().toLowerCase() === word || /^(thinking|working|starting)$/i.test(label.trim())
      ? undefined
      : label.trim()
  /*
   * Bounded, because a runtime's own words are not always words.
   *
   * Claude Code packs a subagent's type, its description and its last tool
   * into one message, and the description can be the literal search pattern:
   * `general-purpose · Searching for .{200}e\+09".{100} · last tool Grep`
   * wrapped the line onto two rows and drowned the register that had just
   * been added to make the line readable (Colin, 2026-09-11, screenshot).
   */
  const ASIDE_LIMIT = 56
  const trimmed = said === undefined || said.length <= ASIDE_LIMIT ? said : `${said.slice(0, ASIDE_LIMIT - 1)}…`
  const aside = [trimmed, detail].filter((part) => part !== undefined && part.length > 0)
  return (
    <>
      <span className="lc-livestep__label">
        <span className="lc-livestep__register">
          {/*
            * `data-orb` IS THE SEAM, and the library's `aria-label` is not.
            *
            * `ThinkingOrb` labels its canvas from its own state name —
            * "Listening…", "Composing…" — and since 2026-09-20 those names are
            * an ALLOCATION of shapes to rows rather than a description of
            * them, so the label and the row's word no longer agree by
            * construction. Nobody hears it: the canvas is `aria-hidden` and
            * the row's own text is the accessible name. But the orb drive was
            * reading that label as the orb's IDENTITY, which quietly emptied
            * its contradiction check — so the state is published here, by us,
            * where it is true.
            */}
          {orb !== undefined && (
            <span className="lc-livestep__orb" data-orb={orb}>
              {/*
                * `theme="dark"` pinned, not `auto`: `auto` falls back to the
                * OS setting and Locust is dark regardless, so a light desktop
                * would get dark ink on a dark panel.
                *
                * `aria-hidden`, because the word it sits next to already says
                * this in text — and the library's own label would sometimes
                * disagree with it ("Thinking…" beside "starting").
                */}
              <Orb state={orb} box={ORB_BOX} />
            </span>
          )}
          {/*
            * THE SWEEP, the thing Claude Code does to its active line.
            *
            * Colin, 2026-09-20: "you know how claude code has a very subtle
            * visual gradient that goes across the text of whatever active
            * task is happening? we should add that to whatever task is
            * running". A band of lighter ink travels along the word, left to
            * right, on a loop.
            *
            * ON THE WORD, NOT THE ROW. The sweep says "this is the live one",
            * and a row carries a teammate's name and a clock beside it that
            * are not live in that sense -- sweeping those would make the
            * whole line look like it is being generated.
            *
            * It is painted with `background-clip: text`, which means the ink
            * is a TRANSPARENT colour over a moving gradient. That is a real
            * hazard: anything that stops the paint leaves invisible text, so
            * the reduced-motion rule puts the colour back rather than only
            * stopping the animation.
            */}
          {/*
            * `data-text` repeats the word because the highlight is drawn from
            * it -- the library's own shape, see `.lc-sweep`. The four dots are
            * theirs too: an ellipsis and a full stop, which is what their page
            * shows beside every orb.
            */}
          <span className="lc-sweep" data-text={sweepText(word)}>{sweepText(word)}</span>
          {/*
            * THE DOTS ONLY WHERE THERE IS NO ORB.
            *
            * They meant "waiting on the model with nothing to show yet", and
            * the `breathing` orb now says exactly that, beside the face. Both
            * at once is the app saying one thing twice — the design agent's
            * rule for this whole change: wherever an orb lands, the older
            * signal goes, or "running" is said five ways instead of four.
            *
            * The branch stays because a row without an orb is still possible
            * and the dots are the right answer there.
            */}
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
        {elapsed.label}
      </span>
    </>
  )
}

/** What a live line IS, in the words a person would use for it. */
/**
 * The word as the library's own page sets it, with one correction.
 *
 * THREE DOTS, NOT FOUR. Their markup is `Solving….` -- an ellipsis
 * followed by a full stop, which draws four. Colin: *"3 ...'s is standard
 * with us humans"*, which is the right call: four dots is not a punctuation
 * mark anyone writes, and a trailing stop after an ellipsis reads as a typo
 * rather than as a style. The ellipsis alone is the thing every chat app
 * uses for this.
 *
 * KEPT OUR WORDS, TOOK THEIR SHAPE. Their captions name the ORB (`Solving…`),
 * and ours name what is happening (`using a connector`). Printing theirs would
 * put "Solving" on a row where an MCP tool is running, which is the exact
 * contradiction this whole mapping exists to prevent -- and the same collision
 * of vocabularies that made three rounds of "use this one for that" ambiguous.
 */
export function sweepText(word: string): string {
  return `${word.charAt(0).toUpperCase()}${word.slice(1)}…`
}

export const REGISTER_WORD: Record<LiveRegister, string> = {
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
  orb,
  owner,
  activity,
  face: showFace = true
}: {
  /**
   * The thinking orb for this step, when one is truthful.
   *
   * THE SPLIT (design agent, 2026-09-20): **the face is *who*, the orb is
   * *waiting*.** The pixel face keeps its motion in the sidebar, the header
   * and the roster — the surfaces where teammates are compared with each
   * other. Inside the thread there is only one teammate and the question is
   * not who, so the orb carries the motion and the face sits still.
   *
   * Absent when no orb is true of the work — writing a file, or waiting on
   * the model with nothing reported. The line keeps its dots there.
   */
  readonly orb?: OrbState
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
  /** Off where the face is already on screen beside this line (a room's answer card). */
  readonly face?: boolean
}): ReactElement {
  // The dots meant "a reasoning step is open", which most runtimes never
  // report -- so the nicest signal in the app almost never appeared (Colin,
  // 2026-09-04: "I feel like i never see the '...'"). They now mean the
  // honest thing: the teammate is waiting on the model and has nothing to
  // show yet. That covers the reasoning step AND the launch and the gaps
  // between steps, which is most of the time a person spends waiting.
  const thinking = activity === 'thinking' || waiting
  const face = owner ?? { hue: 'lime' as const, avatar: RUNTIME_FACE }
  return (
    <div className={`lc-livestep${thinking ? ' is-thinking' : ''}`} data-step-kind={kind} data-register={register}>
      {!showFace ? <span className="lc-livestep__gutter" /> : <TeammateBot
        hue={face.hue}
        avatar={face.avatar}
        size={26}
        /*
         * THE FACE KEEPS ITS OWN MOTION, beside the orb rather than instead
         * of it.
         *
         * 0.208.0 stilled it here, on the reasoning that two moving things
         * both meaning "still going" is the app saying one thing twice. That
         * reasoning was wrong, and Colin called it (2026-09-20): they are not
         * saying the same thing. The face says **this teammate is alive**;
         * the orb says **what kind of work**. One is identity, the other is
         * register, and the face is the bigger, more peripheral shape — so it
         * is what catches the eye at a glance the 20px orb cannot.
         */
        activity={activity}
        /*
         * The one face that keeps every hop: the one you are talking to.
         * The sidebar's and the header's copies of the same teammate are
         * subtle (Colin, 2026-09-23: "the one in the chat where you're
         * speaking to, all that movement is fine and great ... but its
         * mirrored in the sidebar and the top, lets tame those two down").
         */
        motion="full"
        {...(owner?.teammateId === undefined ? {} : { teammateId: owner.teammateId })}
        /*
         * The face is the attribution; the name is its hover title.
         *
         * A group conversation used to print the name beside the face --
         * `[face] ○ Wren · working · 14s`. Colin, 2026-09-22, holding up the
         * one-to-one version, which never did: *"just make em all like that
         * ... the name next to it isnt needed"*. The sidebar, the header and
         * the face's own title all say who it is.
         */
        {...(owner?.name === undefined ? {} : { name: owner.name })}
      />}

      <LiveRegisterLine
        register={register}
        label={label}
        {...(detail === undefined ? {} : { detail })}
        startedAt={startedAt}
        {...(orb === undefined ? {} : { orb })}
        /*
         * The dots and the orb are the same claim — "still going, nothing to
         * show" — so only one of them draws. The orb wins where it exists,
         * which is the rule for this whole change: wherever an orb lands, the
         * older signal goes, or "running" is said five ways instead of four.
         */
        thinking={thinking && orb === undefined}
      />
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
  message,
  action
}: {
  readonly level: 'info' | 'warning' | 'error'
  readonly message: string
  /**
   * The one thing the person can do about it, under it (C9): a busy free
   * model's notice offers the next free model. Absent, the line is as it was.
   */
  readonly action?: { readonly label: string; readonly onPress: () => void }
}): ReactElement {
  const tone = `lc-diagnostic lc-tone-${level === 'error' ? 'red' : level === 'warning' ? 'amber' : 'muted'}`
  if (action === undefined) {
    return (
      <div className={tone}>
        <Icon name="shield" size={12} />
        <span>{message}</span>
      </div>
    )
  }
  return (
    <div className={tone}>
      <Icon name="shield" size={12} />
      <div className="lc-diagnostic__body">
        <span>{message}</span>
        <button type="button" className="lc-diagnostic__action" onClick={action.onPress}>
          {action.label}
        </button>
      </div>
    </div>
  )
}
