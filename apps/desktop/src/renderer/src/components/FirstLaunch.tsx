import type { ReactElement } from 'react'

import type { PublicRuntimeStatus } from '../../../shared/ipc.js'
import logo from '../assets/locust-logo.svg'
import { integrationOf, routeRowStatus } from '../status.js'

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
  return (
    <div className="lc-empty">
      <div className="lc-empty__inner">
        <div className="lc-empty__logo">
          <img src={logo} alt="Locust" />
        </div>
        {/*
          * The headline has to describe the state a person is actually in.
          * It read "Connect a runtime to start working" unconditionally, so
          * on a machine with six runtimes already signed in and marked READY
          * it opened by asking for the one thing that was already done --
          * measured on a first run, 2026-09-03. When something can run, the
          * next move is to type a mission, and that is what it says.
          */}
        <h1>{anyReady ? 'Ready when you are' : 'Connect a runtime to start working'}</h1>
        <p>
          {anyReady
            ? 'Describe a mission in the box below and it runs here, recorded as it goes. Locust uses the accounts and models already on this machine — nothing is pooled, proxied, or sent anywhere you have not connected.'
            : 'Locust runs on the accounts and models already on this machine. Nothing is pooled, proxied, or sent anywhere you have not connected.'}
        </p>

        {discoveryPhase === 'loading' && <p className="lc-footnote">Checking local runtimes…</p>}
        {discoveryPhase === 'error' && (
          <p className="lc-footnote lc-tone-red">
            Runtime discovery could not run. No credentials were read.
          </p>
        )}

        {discoveryPhase === 'ready' && (
          <div className="lc-runtimelist">
            {runtimes.map((runtime) => {
              const status = routeRowStatus(runtime, integrationOf(runtime.id), false, limitedRuntimes.get(runtime.id))
              return (
                <div
                  key={runtime.id}
                  className={`lc-runtimerow${status.tag === 'READY' || status.tag === 'ACTIVE' ? ' is-ready' : ''}`}
                >
                  <div className="lc-runtimerow__text">
                    <div className="lc-runtimerow__name">{runtime.displayName}</div>
                    <div className="lc-runtimerow__detail">
                      {runtime.version !== null && (
                        <>
                          <span className="lc-mono">{runtime.version}</span>{' · '}
                        </>
                      )}
                      {status.detail}
                    </div>
                  </div>
                  <span
                    className={`lc-tag${
                      status.tag === 'READY' || status.tag === 'ACTIVE'
                        ? ' is-lime'
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
              )
            })}
          </div>
        )}

        <p className="lc-footnote">
          Discovery runs locally · no model is shown as live until it answers
        </p>
      </div>
    </div>
  )
}
