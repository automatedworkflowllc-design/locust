import { useRef, useState } from 'react'
import type { ReactElement } from 'react'

import type { AppChangelog, AppChangelogEntry } from '../../../shared/ipc.js'
import { useModal } from '../useModal.js'
import { AgentText } from './ThreadItems.js'

/**
 * WHAT'S NEW -- the whole changelog, the way Claude Code shows its own.
 *
 * Colin, 2026-09-23, with a frame of Claude Code's What's new: "we can really
 * get this and just introduce a proper changelog the way claude code does, if
 * we have really good big updates where the user has to know things, we can
 * have a splash page on update". And before that, of the home banner ("Locust
 * 0.277.0 is running. Here is what changed."): "it adds a needless scrollbar
 * on that title menu".
 *
 * So: every build, newest first -- its date, its version as a small mono
 * badge, its changes under New / Improved / Fixed (entries written before the
 * groups are shown as they were written, not guessed into one) -- in Settings.
 * The banner is gone; a build marked big gets the splash below, once.
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/**
 * `2026-09-23` as "September 23, 2026". Read from the digits, never through
 * `Date`: midnight UTC is the evening before anywhere west of Greenwich.
 */
export function changelogDate(date: string | undefined): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '')
  const month = match === null ? undefined : MONTHS[Number(match[2]) - 1]
  if (match === null || month === undefined) return date
  return `${month} ${String(Number(match[3]))}, ${match[1] ?? ''}`
}

/** One build: its date and version, then its changes by group. */
export function ReleaseNotes({ entry }: { readonly entry: AppChangelogEntry }): ReactElement {
  return (
    <article className="lc-release" data-version={entry.version}>
      <header className="lc-release__head">
        <h3 className="lc-release__date">{changelogDate(entry.date) ?? `Version ${entry.version}`}</h3>
        <span className="lc-release__version lc-mono">{entry.version}</span>
      </header>
      {entry.groups.map((group, index) => (
        <section key={`${group.label ?? ''}${String(index)}`} className="lc-release__group">
          {group.label !== undefined && <p className="lc-release__label lc-mono">{group.label}</p>}
          <div className="lc-release__text">
            <AgentText text={group.text} streaming={false} />
          </div>
        </section>
      ))}
    </article>
  )
}

/** Builds shown at first, and how many more each press adds: 390 entries drawn at once is a long first paint. */
export const WHATS_NEW_PAGE = 12
const WHATS_NEW_MORE = 30

export function WhatsNew({ changelog }: { readonly changelog: AppChangelog | undefined }): ReactElement {
  const [shown, setShown] = useState(WHATS_NEW_PAGE)
  if (changelog === undefined) return <p className="lc-settings__note">Reading what changed…</p>
  const all = changelog.entries ?? []
  if (all.length === 0) return <p className="lc-settings__note">This build shipped without its changelog.</p>
  return (
    <div className="lc-whatsnew">
      {all.slice(0, shown).map((entry) => (
        <ReleaseNotes key={entry.version} entry={entry} />
      ))}
      {shown < all.length && (
        <button type="button" className="lc-button lc-whatsnew__more" onClick={() => setShown((count) => count + WHATS_NEW_MORE)}>
          Show older versions
        </button>
      )}
    </div>
  )
}

/**
 * The splash: after an update that is marked big, once, on the home screen.
 * Only those builds -- the rest are a press away in Settings.
 */
export function WhatsNewSplash({
  entries,
  onSeeEverything,
  onClose
}: {
  readonly entries: readonly AppChangelogEntry[]
  readonly onSeeEverything: () => void
  readonly onClose: () => void
}): ReactElement {
  const box = useRef<HTMLDivElement>(null)
  useModal(box, onClose)
  return (
    <div className="lc-scrim">
      <div ref={box} className="lc-dialog lc-whatsnew__splash" role="dialog" aria-modal="true" aria-labelledby="lc-whatsnew-title">
        <div className="lc-dialog__head">
          <span className="lc-dialog__title" id="lc-whatsnew-title">
            What’s new in Locust
          </span>
          <button type="button" className="lc-dialog__close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="lc-dialog__body">
          {entries.map((entry) => (
            <ReleaseNotes key={entry.version} entry={entry} />
          ))}
        </div>
        <div className="lc-dialog__foot">
          <button type="button" className="lc-button" onClick={onSeeEverything}>
            See every version
          </button>
          <button type="button" className="lc-primarybutton" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}
