// Which folder the teammates work in -- live, against the real app.
//
//   node _smoke/workspace-smoke.mjs
//
// Colin, 2026-09-05: the installed app is launched from its own install
// folder by the Start menu shortcut, and until 0.21.5 that folder WAS the
// workspace -- every teammate was working inside AppData\Local\Programs\Locust,
// and Antigravity was the route that said so ("Antigravity has not opened
// C:\...\Programs\Locust"). Three launches, one app at a time:
//
//   A. launched from the install folder, nothing chosen  -> Locust MAKES a
//      folder (Documents\Locust in life; a temp path here) and works there,
//      saying so where the folder is named (Colin, 2026-09-05: "every
//      similar program lets you do it, so maybe it just writes a project
//      folder if you don't have one")
//   A2. the same, but the default folder cannot be made -> the 0.21.5 answer:
//      no workspace, the home screen says so, a start is refused with why
//   B. launched from the install folder, a folder remembered -> that folder
//   C. launched from a real folder (the control every other smoke relies on)
//
// A development build has no install folder, so `LOCUST_INSTALL_DIR` names
// one for it, and `LOCUST_DEFAULT_WORKSPACE` names the folder to make -- the
// two seams the main process documents. Every launch here sets the second,
// so no case can create the real Documents\Locust on the machine.

import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { portFor } from './ports.mjs'

const APP_DIR = new URL('../apps/desktop/', import.meta.url).pathname.slice(1)
const ELECTRON = join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const PORT = portFor(import.meta.url)
let failures = 0
function check(label, ok, detail) {
  if (!ok) failures += 1
  console.error(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const say = (line) => console.error(line)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  const already = await fetch(`http://127.0.0.1:${String(PORT)}/json/list`, { signal: AbortSignal.timeout(1500) })
  if (already.ok) {
    say(`  [FAIL] something is already debugging on port ${String(PORT)}`)
    process.exit(1)
  }
} catch {
  // Nothing listening, which is what we want.
}

const install = await mkdtemp(join(tmpdir(), 'locust-install-'))
const project = await mkdtemp(join(tmpdir(), 'locust-project-'))
const scratch = await mkdtemp(join(tmpdir(), 'locust-default-'))
// Does not exist until the app makes it; that is the point of case A.
const made = join(scratch, 'Locust')
// A path under a FILE cannot be made; that is the point of case A2.
await writeFile(join(scratch, 'blocker'), 'not a directory\n', 'utf8')
const unmakeable = join(scratch, 'blocker', 'Locust')
await writeFile(join(project, 'README.md'), '# pebble\n', 'utf8')

async function launch({ cwd, env, remembered }) {
  const profile = await mkdtemp(join(tmpdir(), 'locust-ws-profile-'))
  await mkdir(profile, { recursive: true })
  await writeFile(
    join(profile, 'teammates.json'),
    JSON.stringify({
      schemaVersion: 1,
      teammates: [
        { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T00:00:00.000Z' }
      ],
      missionOwners: {},
      settings: { swarm: false }
    })
  )
  if (remembered !== undefined) {
    await writeFile(join(profile, 'workspace.json'), JSON.stringify({ schemaVersion: 1, path: remembered }), 'utf8')
  }
  // The app by its own path, never '.': the whole point is launching from a
  // folder that is NOT the app.
  const child = spawn(ELECTRON, [APP_DIR, `--remote-debugging-port=${String(PORT)}`, `--user-data-dir=${profile}`], {
    cwd,
    env: { ...process.env, LOCUST_DEFAULT_WORKSPACE: made, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const output = []
  child.stdout.on('data', (d) => output.push(String(d)))
  child.stderr.on('data', (d) => output.push(String(d)))

  let page
  for (let attempt = 0; attempt < 80 && page === undefined; attempt += 1) {
    await sleep(500)
    if (child.exitCode !== null) throw new Error(`app exited ${String(child.exitCode)}\n${output.join('').slice(-1200)}`)
    try {
      const list = await (await fetch(`http://127.0.0.1:${String(PORT)}/json/list`)).json()
      page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl && !t.url.includes('#splash'))
    } catch { /* not up */ }
  }
  if (page === undefined) {
    try { child.kill() } catch { /* gone */ }
    throw new Error(`renderer never came up
${output.join('').slice(-1200)}`)
  }
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res) => socket.addEventListener('open', res, { once: true }))
  let id = 0
  const pending = new Map()
  socket.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    const w = pending.get(m.id)
    if (w) { pending.delete(m.id); w(m) }
  })
  const send = (method, params = {}) =>
    Promise.race([
      new Promise((res) => {
        const n = ++id
        pending.set(n, res)
        socket.send(JSON.stringify({ id: n, method, params }))
      }),
      // An unref()'d timer, so a finished smoke is not held open for a minute
      // by a timeout that already lost its race.
      new Promise((resolve) => { const t = setTimeout(() => resolve({ error: { message: 'cdp timeout' } }), 60_000); t.unref() })
    ])
  const evaluate = async (expression) => {
    const m = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (m.error) throw new Error(JSON.stringify(m.error))
    if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description ?? 'evaluate threw')
    return m.result?.result?.value
  }
  await evaluate(`(async () => {
    for (let i = 0; i < 240; i += 1) {
      const f = document.querySelector('form.command-dock textarea')
      if (f && !/Checking local runtimes/.test(f.placeholder)) return true
      await new Promise(r => setTimeout(r, 250))
    }
    return false
  })()`)
  const close = async () => {
    try { socket.close() } catch { /* gone */ }
    try { child.kill() } catch { /* gone */ }
    await sleep(1500)
    await rm(profile, { recursive: true, force: true }).catch(() => undefined)
  }
  return { evaluate, close, output }
}

