import type { ReactElement } from 'react'

import type { PublicRuntimeStatus } from '../../../shared/ipc.js'
import mark from '../assets/locust-mark.svg'
import wordmark from '../assets/locust-wordmark.svg'
import { connectedRuntimeCount, integrationOf, routeRowStatus, runtimeIsUsable } from '../status.js'

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
export function FirstLaunch({
  runtimes,
  limitedRuntimes,
  discoveryPhase,
  workspacePath,
  teammateCount,
  onChooseFolder
}: {
  readonly runtimes: readonly PublicRuntimeStatus[]
  /** Runtimes whose last run ended on the account's usage limit, with its own words. */
  readonly limitedRuntimes: ReadonlyMap<string, string>
  readonly discoveryPhase: 'loading' | 'ready' | 'error'
  /** The folder the teammates work in; undefined when none is chosen. */
  readonly workspacePath: string | undefined
  readonly teammateCount: number
  readonly onChooseFolder: () => void
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
  const shown = rows.filter((row) => integrationOf(row.runtime.id) !== 'planned')
  const planned = rows.filter((row) => integrationOf(row.runtime.id) === 'planned').map((row) => row.runtime.displayName)
  const connected = connectedRuntimeCount(runtimes)
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
            Locust runs the coding agents you install and sign in to — Claude Code, Codex CLI, Cursor Agent, OpenCode, Copilot CLI.
            <br />
            Install one, sign in, and it appears here on its own.
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
              return (
                <div className={`lc-runtimecell${settled ? ' is-ready' : ''}`} key={runtime.id}>
                  <span className={`lc-runtimecell__dot${settled ? ' is-green' : status.tag === 'SIGN IN' ? ' is-red' : ' is-muted'}`} />
                  <span className="lc-runtimecell__name" title={status.detail}>
                    {runtime.displayName}
                  </span>
                  {/* READY needs no tag once the dot is green; every other
                    * state does, connected or not -- EXPERIMENTAL is the
                    * caveat on a runtime that IS connected. */}
                  {status.tag === 'READY' || status.tag === 'ACTIVE' ? (
                    <span className="lc-runtimecell__version">{shortVersion(runtime.version)}</span>
                  ) : (
                    <span className="lc-runtimecell__tag">{status.tag}</span>
                  )}
                </div>
              )
            })}
          </div>
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
