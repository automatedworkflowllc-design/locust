import { useState } from 'react'
import type { ReactElement } from 'react'

import type { PublicRuntimeStatus } from '../../../shared/ipc.js'
import mark from '../assets/locust-mark.svg'
import wordmark from '../assets/locust-wordmark.svg'
import { connectedRuntimeCount, integrationOf, routeRowStatus, runtimeIsUsable } from '../status.js'
import { FREE_START_RUNTIME, installCommand, installSentence, runtimeInstallFacts, signInCommand } from '../../../shared/runtime-install.js'

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
/**
 * Ask the host to open one of the addresses it allows.
 *
 * These used to be `<a target="_blank">`, which does nothing in this app:
 * the host denies `window.open` outright and cancels navigation away from
 * its own URL, on purpose, because `openExternal` bypasses every egress
 * rule the packaged build has. So every "Get it" link ever shipped was
 * dead -- it looked like a link, it had a cursor, and nothing happened.
 * Found by the first outside tester on 0.55.0.
 *
 * A button rather than an anchor, because that is what it is: it makes a
 * request the host may refuse, and it never navigates.
 */
function openLink(url: string): void {
  void window.desktop?.openLink(url)
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
  installLog,
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
  /**
   * Everything npm has said for the install now running. The line above is
   * the last of these; this is what `Show output` opens onto.
   */
  readonly installLog?: readonly string[]
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
  // Stays open across subsequent installs once a person opens it, which is
  // what the design asks for: someone who wanted the trace once wants it
  // for the next one too.
  const [outputOpen, setOutputOpen] = useState(false)
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
                  {settled ? (
                    // CONNECTED. Whatever caveat the tag carries -- and
                    // EXPERIMENTAL is exactly that, "the caveat on a runtime
                    // that IS connected" -- the runtime is already here, so
                    // this slot says which build, never how to get one.
                    // Antigravity fell past the READY/ACTIVE test to the
                    // vendor branch and offered "Get it ↗" beside its own
                    // green dot (Colin, 2026-09-07: "antigravity listed as
                    // get it, pretty sure we have it"). A row cannot say
                    // connected and not-installed at the same time.
                    runtime.version === undefined || runtime.version === null ? (
                      // `version` is `string | null`, so `=== undefined` alone
                      // never fired and a connected runtime with no version
                      // drew an empty slot instead of its caveat -- on
                      // Antigravity, the runtime this branch exists for.
                      <span className="lc-runtimecell__tag">{status.tag}</span>
                    ) : (
                      <span className="lc-runtimecell__version">{shortVersion(runtime.version)}</span>
                    )
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
                  ) : runtime.installed ? (
                    // Installed, but not answering yet. CHECKING is a moment,
                    // not a verdict -- Claude Code's first probe can outlast
                    // the window on a cold start -- and offering to install
                    // what is already installed is the contradiction 0.38.6
                    // fixed for connected runtimes and missed for this one.
                    <span className="lc-runtimecell__tag">{status.tag}</span>
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
                    <button
                      type="button"
                      className="lc-runtimecell__install"
                      onClick={() => openLink(vendorUrl(runtime.id) ?? '')}
                      title={`Open ${vendorUrl(runtime.id) ?? ''} in your browser`}
                    >
                      Get it ↗
                    </button>
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
        {/*
          * Said whenever npm is missing, not only when NOTHING is connected.
          *
          * This was gated on `connected === 0`, so the moment one runtime
          * happened to be found -- Codex signs itself in on many machines --
          * the sentence explaining why every Install button is switched off
          * disappeared, and the reason survived only in a tooltip. The first
          * outside tester on 0.55.0 had exactly that: Codex connected, every
          * other row offering a button that "does nothing", and no visible
          * reason anywhere. A disabled control has to say why it is disabled
          * on the screen, not on hover.
          */}
        {discoveryPhase === 'ready' && npmMissing && (
          <p className="lc-installnote lc-tone-amber">
            Node.js is not on this machine, so the Install buttons below cannot run.{' '}
            <button type="button" className="lc-linkbutton" onClick={() => openLink('https://nodejs.org')}>
              Get Node.js ↗
            </button>
          </p>
        )}
        {installFailure !== undefined && (
          <div className="lc-installnote lc-installnote--failed" role="alert">
            <div className="lc-installnote__what">{installFailure.what}</div>
            <div className="lc-installnote__next">{installFailure.next}</div>
            {(installLog?.length ?? 0) > 0 && (
              <>
                {/*
                  * On a failure the trace is the thing worth reading, so the
                  * disclosure is here too -- and the LAST lines usually name
                  * the cause, which is what the unknown-failure copy tells
                  * people to look for.
                  */}
                <button
                  type="button"
                  className="lc-ghostbutton"
                  aria-expanded={outputOpen}
                  onClick={() => setOutputOpen(!outputOpen)}
                >
                  {outputOpen ? 'Hide output' : 'Show output'}
                </button>
                {outputOpen && (
                  <pre className="lc-installoutput lc-mono">{installLog?.join('\n')}</pre>
                )}
              </>
            )}
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
          <div className="lc-installnote">
            {/*
              * What is being run, while it runs. It used to appear only after
              * a failure, so a person watching a 90-second install had no way
              * to know what it was doing or to run it themselves instead.
              */}
            {installing !== undefined && installCommand(installing) !== undefined && (
              <code className="lc-installnote__running lc-mono">{installCommand(installing)}</code>
            )}
            <div className="lc-installnote__live">
              <span className="lc-mono lc-installnote__lastline">{installLine}</span>
              {(installLog?.length ?? 0) > 0 && (
                <button
                  type="button"
                  className="lc-ghostbutton"
                  aria-expanded={outputOpen}
                  onClick={() => setOutputOpen(!outputOpen)}
                >
                  {outputOpen ? 'Hide output' : 'Show output'}
                </button>
              )}
            </div>
            {/*
              * npm's own words, bounded and scrollable. The elapsed count in
              * the line above is the honest substitute for a progress bar --
              * npm reports nothing that can become a percentage -- and this
              * is for the person who wants to know WHAT it is doing, or who
              * needs to hand the trace to somebody else.
              */}
            {outputOpen && (
              <pre className="lc-installoutput lc-mono">{installLog?.join('\n')}</pre>
            )}
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
