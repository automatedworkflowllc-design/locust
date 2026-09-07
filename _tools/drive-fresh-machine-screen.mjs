// The first screen on a machine with nothing installed.
//
//   node _tools/drive-fresh-machine-screen.mjs            (npm present)
//   node _tools/drive-fresh-machine-screen.mjs no-npm     (npm missing too)
//
// This is the screen Ian sees. Its failure states have unit tests and have
// never been looked at, and the "Show output" disclosure the design specifies
// was never built -- so what a new person meets when an install goes wrong is
// the least-examined surface in the app.
//
// Every CLI here is an npm global, and npm's Windows prefix follows %APPDATA%.
// Pointing APPDATA at an empty temp directory therefore hides all of them
// while leaving npm itself on PATH: a fresh machine, without touching the
// real one. Passing `no-npm` also strips Node from PATH, which is the other
// state the screen has to handle.
//
// Nothing is installed and no mission is sent: this only looks.

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { say, scratchRepository, startDrive } from './drive-lib.mjs'

const withoutNpm = process.argv[2] === 'no-npm'
const emptyAppData = await mkdtemp(join(tmpdir(), 'locust-fresh-appdata-'))
const workspace = await scratchRepository('locust-fresh-ws-')

// Keep Windows itself reachable; drop the places CLIs live.
const barePath = ['C:\\Windows\\system32', 'C:\\Windows', 'C:\\Windows\\System32\\Wbem'].join(';')
const nodePath = 'C:\\Program Files\\nodejs'

const drive = await startDrive({
  name: withoutNpm ? 'fresh-machine-no-npm' : 'fresh-machine-screen',
  port: withoutNpm ? 9344 : 9343,
  workspace,
  env: {
    APPDATA: emptyAppData,
    LOCALAPPDATA: emptyAppData,
    PATH: withoutNpm ? barePath : `${nodePath};${barePath}`
  },
  seed: {
    schemaVersion: 1,
    teammates: [],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const SCREEN = `(async () => {
  const flat = (el) => el.innerText.split(/\\s+/).join(' ').trim()
  // Discovery has to finish before the screen means anything.
  for (let i = 0; i < 60; i += 1) {
    await new Promise((r) => setTimeout(r, 1000))
    if (document.querySelector('.lc-runtimepanel')) break
  }
  const panel = document.querySelector('.lc-runtimepanel')
  if (!panel) return 'the runtime panel never appeared'
  const rows = [...panel.querySelectorAll('.lc-runtimecell')].map((cell) => {
    const name = cell.querySelector('.lc-runtimecell__name')
    const dot = cell.querySelector('.lc-runtimecell__dot')
    const action = cell.querySelector('.lc-runtimecell__install, .lc-runtimecell__version, .lc-runtimecell__tag, .lc-runtimecell__signin')
    const button = cell.querySelector('button.lc-runtimecell__install')
    return (name ? flat(name) : '?')
      + ' [' + (dot ? (dot.className.match(/is-\\w+/) ?? ['?'])[0] : 'no dot') + ']'
      + ' -> ' + (action ? flat(action) : 'nothing offered')
      + (button && button.disabled ? ' DISABLED(' + (button.getAttribute('title') ?? 'no reason') + ')' : '')
  })
  return rows.join('  ;;  ')
})()`

try {
  await drive.capture(
    withoutNpm ? 'a machine with no CLIs and no Node' : 'a machine with no CLIs installed',
    async () => {
      await drive.ready()
      return drive.evaluate(SCREEN)
    }
  )

  await drive.capture('what the screen tells them to do', () =>
    drive.evaluate(`(async () => {
      const flat = (el) => el.innerText.split(/\\s+/).join(' ').trim()
      const main = document.querySelector('.lc-firstlaunch, .lc-screen') ?? document.body
      return flat(main).slice(0, 700)
    })()`)
  )
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: withoutNpm
      ? 'The first screen with neither the CLIs nor Node present.'
      : 'The first screen on a machine where none of the CLIs are installed.'
  })
}
