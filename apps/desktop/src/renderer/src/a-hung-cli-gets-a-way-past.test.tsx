import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PublicRuntimeStatus } from '../../shared/ipc.js'
import { FirstLaunch } from './components/FirstLaunch.js'

/**
 * A CLI that is on the machine and never answers stops blocking the first hour.
 *
 * Grok, pass 11, 2026-09-18: five shims on PATH named for the coding CLIs,
 * each of which sleeps for an hour. Every row read CHECKING, every Install
 * button was gone, and the composer asked for a sign-in beside a row saying
 * no account was needed. Nothing on the screen could change, and a person
 * with an antivirus hold, a half-finished npm or a proxy is that machine.
 *
 * CHECKING is the right word for the first minute: a cold Claude Code probe
 * can outlast the window and it would be wrong to offer an install for what
 * is there. After discovery has asked three more times it is a verdict, and
 * the row says so and offers the one repair the app can perform: Check again.
 */

const hung: PublicRuntimeStatus = {
  id: 'opencode',
  displayName: 'OpenCode',
  installed: true,
  version: null,
  auth: 'unknown',
  ready: false,
  status: 'probe-failed'
}

function panel(options: { gaveUp: boolean }): string {
  return renderToStaticMarkup(
    <FirstLaunch
      runtimes={[hung]}
      limitedRuntimes={new Map()}
      discoveryPhase="ready"
      workspacePath="C:\\work"
      teammateCount={1}
      onChooseFolder={() => undefined}
      onInstall={() => undefined}
      checkingGaveUp={options.gaveUp}
    />
  )
}

describe('an installed CLI that has not answered', () => {
  it('reads CHECKING while discovery is still asking, with no Install offered', () => {
    // The control, and the 0.38.6 rule: offering to install what is there
    // is a contradiction, and one slow probe is not a verdict.
    const early = panel({ gaveUp: false })
    expect(early).toContain('CHECKING')
    expect(early).not.toContain('Check again')
    expect(early).not.toContain('NOT ANSWERING')
  })

  it('says NOT ANSWERING once discovery has given up, and offers Check again -- not Install, which it already is', () => {
    const late = panel({ gaveUp: true })
    expect(late).toContain('NOT ANSWERING')
    expect(late).toContain('Check again')
    // Design agent, 2026-09-18: that CLI is installed; installing it again is
    // not the repair, and would be the one Install on the screen that does
    // something else.
    expect(late).not.toContain('Install again')
    expect(late).not.toContain('CHECKING')
  })

  it('says why, on the control itself', () => {
    expect(panel({ gaveUp: true })).toContain('did not answer its version check in 5 seconds, four times')
  })
})
