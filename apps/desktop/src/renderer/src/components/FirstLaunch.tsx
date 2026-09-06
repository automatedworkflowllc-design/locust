import type { ReactElement } from 'react'

import type { PublicRuntimeStatus } from '../../../shared/ipc.js'
import mark from '../assets/locust-mark.svg'
import wordmark from '../assets/locust-wordmark.svg'
import { connectedRuntimeCount, integrationOf, routeRowStatus, runtimeIsUsable } from '../status.js'
import { FREE_START_RUNTIME, installCommand, installSentence, runtimeInstallFacts } from '../../../shared/runtime-install.js'

/**
 * First run, and the empty state generally.
 *
 * Built to panel A of `FIRST-RUN-2026-09-04.md`, which Colin ratified on
 * 2026-09-05 ("do it exactly this way besides that send button"): the mark
 * in its own bordered card, two mono lines of claim, and the runtimes as ONE
 * panel in TWO COLUMNS with hairline dividers -- a dot, a name, a version,
 * nothing else. The two columns are also what stops six rows stacking into a
 * tower that pushes the composer off the bottom of the window.
 *
 * What the reference does not know about, and this does: a runtime can be
 * installed but signed out, at its account limit, or experimental. READY
 * needs no tag once its dot is green, so only the exception is tagged --
 * which is the reference's own rule, applied to more exceptions than it drew.
 */
/** The line a person runs once to sign in, when the runtime needs an account. */
function signInCommand(runtime: string): string | undefined {
  const facts = runtimeInstallFacts(runtime)
  return facts?.signIn === undefined ? undefined : `run ${facts.signIn}`
}

/** Where a runtime that is not a package comes from. */
function vendorUrl(runtime: string): string | undefined {
  const facts = runtimeInstallFacts(runtime)
  return facts !== undefined && facts.install.kind === 'vendor' ? facts.install.url : undefined
}