const HOME_STATE = `(() => {
  const folder = document.querySelector('.lc-folder')
  const chip = document.querySelector('.lc-control--folder')
  return JSON.stringify({
    title: document.querySelector('.lc-titlebar__title')?.innerText.trim() ?? '',
    home: document.querySelector('.lc-empty') !== null,
    folder: folder !== null,
    missing: folder?.classList.contains('is-missing') ?? false,
    // textContent, not innerText: the label is uppercased by CSS and the
    // words are what the assertion is about.
    label: folder?.querySelector('.lc-folder__label')?.textContent.trim() ?? '',
    path: folder?.querySelector('.lc-folder__path')?.innerText.trim() ?? '',
    button: folder?.querySelector('button')?.innerText.trim() ?? '',
    runtimeRows: document.querySelectorAll('.lc-runtimecell').length,
    chip: chip?.textContent.trim() ?? '',
    chipMissing: chip?.classList.contains('is-missing') ?? false,
    chipTitle: chip?.title ?? ''
  })
})()`

// Settings owns the folder card now, so the check has to go there to see it
// (Colin, 2026-09-05: "move the project folder part to settings").
const SETTINGS_STATE = `(async () => {
  const rail = [...document.querySelectorAll('.lc-rail button, .lc-nav button, button')].find(b => /^Settings$/.test(b.innerText.trim()))
  rail.click()
  await new Promise(r => setTimeout(r, 600))
  const folder = document.querySelector('.lc-folder')
  const heading = [...document.querySelectorAll('.lc-settings__heading')].map(h => h.textContent.trim())
  return JSON.stringify({
    heading: heading.includes('Project folder'),
    firstHeading: heading[0] ?? '',
    folder: folder !== null,
    missing: folder?.classList.contains('is-missing') ?? false,
    label: folder?.querySelector('.lc-folder__label')?.textContent.trim() ?? '',
    path: folder?.querySelector('.lc-folder__path')?.textContent.trim() ?? '',
    button: folder?.querySelector('button')?.textContent.trim() ?? ''
  })
})()`

