// Avatar smoke: the generated faces against the spec's acceptance checks, in
// the built app with a real Codex mission behind them.
//
//   node _smoke/avatar-smoke.mjs
//
// What it pins: faces are seeded from the id (two teammates named alike get
// different faces); while a mission runs, the working teammate's chips move
// and every other teammate's chip is perfectly still; when it finishes, every
// chip is still; the live step is an avatar-led line with no bar; and under
// reduced motion nothing animates while state still reads from the presence
// dot and the text.

import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const APP_DIR = new URL('../apps/desktop/', import.meta.url).pathname.slice(1)
const ELECTRON = join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const PORT = 9227
const CODEX_BIN_DIR = 'C:\\Users\\<home>\\AppData\\Local\\OpenAI\\Codex\\bin\\b99306303521e97e'
const NPM_DIR = 'C:\\Users\\<home>\\AppData\\Roaming\\npm'

const PROMPT = 'List every file under apps/desktop/src/main one at a time with a short sentence each. Take your time.'

let failures = 0
function check(label, ok, detail) {
  if (!ok) failures += 1
  console.error(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const say = (line) => console.error(line)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      const waiter = this.pending.get(message.id)
      if (waiter === undefined) return
      this.pending.delete(message.id)
      waiter.resolve(message)
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params }))
    return Promise.race([
      new Promise((resolve) => this.pending.set(id, { resolve })),
      (async () => {
        for (let i = 0; i < 400; i += 1) {
          await sleep(1000)
          if (child.exitCode !== null) return { error: { message: `app exited ${child.exitCode} mid-step` } }
        }
        return { error: { message: 'cdp timeout' } }
      })()
    ])
  }
  async eval(expression) {
    const message = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (message.error) throw new Error(JSON.stringify(message.error))
    const result = message.result
    if (result?.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate threw')
    return result?.result?.value
  }
}

// Two teammates who share a name, on purpose: the face must come from the id.
const profile = await mkdtemp(join(tmpdir(), 'locust-avatar-smoke-'))
await mkdir(profile, { recursive: true })
const createdAt = new Date().toISOString()
await writeFile(
  join(profile, 'teammates.json'),
  JSON.stringify({
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren_one', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt },
      { teammateId: 'tm_wren_two', name: 'Wren', hue: 'lime', role: 'Docs & QA', createdAt }
    ],
    missionOwners: {},
    settings: { swarm: false }
  }, null, 2)
)

