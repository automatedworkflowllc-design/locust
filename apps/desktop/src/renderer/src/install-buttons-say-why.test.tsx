import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { LocalRuntimeId, PublicRuntimeStatus } from '../../shared/ipc.js'
import { FirstLaunch } from './components/FirstLaunch.js'

/**
 * A switched-off Install button says why on the screen, not on hover.
 *
 * Reported by the first outside tester on 0.55.0, in their own words: "it
 * shows up as either get it or install but they do nothing", and "one of
 * them is highlighted green but still no difference". They also said, in the
 * same breath, "it automatically connected with codex" — which is the whole
 * bug.
 *
 * Four of the five runtimes install through npm, so with no Node.js on the
 * machine every Install button is correctly disabled. The sentence saying so
 * was gated on `connected === 0`. Codex signs itself in on many machines, so
 * the moment it was found the count stopped being zero, the explanation
 * disappeared, and the reason survived only in a `title` tooltip. What is
 * left is a panel of buttons that do nothing, with nothing on screen to say
 * why — which is exactly what was described.
 *
 * The green one is the free runtime's primary Install button, disabled like
 * all the others and looking the most pressable of the lot.
 */

/** A real status record rather than a cast, so a field added upstream fails here. */
const runtime = (id: LocalRuntimeId, name: string, connected: boolean): PublicRuntimeStatus => ({
  id,
  displayName: name,
  installed: connected,
  version: connected ? '1.0.0' : null,
  auth: connected ? 'authenticated' : 'unknown',
  ready: connected,
  status: connected ? 'ready' : 'not-installed'
})

function panel(options: { connected: number; npmMissing: boolean }): string {
  // One connected runtime standing in for Codex, plus ones that are not.
  const runtimes = [
    runtime('codex', 'Codex', options.connected > 0),
    runtime('claude', 'Claude Code', false),
    runtime('opencode', 'OpenCode', false),
    runtime('cursor', 'Cursor', false)
  ]
  return renderToStaticMarkup(
    <FirstLaunch
      runtimes={runtimes}
      limitedRuntimes={new Map()}
      discoveryPhase="ready"
      workspacePath="C:\\work"
      teammateCount={1}
      onChooseFolder={() => undefined}
      onInstall={() => undefined}
      npmMissing={options.npmMissing}
    />
  )
}

describe('when Node.js is missing', () => {
  it('renders the panel at all', () => {
    // The control. A panel that threw or drew nothing would satisfy every
    // `not.toContain` below.
    expect(panel({ connected: 0, npmMissing: true })).toContain('Install')
  })

  it('says so even after a runtime has connected', () => {
    /*
     * THE regression. With Codex connected the count is 1, and the sentence
     * explaining every disabled button vanished.
     */
    const withCodex = panel({ connected: 1, npmMissing: true })
    expect(withCodex).toContain('Node.js is not on this machine')
    expect(withCodex).toContain('cannot run')
  })

  it('still says so when nothing at all has connected', () => {
    expect(panel({ connected: 0, npmMissing: true })).toContain('Node.js is not on this machine')
  })

  it('says nothing about Node when npm is there', () => {
    expect(panel({ connected: 1, npmMissing: false })).not.toContain('Node.js is not on this machine')
  })

  it('offers a way to get Node that this app can actually open', () => {
    const withCodex = panel({ connected: 1, npmMissing: true })
    expect(withCodex).toContain('Get Node.js')
    // Not an anchor. The host denies window.open and cancels navigation, so
    // the link that was here did nothing at all -- and it was the only way
    // out offered to the person who had no Node.
    expect(withCodex).not.toContain('<a href="https://nodejs.org"')
    expect(withCodex).toContain('lc-linkbutton')
  })
})
