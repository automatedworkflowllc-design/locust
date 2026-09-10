import type { ReactElement } from 'react'

import type { PublicRuntimeArtifact } from '../../../shared/ipc.js'

/**
 * What a person set up inside one runtime's own CLI, listed under it.
 *
 * These lived on the Automations screen, and that was the real reason the
 * screen taught the wrong lesson (design agent, 2026-09-10): the shelf held
 * two species. **Routines are yours to run. These are facts about a runtime's
 * own config file.** They share only the word "automation", and putting the
 * second under a heading that otherwise means *things you can run* is what
 * made the inertness read as brokenness — a Run button on one would be a
 * promise the app cannot keep.
 *
 * Under the runtime, in Settings, no apology is needed: nobody expects to run
 * something from a Settings row. Same rule that puts the `mcp` row here
 * rather than behind the composer's `+` — anything that is a fact about a
 * runtime's own config lives under that runtime.
 */
export function CliArtifacts({
  artifacts
}: {
  /** Already narrowed to one runtime by the caller. */
  readonly artifacts: readonly PublicRuntimeArtifact[]
}): ReactElement | null {
  if (artifacts.length === 0) return null
  return (
    <div className="lc-cliartifacts">
      <div className="lc-cliartifacts__note lc-mono">Set up in this CLI · Locust lists these, it does not run them</div>
      {artifacts.map((entry) => (
        <div className="lc-cliartifacts__row" key={`${entry.runtime}/${entry.kind}/${entry.path}`}>
          <span className="lc-cliartifacts__kind lc-mono">{entry.kind}</span>
          <span className="lc-cliartifacts__name">{entry.name}</span>
          {entry.description !== undefined && <span className="lc-cliartifacts__desc">{entry.description}</span>}
          {/*
            * The last two segments, not the whole path. A full Windows path is
            * far wider than this row and ran off the right edge of the window
            * (screenshot, 2026-09-07); `agents/gig-scout.md` is the part that
            * answers "where do I change it", and the whole thing is on hover.
            */}
          <span className="lc-cliartifacts__path lc-mono" title={entry.path}>
            {entry.path.split(/[\\/]/).slice(-2).join('/')}
          </span>
        </div>
      ))}
    </div>
  )
}