const child = spawn(ELECTRON, ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`], {
  cwd: APP_DIR,
  env: { ...process.env, PATH: `${CODEX_BIN_DIR};${NPM_DIR};${process.env.PATH ?? ''}` },
  stdio: ['ignore', 'pipe', 'pipe']
})
const appOutput = []
child.stdout.on('data', (d) => appOutput.push(String(d)))
child.stderr.on('data', (d) => appOutput.push(String(d)))

// Every face on screen, with whether any of its layers is animating and what
// its presence dot says. Read from computed style, not from class names, so
// reduced motion is tested by what the browser would actually do.
const faces = `JSON.stringify([...document.querySelectorAll('.lc-face')].map(face => {
  const chip = face.querySelector('.lc-face__chip')
  const layers = [...face.querySelectorAll('.lc-face__layer')]
  const names = [chip, ...layers].map(n => getComputedStyle(n).animationName).filter(n => n && n !== 'none')
  const dot = face.querySelector('.lc-presence')
  const shadow = layers.map(l => getComputedStyle(l).boxShadow).join('|')
  return {
    where: face.closest('.lc-teammate') ? 'sidebar' : face.closest('.lc-workroom__header') ? 'header' : face.closest('.lc-livestep') ? 'step' : face.closest('.lc-agentline') ? 'thread' : face.closest('.lc-empty') ? 'empty' : 'other',
    name: (face.closest('.lc-teammate') || face.closest('.lc-workroom__header') || { querySelector: () => null }).querySelector?.('.lc-row__name, .lc-workroom__name')?.innerText?.trim() ?? '',
    size: face.getBoundingClientRect().width,
    animating: names,
    presence: dot ? [...dot.classList].find(c => c.startsWith('lc-presence--')) ?? 'dot' : 'none',
    shadow
  }
}))`

try {
  say('1. the app starts with two teammates who share a name')
  let page
  for (let attempt = 0; attempt < 60 && page === undefined; attempt += 1) {
    await sleep(500)
    if (child.exitCode !== null) break
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
    } catch {
      // not yet
    }
  }
  check('renderer target available', page !== undefined, child.exitCode === null ? undefined : `app exited ${child.exitCode}`)
  if (page === undefined) {
    say(appOutput.join(''))
    process.exit(1)
  }
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  const cdp = new Cdp(socket)
  await cdp.send('Runtime.enable')
  await cdp.eval(`(async () => {
    for (let i = 0; i < 240; i += 1) {
      const field = document.querySelector('form.command-dock textarea')
      if (field && document.querySelectorAll('.lc-row--button').length >= 2 && !/Checking local runtimes/.test(field.placeholder)) return true
      await new Promise(r => setTimeout(r, 250))
    }
    return false
  })()`)

  say('2. two teammates named alike wear different faces, and every face is still')
  const idle = JSON.parse(await cdp.eval(faces))
  const sidebar = idle.filter((face) => face.where === 'sidebar')
  check('both sidebar chips are drawn', sidebar.length === 2, `sidebar faces: ${sidebar.length}`)
  check('the two faces differ though the names match', sidebar.length === 2 && sidebar[0].shadow !== sidebar[1].shadow)
  check('nothing animates while everyone is idle', idle.every((face) => face.animating.length === 0), JSON.stringify(idle.map((f) => f.animating)))
  check('idle chips carry no presence dot', sidebar.every((face) => face.presence === 'none'), JSON.stringify(sidebar.map((f) => f.presence)))
  check('no progress bar exists anywhere', (await cdp.eval(`document.querySelectorAll('.lc-progress').length`)) === 0)

  say('3. faces at every size are crisp: integer pixels, centered')
  const sizes = JSON.parse(await cdp.eval(`JSON.stringify([...document.querySelectorAll('.lc-face')].map(f => {
    const layer = f.querySelector('.lc-face__layer')
    return { size: f.getBoundingClientRect().width, px: layer ? parseFloat(getComputedStyle(layer).width) : 0 }
  }))`))
  check('every drawn pixel is a whole number of device pixels', sizes.every((entry) => Number.isInteger(entry.px) && entry.px >= 2), JSON.stringify(sizes))

  say('3b. editing a teammate changes the name and keeps the face')
  const edited = await cdp.eval(`(async () => {
    const before = [...document.querySelectorAll('.lc-teammate .lc-face__layer')].map(l => getComputedStyle(l).boxShadow).join('|')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', ctrlKey: true, bubbles: true }))
    await new Promise(r => setTimeout(r, 300))
    const editButton = document.querySelector('.lc-rostercard__edit')
    if (!editButton) return JSON.stringify({ opened: false })
    editButton.click()
    await new Promise(r => setTimeout(r, 300))
    const dialog = document.querySelector('.lc-dialog')
    const title = dialog ? dialog.querySelector('.lc-dialog__title').innerText : ''
    const field = document.getElementById('lc-teammate-name')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(field, 'Wrenna')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 100))
    const save = [...document.querySelectorAll('.lc-dialog .lc-primarybutton')].find(b => /Save changes/.test(b.innerText))
    if (!save) return JSON.stringify({ opened: true, title, saved: false })
    save.click()
    for (let i = 0; i < 40; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      if (!document.querySelector('.lc-dialog')) break
    }
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', ctrlKey: true, bubbles: true }))
    await new Promise(r => setTimeout(r, 200))
    // Back to the workroom so the sidebar and composer are the ones under test.
    const row = [...document.querySelectorAll('.lc-row--button')][0]
    row.click()
    await new Promise(r => setTimeout(r, 300))
    const after = [...document.querySelectorAll('.lc-teammate .lc-face__layer')].map(l => getComputedStyle(l).boxShadow).join('|')
    const names = [...document.querySelectorAll('.lc-teammate .lc-row__name')].map(n => n.innerText.trim())
    return JSON.stringify({ opened: true, title, saved: true, names, faceUnchanged: before === after })
  })()`)
  const editState = JSON.parse(edited)
  check('the roster offers Edit and opens the same dialog in edit mode', editState.opened === true && editState.title === 'Edit teammate', JSON.stringify(editState))
  check('saving renames the teammate', editState.saved === true && (editState.names ?? []).includes('Wrenna'), JSON.stringify(editState.names))
  check('the rename did not change the face', editState.faceUnchanged === true)

  say('4. while the first Wren works, only their face moves')
  await cdp.eval(`(async () => {
    const row = [...document.querySelectorAll('.lc-row--button')][0]
    row.click()
    await new Promise(r => setTimeout(r, 300))
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, ${JSON.stringify(PROMPT)})
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 120; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      const send = document.querySelector('form.command-dock .send-button')
      if (send && !send.disabled && send.getAttribute('aria-label') === 'Start mission') { send.click(); return true }
    }
    return false
  })()`)
  const live = await cdp.eval(`(async () => {
    for (let i = 0; i < 120; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      if (document.querySelector('.lc-thread__marker') && document.querySelector('.lc-livestep, .lc-agentline')) return ${faces}
    }
    return ${faces}
  })()`)
  const working = JSON.parse(live)
  const workingSidebar = working.filter((face) => face.where === 'sidebar')
  const first = workingSidebar[0]
  const second = workingSidebar[1]
  check('the working teammate\u2019s sidebar chip animates (bob, eyes, mouth)',
    first !== undefined && ['lcBob', 'lcEyes', 'lcChat'].every((name) => first.animating.includes(name)), JSON.stringify(first))
  check('the working teammate wears the lime presence dot', first?.presence === 'lc-presence--lime', first?.presence)
  check('the other teammate\u2019s chip is perfectly still', second !== undefined && second.animating.length === 0 && second.presence === 'none', JSON.stringify(second))
  const header = working.find((face) => face.where === 'header')
  check('the header chip works too', header !== undefined && header.animating.includes('lcBob'), JSON.stringify(header))
  const threadFaces = working.filter((face) => face.where === 'thread')
  check('faces beside transcript turns stay still', threadFaces.every((face) => face.animating.length === 0), JSON.stringify(threadFaces.map((f) => f.animating)))
  const step = await cdp.eval(`JSON.stringify((() => {
    const line = document.querySelector('.lc-livestep')
    if (!line) return null
    return { kind: line.dataset.stepKind, hasFace: line.querySelector('.lc-face') !== null, hasBar: line.querySelector('.lc-progress') !== null, dots: line.querySelectorAll('.lc-dots').length, text: line.innerText.replace(/\\s+/g, ' ').trim() }
  })())`)
  const stepState = JSON.parse(step)
  if (stepState !== null) {
    check('the running step is an avatar-led line without a bar', stepState.hasFace === true && stepState.hasBar === false, JSON.stringify(stepState))
    check('a reasoning step shows dots; an action step does not', stepState.kind === 'reasoning' ? stepState.dots === 1 : stepState.dots === 0, JSON.stringify(stepState))
    say(`       step: ${stepState.kind} · ${stepState.text.slice(0, 80)}`)
  } else {
    say('       (no live step on screen at the sample moment)')
  }

  say('5. reduced motion: nothing animates, state still reads')
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await sleep(300)
  const reduced = JSON.parse(await cdp.eval(faces))
  check('no face animates under reduced motion', reduced.every((face) => face.animating.length === 0), JSON.stringify(reduced.map((f) => f.animating)))
  const reducedFirst = reduced.filter((face) => face.where === 'sidebar')[0]
  check('the working teammate still wears the presence dot', reducedFirst?.presence === 'lc-presence--lime', reducedFirst?.presence)
  const label = await cdp.eval(`[...document.querySelectorAll('.lc-teammate .lc-row__meta')].map(n => n.innerText).join(' | ')`)
  check('and the text still says who is working', /working/.test(label), label)
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: '' }] })

  say('6. when the mission ends, every face is still')
  const done = await cdp.eval(`(async () => {
    for (let i = 0; i < 420; i += 1) {
      await new Promise(r => setTimeout(r, 1000))
      if (!document.querySelector('button[aria-label^="Stop the running"]') && document.querySelector('.lc-agentline')) return true
    }
    return false
  })()`)
  check('the mission finished', done === true)
  const after = JSON.parse(await cdp.eval(faces))
  check('nothing animates once the work is done', after.every((face) => face.animating.length === 0), JSON.stringify(after.map((f) => f.animating)))
  check('no presence dot remains', after.filter((face) => face.where === 'sidebar').every((face) => face.presence === 'none'))
} finally {
  child.kill()
  await sleep(500)
  await rm(profile, { recursive: true, force: true }).catch(() => undefined)
}

if (failures > 0) {
  say('--- app output (tail) ---')
  say(appOutput.join('').slice(-3000))
  say(`\n${failures} FAILED`)
  process.exit(1)
}
say('\navatar smoke passed')