export function FirstLaunch({
  runtimes,
  limitedRuntimes,
  discoveryPhase,
  workspacePath,
  teammateCount,
  onChooseFolder,
  onInstall,
  installing,
  installLine,
  installFailure,
  npmMissing = false
}: {
  readonly runtimes: readonly PublicRuntimeStatus[]
  /** Runtimes whose last run ended on the account's usage limit, with its own words. */
  readonly limitedRuntimes: ReadonlyMap<string, string>
  readonly discoveryPhase: 'loading' | 'ready' | 'error'
  /** The folder the teammates work in; undefined when none is chosen. */
  readonly workspacePath: string | undefined
  readonly teammateCount: number
  readonly onChooseFolder: () => void
  /** Run the install for a runtime. Absent means the panel offers none. */
  readonly onInstall?: (runtime: string) => void
  /** The runtime being installed right now; every other button waits on it. */
  readonly installing?: string
  /** The last line npm printed, with how long it has been going. */
  readonly installLine?: string
  /** What went wrong, and what to do about it. */
  readonly installFailure?: {
    readonly what: string
    readonly next: string
    readonly restart?: boolean
    /** The line the app would have run, kept reachable however it went wrong. */
    readonly command?: string
  }
  /** Node is not on this machine, so four of the five cannot install at all. */
  readonly npmMissing?: boolean
}): ReactElement {
  // Signed-in first, exceptions last -- the reference's own order, and the
  // one that reads: a person scanning this wants "what can I use" before
  // "what is not built yet". Discovery's order is alphabetical by id, which
  // put PLANNED runtimes in the middle of the working ones.
  const rank = (row: { readonly connected: boolean; readonly status: { readonly tag: string } }): number =>
    row.connected ? 0 : row.status.tag === 'PLANNED' ? 2 : 1
  const rows = runtimes
    .map((runtime) => ({
      runtime,
      status: routeRowStatus(runtime, integrationOf(runtime.id), false, limitedRuntimes.get(runtime.id)),
      // The SAME question the rail footer asks -- "can this run work for me
      // right now" -- so the two numbers on this screen cannot disagree.
      // They did: the claim line counted READY tags (5) while the footer
      // counted usable runtimes (6), because Antigravity is connected and
      // wears EXPERIMENTAL rather than READY. One screen, one definition;
      // the caveat rides on the tag, where it belongs.
      connected: runtimeIsUsable(runtime) && integrationOf(runtime.id) !== 'planned'
    }))
    .sort((left, right) => rank(left) - rank(right))
  // A planned runtime cannot be connected by anyone, so it is not in the
  // count's denominator and not in the panel: it is named once, under it
  // (design review, 2026-09-05: "a progress meter the user can't complete").
  const connected = connectedRuntimeCount(runtimes)
  const shownAll = rows.filter((row) => integrationOf(row.runtime.id) !== 'planned')
  // On a machine with nothing connected, the row that is a complete answer
  // leads. Once anything works, rank() already puts connected first and this
  // steps out of the way.
  const shown =
    connected === 0
      ? [...shownAll].sort((left, right) =>
          left.runtime.id === FREE_START_RUNTIME ? -1 : right.runtime.id === FREE_START_RUNTIME ? 1 : 0
        )
      : shownAll
  const planned = rows.filter((row) => integrationOf(row.runtime.id) === 'planned').map((row) => row.runtime.displayName)
  const anyReady = discoveryPhase === 'ready' && connected > 0
  void teammateCount
  // A build stamp with a commit hash is a fact for a changelog, not a
  // status panel: "2026.09.02-c22c1a3" reads as its date.
  const shortVersion = (version: string | null | undefined): string => (version === undefined || version === null ? '' : version.replace(/-[0-9a-f]{6,}$/i, ''))

  return (
    <div className="lc-empty">
      <div className="lc-empty__inner">
        {/* The mark in its own card, at the reference's sizes. */}
        <div className="lc-markcard">
          <img className="lc-markcard__mark" src={mark} alt="" />
          <img className="lc-markcard__wordmark" src={wordmark} alt="Locust" />
        </div>

        {/*
          * The only words on the screen, both carrying information: what
          * discovery found, and what the app promises about it. Mono, because
          * that reads as machine output rather than marketing -- which is
          * what a local-first tool should sound like.
          */}
        <p className="lc-claim">
          {discoveryPhase === 'loading'
            ? 'checking the runtimes on this machine'
            : discoveryPhase === 'error'
              ? 'runtime discovery could not run — no credentials were read'
              : `${String(connected)} runtime${connected === 1 ? '' : 's'} connected`}
          <br />
          nothing pooled, proxied, or sent anywhere you have not connected
        </p>
        {/*
          * A fresh machine: six tags and no next step read as a wall (first-run
          * drive, 2026-09-06). One sentence says what Locust runs and what to do.
          */}
        {discoveryPhase === 'ready' && connected === 0 && (
          <p className="lc-claim lc-claim--hint">
            {/*
              * The names came off: the panel below lists them WITH their
              * state, which a sentence cannot. And the second line stopped
              * being generic advice -- "install one, sign in" is wrong about
              * the one path that needs no sign-in, which is the only path a
              * person with nothing installed can complete today
              * (FIRST-RUN-INSTALL-DESIGN, 2026-09-06).
              */}
            Locust runs the coding agents you install and sign in to.
            <br />
            OpenCode needs no account — one install and you have a working teammate.
          </p>
        )}

        {/*
          * The folder card itself lives in Settings and on the composer's own
          * chip -- this screen is about what is connected (Colin, 2026-09-05).
          * What stays is the one case where the screen would otherwise invite
          * a mission that cannot start: no folder chosen, which is what an
          * installed app launched from its own install folder begins as.
          */}
        {workspacePath === undefined && (
          <div className="lc-folder is-missing">
            <div className="lc-folder__text">
              <div className="lc-folder__label">No folder chosen</div>
              <div className="lc-folder__path">
                Every teammate works inside one project folder. Pick it before the first mission.
              </div>
            </div>
            <button type="button" className="lc-button" onClick={onChooseFolder}>
              Choose folder
            </button>
          </div>
        )}

        {discoveryPhase === 'ready' && (
          <div className="lc-runtimepanel">
            {shown.map(({ runtime, status, connected: usable }) => {
              const settled = usable
              // The one runtime that is a complete answer on its own -- no
              // account, no sign-in, a free model -- leads and spans both
              // columns, but only while nothing is connected. The moment
              // anything works this is a status panel again and the emphasis
              // would be selling to someone who has already bought.
              const onRamp = !settled && connected === 0 && runtime.id === FREE_START_RUNTIME
              return (
                <div
                  className={`lc-runtimecell${settled ? ' is-ready' : ''}${onRamp ? ' is-onramp' : ''}`}
                  key={runtime.id}
                >
                  <span className={`lc-runtimecell__dot${settled ? ' is-green' : status.tag === 'SIGN IN' ? ' is-red' : ' is-muted'}`} />
                  <span className="lc-runtimecell__name" title={status.detail}>
                    {runtime.displayName}
                  </span>
                  {!settled && connected === 0 && runtime.id === FREE_START_RUNTIME && (
                    <span className="lc-runtimecell__free">no account needed</span>
                  )}
                  {/* READY needs no tag once the dot is green; every other
                    * state does, connected or not -- EXPERIMENTAL is the
                    * caveat on a runtime that IS connected. */}
                  {status.tag === 'READY' || status.tag === 'ACTIVE' ? (
                    <span className="lc-runtimecell__version">{shortVersion(runtime.version)}</span>
                  ) : installing === runtime.id ? (
                    // Keeps its box rather than becoming a spinner, so the row
                    // does not resize while npm talks.
                    <span className="lc-runtimecell__tag">Installing…</span>
                  ) : signInCommand(runtime.id) !== undefined && status.tag === 'SIGN IN' ? (
                    // Installed and signed out: the last wall, and the one
                    // thing no button can climb. Signing in is a browser
                    // handshake or a device code; a button that opened a
                    // terminal and walked away would be worse than the
                    // sentence telling them what to type. Locust notices when
                    // it is done on its own -- discovery re-runs and the dot
                    // goes green.
                    <span className="lc-runtimecell__signin lc-mono">{signInCommand(runtime.id)}</span>
                  ) : installCommand(runtime.id) !== undefined && onInstall !== undefined ? (
                    <button
                      type="button"
                      className={`lc-runtimecell__install${runtime.id === FREE_START_RUNTIME ? ' is-primary' : ''}`}
                      disabled={installing !== undefined || npmMissing}
                      title={
                        npmMissing
                          ? 'Node.js is not on this machine, and this installs through npm.'
                          : installing !== undefined
                            ? `Waiting for the ${installing} install to finish`
                            : installSentence(runtime.id, runtime.displayName)
                      }
                      onClick={() => onInstall(runtime.id)}
                    >
                      Install
                    </button>
                  ) : vendorUrl(runtime.id) !== undefined ? (
                    // Not a package, and not second-class either: the same
                    // slot, the same box, one different word.
                    <a className="lc-runtimecell__install" href={vendorUrl(runtime.id)} target="_blank" rel="noreferrer">
                      Get it ↗
                    </a>
                  ) : (
                    <span className="lc-runtimecell__tag">{status.tag}</span>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/*
          * ONE line under the panel, because only one install ever runs.
          *
          * At rest it is the command that would run, said before anything
          * happens rather than after -- an app that is about to run
          * `npm install -g` shows the line unprompted. While an install runs
          * it carries npm's last line, which is what makes forty seconds look
          * alive without turning the screen into a terminal. There is no
          * progress bar: npm reports nothing that honestly becomes a
          * percentage, so the screen shows the number it actually has.
          */}
        {discoveryPhase === 'ready' && connected === 0 && npmMissing && (
          <p className="lc-installnote lc-tone-amber">
            Node.js is not on this machine. Four of these five install through npm, which comes with it.{' '}
            <a href="https://nodejs.org" target="_blank" rel="noreferrer">Get Node.js ↗</a>
          </p>
        )}
        {installFailure !== undefined && (
          <div className="lc-installnote lc-installnote--failed" role="alert">
            <div className="lc-installnote__what">{installFailure.what}</div>
            <div className="lc-installnote__next">{installFailure.next}</div>
            {/*
              * THE COMMAND NEVER DISAPPEARS. It stops being the only option;
              * on a failure it is the option that works, because a person who
              * cannot read an npm trace can paste that line to someone who
              * can (FIRST-RUN-INSTALL-DESIGN, 2026-09-06).
              */}
            {installFailure.command !== undefined && (
              <div className="lc-installnote__command">
                <code className="lc-mono">{installFailure.command}</code>
                <button
                  type="button"
                  className="lc-runtimecell__install"
                  onClick={() => {
                    void navigator.clipboard?.writeText(installFailure.command ?? '').catch(() => undefined)
                  }}
                >
                  Copy
                </button>
              </div>
            )}
          </div>
        )}
        {installLine !== undefined && installFailure === undefined && (
          <p className="lc-installnote lc-mono">{installLine}</p>
        )}

        {/*
          * The privacy claim is made once, in the claim line above; the
          * instruction to pick a teammate is the sidebar's (its missions
          * empty state says it) -- the review found both said twice.
          */}
        {discoveryPhase === 'ready' && planned.length > 0 && (
          <p className="lc-footnote">coming soon: {planned.join(', ')}</p>
        )}
        {!anyReady && discoveryPhase === 'ready' && (
          <p className="lc-footnote">Discovery runs locally · no model is shown as live until it answers</p>
        )}
      </div>
    </div>
  )
}
