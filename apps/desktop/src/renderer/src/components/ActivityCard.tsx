import { Fragment, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'

import { activityCounts, activityEntries, boundedShellOutput, defaultOpenEntry, relativePath } from '../missionView.js'
import type { TraceSegment, ActivityDetail, ActivityEntry, PlanStep } from '../missionView.js'
import { DiffView } from './DiffView.js'
import { Icon } from './Icon.js'

/**
 * The disclosure chain for what a teammate did, three rungs deep:
 *
 *   Edited 3 files · ran 2 commands  +254 −16     <- this card, collapsed
 *     src/billing/v3.ts  MODIFIED  +184 −12       <- a file row
 *       the unified diff                          <- DiffView
 *
 * One list, two row kinds: files and shell commands sit in the order they
 * happened, so "what it did" reads top to bottom. Every count on the card
 * is derived from the same rows the diff draws -- the header total is the
 * sum of the file rows, and each file row is the sum of its hunks.
 */
/**
 * What a command printed, bounded and kept at both ends.
 *
 * `pre` rather than a diff view: this is output, not a change, and the shape
 * of it — columns, indentation, a stack trace — is often the information.
 */
function ShellOutput({ output, failed = false }: { readonly output: string; readonly failed?: boolean }): ReactElement {
  const { head, tail, omitted, total } = boundedShellOutput(output)
  /*
   * On a failing run the TAIL is the answer, so it is drawn brighter.
   *
   * The whole reason both ends are kept is that an error is as often the last
   * line as the first -- a vitest failure puts the assertion, the file and the
   * counts in its last six. When the command failed, those lines are what the
   * person opened the row for, and drawing them in the same muted grey as 300
   * lines of `seq` output makes them work to find it (design, 2026-09-08).
   *
   * Only on failure. Emphasising the tail of every successful command would
   * make the emphasis mean nothing, which is how `1 notice` happened.
   */
  const tailClass = `lc-shellout__text${failed ? ' is-answer' : ''}`
  /**
   * Everything, once asked for.
   *
   * Deliberately unbounded from here: at that point the person has pressed a
   * button that says how many lines they are asking for, and a second cut
   * after an explicit request is the app deciding it knows better.
   */
  const [showAll, setShowAll] = useState(false)
  if (showAll || omitted === 0) {
    /*
     * Expanded: nothing is emphasised. A short output IS its own tail, so a
     * failing one is drawn as the answer -- but once the person has asked for
     * all 300 lines, marking all 300 as "the answer" is emphasis that means
     * nothing, which is the rule stated three lines above this one and broken
     * one line below it in the first version.
     */
    return (
      <div className="lc-shellout">
        <pre className={showAll ? 'lc-shellout__text' : tailClass}>
          {showAll ? output.replace(/\s+$/, '') : head}
        </pre>
        <ShellOutputFoot output={output} total={total} />
      </div>
    )
  }
  return (
    <div className="lc-shellout">
      <pre className="lc-shellout__text">{head}</pre>
      {/*
        * The elision is a CONTROL, not a sentence.
        *
        * It used to be a line of prose in the middle of the `pre` explaining
        * that lines were missing, inside a box 320px tall that scrolled --
        * so the fact was unpressable and the box shouted. Same pattern as the
        * diff's folded context, which this app already ships.
        */}
      <button type="button" className="lc-shellout__more" onClick={() => setShowAll(true)}>
        {omitted} more lines
      </button>
      <pre className={tailClass}>{tail}</pre>
      <ShellOutputFoot output={output} total={total} />
    </div>
  )
}

/**
 * The foot of the output: take all of it, and how much there is.
 *
 * Copying is the honest answer to a bounded view -- the whole point of cutting
 * the middle is that the screen is the wrong place for 300 lines, and the
 * right place is wherever the person was going to put them.
 */
function ShellOutputFoot({ output, total }: { readonly output: string; readonly total: number }): ReactElement {
  const [copied, setCopied] = useState(false)
  const copy = (): void => {
    const text = output.replace(/\s+$/, '')
    const done = (): void => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_600)
    }
    // Same fallback as `InstallCommand`: `navigator.clipboard` is the right
    // call and is not always available to a packaged page.
    navigator.clipboard?.writeText(text).then(done).catch(() => {
      const field = document.createElement('textarea')
      field.value = text
      document.body.appendChild(field)
      field.select()
      try {
        document.execCommand('copy')
        done()
      } finally {
        field.remove()
      }
    })
  }
  return (
    <div className="lc-shellout__foot">
      <button type="button" className="lc-shellout__copy" onClick={copy}>
        <Icon name="copy" size={12} />
        {copied ? 'Copied' : `Copy all ${String(total)} ${total === 1 ? 'line' : 'lines'}`}
      </button>
    </div>
  )
}

