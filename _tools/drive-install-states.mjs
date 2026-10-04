// The install states, on screen, which nobody has ever looked at.
//
//   node _tools/drive-install-states.mjs
//
// The failure states have unit tests and had never been seen; the `Show
// output` disclosure the design specifies was never built at all
// (FIRST-RUN-INSTALL-DESIGN-2026-09-06 §232). A first outside tester watched
// "Installing... 2s" fail with one sentence and wrote: "Install does not show
// the npm command until it fails; no live npm output."
//
// APPDATA points at an empty directory, which hides every npm-global CLI
// without touching the real machine, so this is a fresh install. The package
// installed is deliberately one that does not exist, so npm fails fast and
// the failure path is what gets photographed -- no real package is fetched
// and nothing is written to the real npm prefix.
//
// Spends no model quota. It does talk to the npm registry.

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { say, scratchRepository, startDrive } from './drive-lib.mjs'

const emptyAppData = await mkdtemp(join(tmpdir(), 'locust-install-appdata-'))
const workspace = await scratchRepository('locust-install-ws-')

const drive = await startDrive({
  name: 'install-states',
  port: 9348,
  workspace,
  // APPDATA alone is not enough: a CLI installed anywhere else on PATH is
  // still discovered. Windows stays reachable and Node stays on PATH,
  // because npm is what the Install button runs.
  env: {
    APPDATA: emptyAppData,
    LOCALAPPDATA: emptyAppData,
    // Unreachable on purpose: npm fails in seconds and the failure states are
    // what this drive exists to look at. Pass `ok` to let it really install.
    ...(process.argv[2] === 'ok' ? {} : { npm_config_registry: 'http://127.0.0.1:1/' }),
    npm_config_fetch_retries: '0',
    PATH: ['C:\\Program Files\\nodejs', 'C:\\Windows\\system32', 'C:\\Windows'].join(';')
  },
  seed: {
    schemaVersion: 1,
    teammates: [],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const READY = `(async () => {
  for (let i = 0; i < 60; i += 1) {
    await new Promise((r) => setTimeout(r, 1000))
    if (document.querySelector('.lc-runtimepanel')) return 'panel up'
  }
  return 'panel never appeared'
})()`

const START_INSTALL = `(async () => {
  const flat = (el) => el.innerText.split(/\\s+/).join(' ').trim()
  const cells = [...document.querySelectorAll('.lc-runtimecell')]
  const opencode = cells.find((cell) => /OpenCode/i.test(flat(cell)))
  if (!opencode) return 'no OpenCode cell'
  const install = opencode.querySelector('button.lc-runtimecell__install')
  if (!install) return 'no Install button: ' + flat(opencode).slice(0, 80)
  if (install.disabled) return 'Install is disabled: ' + (install.getAttribute('title') ?? 'no reason')
  install.click()
  // npm says nothing for the first few seconds; the disclosure only exists
  // once there is something behind it.
  await new Promise((r) => setTimeout(r, 9000))
  const note = document.querySelector('.lc-installnote')
  const running = document.querySelector('.lc-installnote__running')
  const show = [...document.querySelectorAll('button')].find((b) => /Show output/i.test(flat(b)))
  return 'note: ' + (note ? flat(note).slice(0, 110) : 'none')
    + ' || command while running: ' + (running ? flat(running) : 'ABSENT')
    + ' || Show output: ' + (show ? 'present' : 'absent')
})()`

const OPEN_OUTPUT = `(async () => {
  const flat = (el) => el.innerText.split(/\\s+/).join(' ').trim()
  const show = [...document.querySelectorAll('button')].find((b) => /Show output/i.test(flat(b)))
  if (!show) return 'no Show output control'
  show.click()
  await new Promise((r) => setTimeout(r, 600))
  const pane = document.querySelector('.lc-installoutput')
  return 'pane: ' + (pane ? flat(pane).length + ' chars of npm output' : 'ABSENT')
    + ' || lines: ' + (pane ? pane.innerText.split('\\n').length : 0)
})()`

const SETTLED = `(async () => {
  const flat = (el) => el.innerText.split(/\\s+/).join(' ').trim()
  for (let i = 0; i < 180; i += 1) {
    await new Promise((r) => setTimeout(r, 1000))
    const failed = document.querySelector('.lc-installnote--failed')
    if (failed) {
      const pane = document.querySelector('.lc-installoutput')
      return 'FAILED after ' + (i + 1) + 's :: ' + flat(failed).slice(0, 200)
        + ' || output pane: ' + (pane ? 'open, ' + pane.innerText.split('\\n').length + ' lines' : 'closed')
    }
  }
  return 'never settled in 180s'
})()`

try {
  await drive.capture('a fresh machine, nothing installed', async () => {
    await drive.ready()
    return drive.evaluate(READY)
  })

  await drive.capture('press Install: the command shows while it runs', () =>
    drive.evaluate(START_INSTALL)
  )

  await drive.capture('open Show output', () => drive.evaluate(OPEN_OUTPUT))

  await drive.capture('and how it ends', () => drive.evaluate(SETTLED))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: 'The install states on a fresh machine: the running command, the live line, and Show output.'
  })
}