try {
  say('A. launched from the install folder with nothing chosen: Locust makes a folder')
  {
    const app = await launch({ cwd: install, env: { LOCUST_INSTALL_DIR: install } })
    try {
      const home = JSON.parse(await app.evaluate(HOME_STATE))
      say(`       ${JSON.stringify(home)}`)
      const { stat } = await import('node:fs/promises')
      const exists = await stat(made).then((s) => s.isDirectory()).catch(() => false)
      check('the default folder now exists on disk', exists, made)
      check('the app opens on the home screen', home.home === true)
      check('the title bar names the made folder', home.title === 'Locust', home.title)
      check('the intro screen has no missing-folder card: there is nothing missing', home.folder === false)
      check('every runtime is listed, so connections are visible on launch', home.runtimeRows >= 5, String(home.runtimeRows))
      check('the composer chip names the made folder', home.chip === 'Locust', home.chip)
      check('and is not marked missing', home.chipMissing === false)
      check('its tooltip says Locust made the folder and that any other is one click away', /Locust made this folder/.test(home.chipTitle) && home.chipTitle.includes(made), home.chipTitle)
      const gate = JSON.parse(await app.evaluate(`window.desktop.startCodexMission({ prompt: '', mode: 'ask', runtime: 'codex' }).then(r => JSON.stringify(r))`))
      check('the start gate is open (an empty prompt is refused for being empty, not for the folder)', gate.error?.code === 'INVALID_PROMPT', JSON.stringify(gate))
      const settings = JSON.parse(await app.evaluate(SETTINGS_STATE))
      say(`       settings -> ${JSON.stringify(settings)}`)
      check('Settings says the folder is one Locust made', settings.label === 'Teammates work in a folder Locust made' && settings.path === made, `${settings.label} · ${settings.path}`)
      check('with a Change control', settings.button === 'Change', settings.button)
    } finally {
      await app.close()
    }
  }

  say('A2. the same launch, but the default folder cannot be made: the old refusal, with its reason')
  {
    const app = await launch({ cwd: install, env: { LOCUST_INSTALL_DIR: install, LOCUST_DEFAULT_WORKSPACE: unmakeable } })
    try {
      const home = JSON.parse(await app.evaluate(HOME_STATE))
      say(`       ${JSON.stringify(home)}`)
      check('the app opens on the home screen', home.home === true)
      check('the title bar shows the build, not the missing folder', /^Locust( [0-9]+\.[0-9]+\.[0-9]+)?$/.test(String(home.title)), home.title)
      check('the one line that has to be said is said', home.folder === true && home.missing === true)
      check('it says so in words', home.label === 'No folder chosen', home.label)
      check('and offers to choose one', home.button === 'Choose folder', home.button)
      check('the composer chip says there is no folder', home.chip === 'No folder', home.chip)
      check('and is marked as the exception it is', home.chipMissing === true)

      const refused = JSON.parse(await app.evaluate(`window.desktop.startCodexMission({ prompt: 'hi', mode: 'ask', runtime: 'codex' }).then(r => JSON.stringify(r))`))
      say(`       start -> ${JSON.stringify(refused)}`)
      check('a start is refused by the main process', refused.ok === false && refused.error?.code === 'NO_WORKSPACE', JSON.stringify(refused))
      check('and the refusal names the remedy', /Choose the folder/.test(refused.error?.message ?? ''), refused.error?.message)

      // The same refusal from the composer, which is where a person meets it.
      const composed = JSON.parse(await app.evaluate(`(async () => {
        const area = document.querySelector('form.command-dock textarea')
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
        setter.call(area, 'rename the readme')
        area.dispatchEvent(new Event('input', { bubbles: true }))
        await new Promise(r => setTimeout(r, 200))
        document.querySelector('form.command-dock').requestSubmit()
        await new Promise(r => setTimeout(r, 800))
        const notice = document.querySelector('.lc-diagnostic--row')
        return JSON.stringify({
          notice: notice?.innerText.trim() ?? '',
          noticeButton: notice?.querySelector('button')?.innerText.trim() ?? '',
          runRows: document.querySelectorAll('.lc-run, .lc-workroom__header').length
        })
      })()`))
      say(`       composer -> ${JSON.stringify(composed)}`)
      check('sending from the composer shows the notice instead of starting', /Choose the folder/.test(composed.notice), composed.notice)
      check('with the choose control right on it', composed.noticeButton === 'Choose folder', composed.noticeButton)
      check('and no run was filed', composed.runRows === 0, String(composed.runRows))
    } finally {
      await app.close()
    }
  }

  say('B. launched from the install folder with a folder remembered')
  {
    const app = await launch({ cwd: install, env: { LOCUST_INSTALL_DIR: install }, remembered: project })
    try {
      const home = JSON.parse(await app.evaluate(HOME_STATE))
      say(`       ${JSON.stringify(home)}`)
      check('the title bar names the remembered folder', home.title === basename(project), home.title)
      check('the intro screen says nothing about the folder once one is chosen', home.folder === false)
      check('the composer chip names it', home.chip === basename(project), home.chip)
      check('and its tooltip carries the whole path', home.chipTitle === `Teammates work in ${project}`, home.chipTitle)
      const gate = JSON.parse(await app.evaluate(`window.desktop.startCodexMission({ prompt: '', mode: 'ask', runtime: 'codex' }).then(r => JSON.stringify(r))`))
      check('the start gate is open (an empty prompt is refused for being empty, not for the folder)', gate.error?.code === 'INVALID_PROMPT', JSON.stringify(gate))

      const settings = JSON.parse(await app.evaluate(SETTINGS_STATE))
      say(`       settings -> ${JSON.stringify(settings)}`)
      check('Settings has a Project folder section', settings.heading === true, settings.firstHeading)
      check('it is the first thing in Settings', settings.firstHeading === 'Project folder', settings.firstHeading)
      check('the card is there, not marked missing', settings.folder === true && settings.missing === false)
      check('naming the folder', settings.label === 'Teammates work in' && settings.path === project, `${settings.label} · ${settings.path}`)
      check('with a Change control', settings.button === 'Change', settings.button)
    } finally {
      await app.close()
    }
  }

  say('C. CONTROL: launched from a real folder, no install folder in play')
  {
    const app = await launch({ cwd: project, env: { LOCUST_INSTALL_DIR: '' } })
    try {
      const home = JSON.parse(await app.evaluate(HOME_STATE))
      say(`       ${JSON.stringify(home)}`)
      // Read off the chip, not the intro card: the card only appears when
      // NO folder is chosen now, so asserting its path here would be
      // asserting the absence of the very thing this case proves.
      check(
        'the launch folder is the workspace, as it always was',
        home.title === basename(project) && home.chipTitle === `Teammates work in ${project}`,
        `${home.title} · ${home.chipTitle}`
      )
    } finally {
      await app.close()
    }
  }
} catch (error) {
  failures += 1
  say(`  [FAIL] ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await rm(install, { recursive: true, force: true }).catch(() => undefined)
  await rm(project, { recursive: true, force: true }).catch(() => undefined)
  await rm(scratch, { recursive: true, force: true }).catch(() => undefined)
}

if (failures > 0) {
  say(`\n${String(failures)} WORKSPACE FAILURE(S)`)
  process.exit(1)
}
say('\nworkspace smoke passed')