export function ActivityCard({
  summary,
  details,
  runtimeName,
  trace,
  finished = false,
  workspacePath,
  plan,
  notices = [],
  openByDefault = false
}: {
  readonly summary: string
  /** The trace line; when absent the summary string is drawn (older callers). */
  readonly trace?: readonly TraceSegment[]
  /** True once the turn is over: an unsettled subagent then reads "did not report". */
  readonly finished?: boolean
  readonly details: readonly ActivityDetail[]
  readonly runtimeName: string | undefined
  /** The folder this mission ran in, so paths read the way a person writes them. */
  readonly workspacePath: string | undefined
  /**
   * The plan this run stated, drawn as the fold's FIRST rows.
   *
   * A plan is the clearest possible statement of what the run did, so it is
   * the fold's own content rather than a card sitting above it -- which is
   * what it used to be, on almost every Codex run (design review,
   * 2026-09-06).
   */
  readonly plan?: { readonly steps: readonly PlanStep[]; readonly doneCount: number }
  /**
   * What the runtime said about this turn, drawn at the foot of the fold.
   *
   * The diagnostics the thread's gate drops. They were counted in the trace
   * line as `1 notice` and shown nowhere -- see missionView's collection
   * point, which is inside the branch that drops them so the two can never
   * describe different sets again.
   */
  readonly notices?: readonly { readonly level: 'info' | 'warning' | 'error'; readonly message: string }[]
  /**
   * Open on arrival, for the newest finished turn. See `openByDefault` on the
   * activity item for why: the live narration disappears when a run ends, and
   * a person looking back at it found one collapsed line.
   */
  readonly openByDefault?: boolean
}): ReactElement {
  const [open, setOpen] = useState(openByDefault)
  /**
   * Whether the person has decided for themselves.
   *
   * `openByDefault` flips from false to true when the run finishes, and this
   * component does not remount -- so without remembering a deliberate press,
   * closing the fold mid-run would be silently undone a moment later. A choice
   * made by hand outranks the default, always.
   */
  const decided = useRef(false)
  useEffect(() => {
    if (decided.current) return
    /*
     * A default may OPEN this fold. It may never close it.
     *
     * `openByDefault` is true only for the newest finished turn, so sending a
     * follow-up flipped it back to false on the turn before -- and this effect
     * dutifully closed a fold the person was looking at. Driven and measured
     * (docs/user-session/2026-09-08T14-07-32-earlier-turn-work): six tool rows
     * on screen, then `expanded: false, rowsVisible: 0` the moment the next
     * message was sent, with nothing having been pressed.
     *
     * That is Colin's report, 2026-09-08 -- "the thoughts and tool calls
     * disappear after an agent is done ... we want that to stay so they can
     * see after the fact or if they missed it". The work was never lost, but
     * it was taken off the screen by the app rather than by them.
     *
     * Opening is a default; closing is an action, and the app does not get to
     * take it. A turn arriving from history still starts closed, because its
     * initial state was closed and nothing here opens it.
     */
    if (openByDefault === true) setOpen(true)
  }, [openByDefault])
  // Only ever set when the host refuses. A reveal that works needs no words:
  // the file manager comes to the front and that is the whole feedback.
  const [revealNotice, setRevealNotice] = useState<string | undefined>(undefined)
  const reveal = (path: string): void => {
    const bridge = window.desktop
    if (bridge === undefined) return
    setRevealNotice(undefined)
    void bridge
      .revealFile(path)
      .then((response) => {
        if (!response.ok) setRevealNotice(response.message)
      })
      .catch(() => setRevealNotice('That file could not be shown.'))
  }
  const entries = activityEntries(details, workspacePath)
  const counts = activityCounts(details, workspacePath)
  const anyPatch = entries.some((entry) => entry.kind === 'file')
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(() => new Map())
  const initiallyOpen = defaultOpenEntry(entries)
  const isOpen = (entry: ActivityEntry): boolean => toggled.get(entry.key) ?? entry.key === initiallyOpen
  const decide = (next: boolean): void => {
    decided.current = true
    setOpen(next)
  }
  const toggle = (entry: ActivityEntry): void => {
    const next = new Map(toggled)
    next.set(entry.key, !isOpen(entry))
    setToggled(next)
  }

  return (
    <div className="lc-card">
      <button type="button" className="lc-activity" onClick={() => decide(!open)} aria-expanded={open}>
        <Icon name="diff" size={14} />
        {trace === undefined || trace.length === 0 ? (
          <span>{summary}</span>
        ) : (
          <span className="lc-trace">
            {trace.map((seg) => (
              <span className={`lc-trace__seg${seg.tone === undefined ? '' : ` is-${seg.tone}`}`} key={seg.key}>
                {seg.text}
              </span>
            ))}
          </span>
        )}
        {anyPatch && (
          <span className="lc-activity__counts lc-mono">
            <span className="lc-diff__addmark">+{counts.added}</span>
            <span className="lc-diff__delmark">−{counts.removed}</span>
          </span>
        )}
        <span className={`lc-activity__chev${anyPatch ? '' : ' is-alone'}`} aria-hidden="true">
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
        </span>
      </button>
      {open && (
        <div className="lc-activity__list">
          {plan !== undefined && (
            <div className="lc-activity__plan">
              <div className="lc-rail__meta lc-mono">
                PLAN · {plan.doneCount} of {plan.steps.length} done
              </div>
              <ul className="lc-plan">
                {plan.steps.map((step, index) => (
                  <li key={`${String(index)}-${step.text}`} className={`lc-plan__step is-${step.state}`}>
                    <span className="lc-plan__marker" aria-hidden="true">
                      {step.state === 'done' ? <Icon name="check" size={11} /> : <span className="lc-dot" />}
                    </span>
                    <span>{step.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {entries.map((entry) => (
            <Fragment key={entry.key}>
              {entry.kind === 'file' ? (
                <>
                  <div className="lc-filerow__line">
                    <button type="button" className="lc-filerow" onClick={() => toggle(entry)} aria-expanded={isOpen(entry)}>
                      <Icon name="file" size={14} />
                      <span className="lc-filerow__path">{relativePath(entry.file.path, workspacePath)}</span>
                      <span className="lc-filerow__status">{entry.file.status}</span>
                      {entry.large && <span className="lc-filerow__status is-large">LARGE</span>}
                      <span className="lc-filerow__result">
                        <span className="lc-diff__addmark">+{entry.counts.added}</span>
                        <span className="lc-diff__delmark">−{entry.counts.removed}</span>
                      </span>
                      <span className="lc-activity__chev" aria-hidden="true">
                        <Icon name={isOpen(entry) ? 'chevron-down' : 'chevron-right'} size={12} />
                      </span>
                    </button>
                    {/*
                      The file is on this disk and, until now, nothing on screen
                      would take you to it -- found by dogfooding (Colin,
                      2026-09-07): a teammate wrote a report, named it, and the
                      name was not clickable. This is the row's own control
                      rather than a menu item, because "where is it" is the
                      first thing asked about a file and a fold two levels deep
                      is not where the answer belongs.
                    */}
                    <button
                      type="button"
                      className="lc-filerow__reveal"
                      title={`Show ${relativePath(entry.file.path, workspacePath)} in the file manager`}
                      aria-label={`Show ${relativePath(entry.file.path, workspacePath)} in the file manager`}
                      onClick={() => reveal(entry.file.path)}
                    >
                      <Icon name="folder" size={13} />
                    </button>
                  </div>
                  {isOpen(entry) && <DiffView file={entry.file} truncated={entry.truncated} reported={entry.reported} />}
                </>
              ) : entry.kind === 'helper' ? (
                // A helper the runtime started for itself. What it did inside
                // is the runtime's business and not reported; what it was
                // asked, and whether it came back, is.
                <div className="lc-filerow is-static is-helper">
                  <Icon name="users" size={14} />
                  <span className="lc-filerow__path">{entry.description}</span>
                  <span className="lc-filerow__status">{entry.subagentType === undefined ? 'subagent' : `${entry.subagentType} subagent`}</span>
                  {/* Four states, not three: a helper the run ended without settling is not working on it -- it did not report (SURFACES-0.22 §2). Amber, not red: nothing said it failed. */}
                  <span
                    className={`lc-filerow__result ${entry.settled ? (entry.failed ? 'is-failed' : 'is-muted') : finished ? 'is-stalled' : 'is-running'}`}
                    {...(entry.summary === undefined ? {} : { title: entry.summary })}
                  >
                    {!entry.settled ? (finished ? 'did not report' : 'working on it') : entry.failed ? 'failed' : entry.summary === undefined ? 'reported back' : `reported back · ${entry.summary}`}
                  </span>
                </div>
              ) : entry.kind === 'shell' ? (
                /*
                 * A command row opens onto what the command PRINTED, when the
                 * runtime reported it.
                 *
                 * It was `is-static`: the command, a result word, and no way
                 * to see the output at all. A teammate ran `seq 1 1200`, said
                 * "printed 1 through 1200, one per line", and the row said
                 * `done` — the person could not see one of those lines
                 * (drive-huge-turn, 2026-09-08). The adapter had captured the
                 * output and the entry threw it away.
                 *
                 * Static still, where there is nothing to show. Only the Codex
                 * exec stream reports command output today, so a row that
                 * offered to expand everywhere would be a dead control on the
                 * runtimes that do not — the rule this composer has already
                 * paid for twice. The chevron follows the evidence.
                 */
                /*
                 * The exit code leads, as a badge.
                 *
                 * It used to sit at the far right of the command line, which
                 * is where the eye arrives LAST for the fact that decides
                 * whether any of the output below is worth reading (design,
                 * 2026-09-08). Green for a clean exit, red for a failure, and
                 * it arrives before the thing it is a verdict on.
                 *
                 * A command that printed NOTHING is a static row saying so.
                 * It used to open onto an empty box, which reads as "the app
                 * lost it" rather than "there was none" -- and `undefined`
                 * (the runtime never reported output) and `''` (it reported
                 * none) are different facts, so they get different words.
                 */
                entry.output === undefined || entry.output.trim() === '' ? (
                  <div className="lc-filerow is-shell is-static">
                    <Icon name="terminal" size={14} />
                    <span className={`lc-shellbadge ${shellResultClass(entry)}`}>{shellResult(entry)}</span>
                    <span className="lc-filerow__path">{entry.command}</span>
                    {entry.output !== undefined && entry.settled && (
                      <span className="lc-filerow__result is-muted">no output</span>
                    )}
                  </div>
                ) : (
                  <>
                    <button type="button" className="lc-filerow is-shell" onClick={() => toggle(entry)}>
                      <Icon name="terminal" size={14} />
                      <span className={`lc-shellbadge ${shellResultClass(entry)}`}>{shellResult(entry)}</span>
                      <span className="lc-filerow__path">{entry.command}</span>
                      <span className="lc-activity__chev" aria-hidden="true">
                        <Icon name={isOpen(entry) ? 'chevron-down' : 'chevron-right'} size={12} />
                      </span>
                    </button>
                    {isOpen(entry) && <ShellOutput output={entry.output} failed={entry.failed === true} />}
                  </>
                )
              ) : (
                // An edit the runtime recorded without the change itself. The
                // row says so, in words: silence here would read as "nothing
                // to see", which is the opposite of what happened.
                <div className="lc-filerow is-static">
                  <Icon name={entry.kind === 'tool' ? 'activity' : 'file'} size={14} />
                  <span className="lc-filerow__path">{relativePath(entry.name, workspacePath)}</span>
                  {entry.tool !== undefined && <span className="lc-filerow__status">{entry.tool}</span>}
                  <span className={`lc-filerow__result ${entry.settled ? (entry.failed ? 'is-failed' : 'is-muted') : 'is-running'}`}>
                    {!entry.settled
                      ? 'still running'
                      : entry.failed
                        ? 'failed'
                        : entry.kind === 'tool'
                          ? 'done'
                          : `${runtimeName ?? 'the runtime'} did not report the change`}
                  </span>
                </div>
              )}
            </Fragment>
          ))}
          {revealNotice !== undefined && <p className="lc-filerow__notice">{revealNotice}</p>}
          {/*
            * What the runtime said about this turn, at the foot of the work it
            * is about.
            *
            * These arrive before the first tool call, so the thread's own gate
            * drops them -- Codex comments on its own setup as every turn opens
            * and that belongs nowhere near the top of a conversation. The
            * trace line counted them anyway, as `1 notice`, which meant a
            * number for a sentence that was on no screen at all.
            *
            * Standing register: a left rule, no box, no new species. Amber
            * only where a person may need to act, which is what `level`
            * already distinguishes -- an `info` notice about shortened skill
            * descriptions is not a warning and must not be dressed as one.
            */}
          {notices.map((notice, index) => (
            <p
              key={`notice_${String(index)}`}
              className={`lc-shellnotice lc-tone-${notice.level === 'error' ? 'red' : notice.level === 'warning' ? 'amber' : 'muted'}`}
            >
              {notice.message}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

function shellResult(entry: Extract<ActivityEntry, { kind: 'shell' }>): string {
  if (!entry.settled) return 'running'
  if (entry.failed) return entry.exitCode === undefined ? 'failed' : `failed · exit ${String(entry.exitCode)}`
  return entry.exitCode === undefined ? 'done' : `exit ${String(entry.exitCode)}`
}

function shellResultClass(entry: Extract<ActivityEntry, { kind: 'shell' }>): string {
  if (!entry.settled) return 'is-running'
  return entry.failed ? 'is-failed' : 'is-ok'
}
