// Use the app the way a person would, and keep what they would have seen.
//
//   node _tools/user-session.mjs [--out <dir>] [--keep]
//
// Not a smoke: nothing here asserts. It launches the BUILT app (out/) in a
// throwaway profile with no teammates, so the first screen is the one a new
// person sees, then walks a first session -- make a teammate, put it on a
// cheap route, send a real mission, follow it up, look at every screen, open
// the row menu -- and at each step writes a PNG screenshot, the visible text
// and any console error to the output directory. Reading those afterwards is
// the test. The point is to notice what a smoke's assertions do not ask about.
//
// Cheap route on purpose: Cursor Agent / composer-2.5, the same one the smokes
// use. The workspace is disposable, so an Accept-edits run cannot touch a
// real tree.

import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const APP_DIR = new URL('../apps/desktop/', import.meta.url).pathname.slice(1)
const ELECTRON = join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const NPM_DIR = 'C:\\Users\\<home>\\AppData\\Roaming\\npm'
const PORT = 9297
const args = process.argv.slice(2)
const outArg = args.indexOf('--out')
const OUT = resolve(outArg === -1 ? join(process.cwd(), '_session-out') : args[outArg + 1])
const KEEP = args.includes('--keep')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const say = (line) => console.error(line)

await mkdir(OUT, { recursive: true })
const profile = await mkdtemp(join(tmpdir(), 'locust-session-'))
const workspace = await mkdtemp(join(tmpdir(), 'locust-session-ws-'))
await writeFile(
  join(workspace, 'status.ts'),
  ['export const status = "draft";', '', 'export function describe(): string {', '  return status;', '}', ''].join('\n'),
  'utf8'
)
await writeFile(join(workspace, 'README.md'), '# scratch\n\nA throwaway folder for a user session.\n', 'utf8')

const child = spawn(ELECTRON, [APP_DIR, `--remote-debugging-port=${String(PORT)}`, `--user-data-dir=${profile}`], {
  cwd: workspace,
  env: { ...process.env, PATH: `${NPM_DIR};${process.env.PATH ?? ''}` },
  stdio: ['ignore', 'pipe', 'pipe']
})
const appOutput = []
child.stdout.on('data', (d) => appOutput.push(String(d)))
child.stderr.on('data', (d) => appOutput.push(String(d)))

const consoleErrors = []
let step = 0

