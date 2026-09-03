import { Fragment, useState } from 'react'
import type { ReactElement } from 'react'

import { activityCounts, activityEntries, defaultOpenEntry, relativePath } from '../missionView.js'
import type { ActivityDetail, ActivityEntry } from '../missionView.js'
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
export function ActivityCard({
  summary,
  details,
  runtimeName,
  workspacePath
}: {
  readonly summary: string
  readonly details: readonly ActivityDetail[]
  readonly runtimeName: string | undefined
  /** The folder this mission ran in, so paths read the way a person writes them. */
  readonly workspacePath: string | undefined
}): ReactElement {
  const [open, setOpen] = useState(false)
  const entries = activityEntries(details)
  const counts = activityCounts(details)
  const anyPatch = entries.some((entry) => entry.kind === 'file')
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(() => new Map())
  const initiallyOpen = defaultOpenEntry(entries)
  const isOpen = (entry: ActivityEntry): boolean => toggled.get(entry.key) ?? entry.key === initiallyOpen
  const toggle = (entry: ActivityEntry): void => {
    const next = new Map(toggled)
    next.set(entry.key, !isOpen(entry))
    setToggled(next)
  }

  return (
    <div className="lc-card">
      <button type="button" className="lc-activity" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon name="diff" size={14} />
        <span>{summary}</span>
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
          {entries.map((entry) => (
            <Fragment key={entry.key}>
              {entry.kind === 'file' ? (
                <>
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
                  {isOpen(entry) && <DiffView file={entry.file} truncated={entry.truncated} reported={entry.reported} />}
                </>
              ) : entry.kind === 'shell' ? (
                <div className="lc-filerow is-shell is-static">
                  <Icon name="terminal" size={14} />
                  <span className="lc-filerow__path">{entry.command}</span>
                  <span className={`lc-filerow__result ${shellResultClass(entry)}`}>{shellResult(entry)}</span>
                </div>
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
