import type { ReactElement } from 'react'

import type { PublicRuntimeStatus } from '../../../shared/ipc.js'
import logo from '../assets/locust-logo.svg'
import { SIGNED_IN_DETAIL, integrationOf, routeRowStatus } from '../status.js'

/**
 * First launch, and the empty state generally.
 *
 * The reference draws this beside a populated sidebar of working teammates,
 * which would put four fictional colleagues next to "no runtime connected".
 * Here the shell is genuinely empty until something real exists, and every row
 * below reports what discovery actually found -- including that a runtime is
 * installed but signed out, which is a different problem from missing.
 */
export function FirstLaunch({
  runtimes,
  limitedRuntimes,
  discoveryPhase
}: {
  readonly runtimes: readonly PublicRuntimeStatus[]
  /** Runtimes whose last run ended on the account's usage limit, with its own words. */
  readonly limitedRuntimes: ReadonlyMap<string, string>
  readonly discoveryPhase: 'loading' | 'ready' | 'error'
}): ReactElement {
  const anyReady =
    discoveryPhase === 'ready'
    && runtimes.some((runtime) => {
      const tag = routeRowStatus(runtime, integrationOf(runtime.id), false, limitedRuntimes.get(runtime.id)).tag
      return tag === 'READY' || tag === 'ACTIVE'
    })
  // What discovery actually found, as one line. Eight rows are evidence for a
  // claim that needs a count and a way to look, not eight repetitions of one
  // sentence -- and on a 1280x860 window those rows pushed the box you type
  // in below the fold while the copy said "in the box below" (Colin,
  // 2026-09-05; design pass section 5).
  const rows = runtimes.map((runtime) => ({
    runtime,
    status: routeRowStatus(runtime, integrationOf(runtime.id), false, limitedRuntimes.get(runtime.id))
  }))
  const ready = rows.filter((row) => row.status.tag === 'READY' || row.status.tag === 'ACTIVE')
  const roster = `${String(ready.length)} of ${String(rows.length)} runtimes signed in under your own accounts`

  return (
    <div className="lc-empty">
      <div className="lc-empty__inner">
        {/* The mark, not a card holding the mark: a 420x175 bordered box
          * around a logo that is already in the rail 40px away (design pass,
          * 2026-09-04). */}
        <img className="lc-empty__mark" src={logo} alt="Locust" />
        {/*
          * No second greeting. The wordmark above already says the name in
          * the largest type on the screen, so a headline under it was a
          * second voice saying less -- and "Ready when you are" is not
          * information (design pass, 2026-09-04).
          *
          * The headline survives for the one state where it IS information:
          * nothing here can run, and the screen's whole job is to say so.
          * When something can run, the words left are the two that carry
          * something -- what discovery found, and what the app promises about
          * it -- and both sit in the roster line below.
          */}
        {!anyReady && <h1>Connect a runtime to start working</h1>}
        <p>
          {anyReady
            ? 'Nothing is pooled, proxied, or sent anywhere you have not connected.'
            : 'Locust runs on the accounts and models already on this machine. Nothing is pooled, proxied, or sent anywhere you have not connected.'}
        </p>

        {discoveryPhase === 'loading' && <p className="lc-footnote">Checking local runtimes…</p>}
        {discoveryPhase === 'error' && (
          <p className="lc-footnote lc-tone-red">
            Runtime discovery could not run. No credentials were read.
          </p>
        )}

        {discoveryPhase === 'ready' && (
          // Open when nothing is ready -- then the list IS the content and
          // the screen's job is to get a runtime connected. Closed when
          // something can run, because then the job is to get a mission
          // typed and the roster is a footnote.
          <details className="lc-roster" open={!anyReady}>
            <summary className="lc-roster__summary lc-mono">{roster}</summary>
            {/* Said once, above the list, rather than on every signed-in row. */}
            <p className="lc-footnote">{SIGNED_IN_DETAIL}</p>
            <div className="lc-runtimelist">
              {rows.map(({ runtime, status }) => (
                <div
                  key={runtime.id}
                  className={`lc-runtimerow${status.tag === 'READY' || status.tag === 'ACTIVE' ? ' is-ready' : ''}`}
                >
                  <div className="lc-runtimerow__text">
                    <div className="lc-runtimerow__name">{runtime.displayName}</div>
                    <div className="lc-runtimerow__detail">
                      {runtime.version !== null && (
                        <>
                          <span className="lc-mono">{runtime.version}</span>
                          {status.detail === SIGNED_IN_DETAIL ? '' : ' · '}
                        </>
                      )}
                      {status.detail === SIGNED_IN_DETAIL ? '' : status.detail}
                    </div>
                  </div>
                  <span
                    className={`lc-tag${
                      // Lime is "happening right now", and nothing on a first
                      // launch is happening. Green is available, which is
                      // what a signed-in runtime is here (design pass,
                      // objection 5) -- it takes five lime elements off the
                      // calmest screen in the app.
                      status.tag === 'READY' || status.tag === 'ACTIVE'
                        ? ' is-green'
                        : status.tag === 'SIGN IN'
                          ? ' is-red'
                          : status.tag === 'PREVIEW' || status.tag === 'EXPERIMENTAL' || status.tag === 'AT LIMIT'
                            ? ' is-amber'
                            : ''
                    }`}
                  >
                    {status.tag}
                  </span>
                </div>
              ))}
            </div>
          </details>
        )}

        {/* Two claim lines, not three. Once something is signed in, the
          * roster line above already says discovery ran and what it found;
          * this one repeats it in different words. It stays where nothing is
          * ready, because there it is the only account of what happened
          * (design pass: the two lines that carry information). */}
        {!anyReady && (
          <p className="lc-footnote">
            Discovery runs locally · no model is shown as live until it answers
          </p>
        )}
      </div>
    </div>
  )
}
