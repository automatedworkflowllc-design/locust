import type { ReactElement } from 'react'

import type { PublicRuntimeStatus } from '../../../shared/ipc.js'
import logo from '../assets/locust-logo.svg'
import { routeRowStatus } from '../status.js'
import type { IntegrationLevel } from '../status.js'

/**
 * First launch, and the empty state generally.
 *
 * The reference draws this beside a populated sidebar of working teammates,
 * which would put four fictional colleagues next to "no runtime connected".
 * Here the shell is genuinely empty until something real exists, and every row
 * below reports what discovery actually found -- including that a runtime is
 * installed but signed out, which is a different problem from missing.
 */
const INTEGRATION: Readonly<Record<string, IntegrationLevel>> = {
  codex: 'live',
  claude: 'preview',
  omniroute: 'planned'
}

export function FirstLaunch({
  runtimes,
  discoveryPhase
}: {
  readonly runtimes: readonly PublicRuntimeStatus[]
  readonly discoveryPhase: 'loading' | 'ready' | 'error'
}): ReactElement {
  return (
    <div className="lc-empty">
      <div className="lc-empty__inner">
        <div className="lc-empty__logo">
          <img src={logo} alt="Locust" />
        </div>
        <h1>Connect a runtime to start working</h1>
        <p>
          Locust runs on the accounts and models already on this machine. Nothing is pooled,
          proxied, or sent anywhere you have not connected.
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
              const status = routeRowStatus(runtime, INTEGRATION[runtime.id] ?? 'planned', false)
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
                          : status.tag === 'PREVIEW'
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
