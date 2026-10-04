import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'

import mark from '../assets/locust-mark.svg'
import wordmark from '../assets/locust-wordmark.svg'
import type { BootPhase, BootRow, BootView } from '../bootView.js'

/**
 * What discovery is doing, while it is doing it.
 *
 * Colin, 2026-09-14: *"i just wanted something cool to keep the users
 * attention as the runtimes connect, sometimes it takes a while."* So this
 * earns its keep in the SLOW case. On a fast machine it is a flash and the
 * person is straight into the app, which is the right outcome and not a
 * wasted one -- the animation is a way of ENDING a wait, never a reason to
 * have one.
 *
 * It lives in the CONTENT PANE and nothing else. It never covers the
 * sidebar, the title bar or the composer, which is what makes "every launch"
 * safe: a person can click a teammate, open Settings or start typing while
 * it is still probing. The ceremony is free because it occupies space that
 * was empty anyway. Moving it to a full-window takeover would break that.
 *
 * Everything drawn comes from real discovery events. Nothing is invented and
 * no line is typed out that the app already has in full.
 */

/**
 * THE SETTLE IS A SUBTRACTION.
 *
 * The runtime rows are the same DOM rows from the moment each probe starts
 * until the screen dissolves. They never move. What changes is that
 * everything which was only ever PROCESS goes away around them: the preamble
 * collapses, `$` and `--version` shrink to zero width, the binary name
 * cross-fades to the product name, leader dots draw in, and the result ends
 * up at the right edge because the space in front of it closed.
 *
 * Nothing animates INTO place; place is where it already was. A cross-fade
 * into a separate table would ask a new person to re-find five facts they
 * had just watched arrive.
 */
function Row({ row, settling, reduced }: { readonly row: BootRow; readonly settling: boolean; readonly reduced: boolean }): ReactElement {
  return (
    <div className={`lc-boot__row is-${row.tone}${settling ? ' is-settled' : ''}${reduced ? ' is-instant' : ''}`}>
      <span className="lc-boot__dot" aria-hidden="true" />
      <span className="lc-boot__prompt" aria-hidden="true">
        $
      </span>
      <span className="lc-boot__name">
        <span className="lc-boot__bin">{row.bin}</span>
        <span className="lc-boot__product">{row.product}</span>
      </span>
      <span className="lc-boot__arg" aria-hidden="true">
        --version
      </span>
      <span className="lc-boot__leader" aria-hidden="true">
        {'·'.repeat(40)}
      </span>
      {row.result === undefined && !settling && (
        // A pulsing block while this one is out, and the count beside it.
        // Past six seconds the count stops being reassurance and says so.
        <>
          <span className="lc-boot__wait" aria-hidden="true" />
          {/*
            * "still waiting", not "has not answered".
            *
            * The first wording said the runtime had not answered, which
            * reads as a failure -- and Colin watched Cursor say it and then
            * appear green in the table underneath: "cursor and copilot
            * showing as struggling to connect but they are showing green on
            * the screen after". A slow answer is not a refusal, and the
            * elapsed count is kept beside it so the line still says how
            * long rather than only that it is long.
            */}
          <span className="lc-boot__elapsed">
            {row.stalled ? `still waiting · ${row.elapsed}` : row.elapsed}
          </span>
        </>
      )}
      <span className="lc-boot__result">{row.result ?? ''}</span>
    </div>
  )
}

export function BootScreen({
  view,
  tube,
  onSkip
}: {
  readonly view: BootView
  /** A person will see this hundreds of times, so it is a real preference. */
  readonly tube: 'full' | 'subtle' | 'off'
  readonly onSkip: () => void
}): ReactElement {
  const terminal = useRef<HTMLDivElement>(null)
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(query.matches)
    const listen = (): void => setReduced(query.matches)
    query.addEventListener('change', listen)
    return () => query.removeEventListener('change', listen)
  }, [])

  /*
   * Pinned to the bottom, not clipped.
   *
   * The screen is a fixed size and the log is not. Clipping hides the newest
   * line, which on a boot log is the only one anybody is waiting for. Once
   * settled the preamble has collapsed and the content fits, so the pin is a
   * no-op rather than a fight.
   */
  useEffect(() => {
    const element = terminal.current
    if (element !== null) element.scrollTop = element.scrollHeight
  })

  const settling = view.phase === 'settling' || view.phase === 'settled' || view.phase === 'dissolving'

  return (
    <div
      className={`lc-boot is-tube-${tube}${view.phase === 'dissolving' ? ' is-dissolving' : ''}${reduced ? ' is-instant' : ''}`}
      // Dismissible by clicking anywhere in the pane: somebody who has seen
      // this two hundred times should not have to wait for it.
      onClick={onSkip}
      role="presentation"
    >
      <div className="lc-boot__bezel">
        <div className="lc-boot__screen">
          <span className="lc-boot__scan" aria-hidden="true" />
          <span className="lc-boot__sweep" aria-hidden="true" />
          <span className="lc-boot__vignette" aria-hidden="true" />
          <span className="lc-boot__glare" aria-hidden="true" />

          <div className="lc-boot__inner">
            <div className="lc-boot__lockuprow">
              <div className="lc-boot__lockup">
                <img className="lc-boot__mark" src={mark} alt="" />
                <img className="lc-boot__word" src={wordmark} alt="Locust" />
              </div>
            </div>
            <span className="lc-boot__divider" aria-hidden="true" />

            <div
              className={`lc-boot__terminal${settling ? ' is-settled' : ''}`}
              ref={terminal}
              // The log is the status of a thing in progress, so it is read
              // out as one rather than as a decoration.
              role="status"
              aria-live="polite"
            >
              {view.preamble.map((line) => (
                <div className={`lc-boot__pre is-${line.tone}${settling ? ' is-settled' : ''}`} key={line.key}>
                  <span className="lc-boot__prekey">{line.key}</span>
                  <span className="lc-boot__preval">{line.value}</span>
                  {line.tag !== undefined && <span className="lc-boot__pretag">{line.tag}</span>}
                </div>
              ))}

              {view.rows.map((row) => (
                <Row key={row.bin} row={row} settling={settling} reduced={reduced} />
              ))}

              <div className={`lc-boot__caret${view.rows.length > 0 && view.allAnswered ? ' is-done' : ''}`}>
                <span className="lc-boot__caretlabel">{view.progress}</span>
                <span className="lc-boot__block" aria-hidden="true" />
              </div>

              <div className={`lc-boot__summary${settling ? ' is-settled' : ''}`}>{view.summary}</div>
            </div>
          </div>
        </div>
        <span className={`lc-boot__led${view.phase === 'settled' || view.phase === 'dissolving' ? ' is-done' : ''}`} aria-hidden="true" />
      </div>

    </div>
  )
}

export type { BootPhase }