try {
  let page
  for (let i = 0; i < 80 && page === undefined; i += 1) {
    await sleep(500)
    if (child.exitCode !== null) throw new Error(`app exited ${String(child.exitCode)}`)
    try {
      const list = await (await fetch(`http://127.0.0.1:${String(PORT)}/json/list`)).json()
      page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
    } catch { /* not up */ }
  }
  if (page === undefined) throw new Error('renderer never came up')
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    socket.addEventListener('open', res, { once: true })
    socket.addEventListener('error', rej, { once: true })
  })
  let id = 0
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(`exception: ${message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text}`)
    }
    if (message.method === 'Runtime.consoleAPICalled' && (message.params.type === 'error' || message.params.type === 'warning')) {
      consoleErrors.push(`${message.params.type}: ${message.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300)}`)
    }
    const waiter = pending.get(message.id)
    if (waiter) { pending.delete(message.id); waiter(message) }
  })
  const send = (method, params = {}) =>
    new Promise((res) => {
      const next = ++id
      pending.set(next, res)
      socket.send(JSON.stringify({ id: next, method, params }))
    })
  const evaluate = async (expression) => {
    const message = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    const thrown = message.result?.exceptionDetails
    if (thrown !== undefined) say(`  eval threw: ${thrown.exception?.description ?? JSON.stringify(thrown).slice(0, 200)}`)
    return message.result?.result?.value
  }
  await send('Runtime.enable')
  await send('Page.enable')

  const snap = async (name, note = '') => {
    step += 1
    const tag = `${String(step).padStart(2, '0')}-${name}`
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    if (shot.result?.data) await writeFile(join(OUT, `${tag}.png`), Buffer.from(shot.result.data, 'base64'))
    const text = await evaluate('document.body.innerText')
    const red = await evaluate("[...document.querySelectorAll('.lc-card.is-red, .lc-dialog__error, [role=alert]')].map(e => e.innerText).join(' | ')")
    await writeFile(join(OUT, `${tag}.txt`), `${note}\n\n--- red ---\n${red ?? ''}\n\n--- text ---\n${text ?? ''}\n`, 'utf8')
    say(`[${tag}] ${note}${red ? `  RED: ${String(red).slice(0, 120)}` : ''}`)
  }

  // A person waits for the app to finish looking for runtimes.
  const ready = await evaluate(`(async () => {
    for (let i = 0; i < 240; i += 1) {
      const field = document.querySelector('form.command-dock textarea')
      if (field && !/Checking local runtimes/.test(field.placeholder)) return field.placeholder
      await new Promise(r => setTimeout(r, 250))
    }
    return null
  })()`)
  await snap('first-launch', `composer placeholder: ${String(ready)}`)

  // Make a teammate through the dialog, typing the way a person does.
  await evaluate(`(async () => {
    document.querySelector('button[aria-label="New teammate"]').click()
    await new Promise(r => setTimeout(r, 400))
    return !!document.querySelector('[role=dialog]')
  })()`)
  await snap('new-teammate-dialog', 'dialog open, nothing typed')
  await evaluate(`(async () => {
    const input = document.querySelector('[role=dialog] input')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, 'Juno')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 200))
    const roles = [...document.querySelectorAll('[role=dialog] .lc-rolegrid [role=radio], [role=dialog] .lc-rolegrid button')]
    if (roles[1]) roles[1].click()
    await new Promise(r => setTimeout(r, 200))
    return roles.length
  })()`)
  await snap('teammate-filled', 'name typed, second role picked')
  await evaluate(`(async () => {
    const button = [...document.querySelectorAll('[role=dialog] button')].find(b => b.innerText.trim() === 'Create teammate')
    if (!button || button.disabled) return 'create disabled'
    button.click()
    await new Promise(r => setTimeout(r, 600))
    return 'clicked'
  })()`)
  await snap('teammate-created', 'after Create teammate')

  // Message the teammate on the cheap route.
  const picked = await evaluate(`(async () => {
    const juno = [...document.querySelectorAll('button')].find(b => b.getAttribute('title') === 'Message Juno')
    if (!juno) return 'no Message Juno button'
    juno.click()
    await new Promise(r => setTimeout(r, 400))
    const control = [...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')
    if (!control) return 'no route control'
    // The walk relay-smoke uses: type into the picker's search box, then
    // read group headers and rows as SIBLINGS of the list. Session 1 asked
    // for any element containing the model name and got nothing, so it ran
    // on Codex (out of quota) without saying so.
    let target
    for (let attempt = 0; attempt < 90 && !target; attempt += 1) {
      const picker = document.querySelector('.lc-picker')
      if (!picker) { control.click(); await new Promise(r => setTimeout(r, 500)); continue }
      const input = picker.querySelector('.lc-picker__input')
      const setInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      // The row reads the model's DISPLAY name, "Composer 2.5" with a space;
      // the id with the hyphen is what the ledger records. Session 2 matched
      // the id and found nothing.
      setInput.call(input, 'composer 2.5')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(r => setTimeout(r, 500))
      let group = ''
      for (const node of picker.querySelector('.lc-picker__list').children) {
        const header = node.querySelector('.lc-picker__group')
        if (header) group = header.innerText
        const row = node.querySelector('.lc-picker__row')
        const label = row ? row.innerText.trim().toLowerCase() : ''
        if (row && !row.disabled && /cursor/i.test(group) && label.startsWith('composer 2.5')) { target = row; break }
      }
      if (!target) await new Promise(r => setTimeout(r, 500))
    }
    if (!target) return 'composer-2.5 not offered'
    target.click()
    await new Promise(r => setTimeout(r, 300))
    if (document.querySelector('.lc-picker')) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await new Promise(r => setTimeout(r, 200))
    return document.querySelector('.lc-control[aria-haspopup=listbox]').innerText
  })()`)
  await snap('route-picked', `route control reads: ${String(picked)}`)
  // A session on the wrong runtime is a different session: session 1 ran on
  // Codex, out of quota, and every later screenshot was of that failure.
  // Read the CONTROL, not the picker's verdict: the first guard matched the
  // words "composer-2.5 not offered" and let a Codex session through.
  if (!/cursor/i.test(String(picked)) || /not offered/.test(String(picked))) throw new Error(`route is not Cursor / composer-2.5: ${String(picked)}`)

  const type = async (text) => evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, ${JSON.stringify(text)})
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 200))
    return field.value.length
  })()`)
  const submit = async () => evaluate(`(async () => {
    const button = document.querySelector('button[aria-label="Start mission"]')
    if (!button || button.disabled) return 'start disabled'
    button.click()
    await new Promise(r => setTimeout(r, 150))
    return document.querySelector('form.command-dock textarea').value
  })()`)
  const settle = async (seconds) => evaluate(`(async () => {
    for (let i = 0; i < ${String(seconds * 2)}; i += 1) {
      if (!document.querySelector('button[aria-label^="Stop the running"]')) return true
      await new Promise(r => setTimeout(r, 500))
    }
    return false
  })()`)

  await type('Read status.ts and tell me in two sentences what it exports. Do not change anything.')
  await snap('typed', 'instruction typed, not sent')
  const left = await submit()
  await snap('sent', `composer right after Start: ${JSON.stringify(left)}`)
  await sleep(1500)
  await snap('one-second-in', 'what a person sees a moment after sending')
  const done1 = await settle(240)
  await snap('first-answer', `settled: ${String(done1)}`)

  await type('Now list every file in this folder, one per line.')
  await submit()
  await sleep(1500)
  await snap('follow-up-sent', 'second turn under way')
  const done2 = await settle(240)
  await snap('follow-up-answer', `settled: ${String(done2)}`)

  // The row menu, the way a person finds it.
  await evaluate(`(async () => {
    const row = document.querySelector('.lc-teammate__mission')
    if (!row) return 'no row'
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 260 }))
    await new Promise(r => setTimeout(r, 300))
    return document.querySelector('[role=menu]') ? 'menu open' : 'no menu'
  })()`)
  await snap('row-menu', 'right-click on the conversation row')
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true")

  // Every screen.
  for (const [title, name] of [['All missions (Ctrl 1)', 'missions-screen'], ['Team (Ctrl 2)', 'team-screen'], ['Settings (Ctrl 3)', 'settings-screen']]) {
    const opened = await evaluate(`(async () => {
      const button = [...document.querySelectorAll('button')].find(b => b.getAttribute('title') === ${JSON.stringify(title)})
      if (!button) return 'no button ' + ${JSON.stringify(title)}
      button.click()
      await new Promise(r => setTimeout(r, 500))
      return 'opened'
    })()`)
    await snap(name, String(opened))
  }
  // Back to the work, then the inspector if there is one.
  await evaluate(`(async () => {
    const button = [...document.querySelectorAll('button')].find(b => b.getAttribute('title') === 'Settings (Ctrl 3)')
    button && button.click()
    await new Promise(r => setTimeout(r, 300))
    const row = document.querySelector('.lc-row')
    row && row.click()
    await new Promise(r => setTimeout(r, 500))
    return true
  })()`)
  await snap('back-to-thread', 'clicked the conversation row from the sidebar')

  await writeFile(join(OUT, 'console.txt'), consoleErrors.join('\n') + '\n', 'utf8')
  await writeFile(join(OUT, 'app-stdio.txt'), appOutput.join(''), 'utf8')
  say(`console errors/warnings: ${String(consoleErrors.length)}`)
  say(`output in ${OUT}`)
} finally {
  try { child.kill() } catch { /* gone */ }
  await sleep(1500)
  if (KEEP) {
    say(`profile kept at ${profile}; workspace at ${workspace}`)
  } else {
    await rm(profile, { recursive: true, force: true }).catch(() => undefined)
    await rm(workspace, { recursive: true, force: true }).catch(() => undefined)
  }
}
