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

function panel(options: { connected: number; npmMissing: boolean; npmIsBundled?: boolean }): string {
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
      npmIsBundled={options.npmIsBundled ?? false}
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

/**
 * And when the app carries its own npm, the buttons are NOT switched off.
 *
 * Ian, 2026-09-17: he downloaded Locust and nothing worked until he
 * installed Node.js. The screen was honest -- every button said why it could
 * not run -- but honest about a limit that did not have to exist. An Electron
 * binary started with ELECTRON_RUN_AS_NODE=1 is a Node runtime (24.18.1 in
 * the packaged build), and npm is a node script, so the app had a working npm
 * the whole time.
 *
 * Measured on a real packaged build, 2026-09-18: that npm installed a package
 * with no Node anywhere on PATH, in one second.
 *
 * What the note must NOT do is overclaim. npm writes launcher shims that call
 * node by name, so the CLI it installs is reachable from Locust and not from
 * the person's own terminal until they install Node themselves.
 */
describe('when this app carries its own npm', () => {
  const carried = panel({ connected: 0, npmMissing: false, npmIsBundled: true })

  it('does not disable a single Install button', () => {
    // The whole point. `npmMissing` is what disables them, and a build that
    // ships npm has no reason to set it.
    expect(carried).toContain('Install')
    expect(carried).not.toContain('disabled=""')
  })

  it('does not tell the person the buttons cannot run', () => {
    expect(carried).not.toContain('cannot run')
  })

  it('says where the install came from, since the buttons working is the surprise', () => {
    expect(carried).toContain('the copy of npm it carries')
  })

  it('says the part that is still true: their own terminal is unchanged', () => {
    // Without this the person installs a CLI, opens a terminal, and finds
    // nothing -- which reads as the install having failed.
    expect(carried).toContain('your own terminal')
    expect(carried).toContain('lc-linkbutton')
  })

  it('says none of it on a machine that has its own Node', () => {
    const ordinary = panel({ connected: 1, npmMissing: false })
    expect(ordinary).not.toContain('the copy of npm it carries')
    expect(ordinary).not.toContain('Node.js is not on this machine')
  })
})
