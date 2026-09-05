// The shared half of every "drive the app like a person" script.
//
// A drive is not a smoke: nothing here asserts. It launches the BUILT app
// on a throwaway profile, does what a person does, and keeps what the
// screen showed at each step -- the text, a screenshot, and the renderer's
// error count -- under docs/user-session/<stamp>-<name>/. The judging is
// done afterwards by reading the record (Colin, 2026-09-05: "start taking
// screenshots when you drive the app and test so you can get a user
// experience"), so a hitch is a thing that was seen, not a thing the script
// was told to look for.
//
// Every drive picks its own debugging port and refuses to start when that
// port already answers: two drives on one port both bind it, and the second
// silently drives the first app.

import { spawn, execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const APP_DIR = new URL('../apps/desktop/', import.meta.url).pathname.slice(1)
const ELECTRON = join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const NPM_DIR = 'C:\\Users\\<home>\\AppData\\Roaming\\npm'
export const FREE_ROUTE = { runtime: 'opencode', model: 'opencode/muse-spark-1.3-contributor-free', mode: 'accept-edits' }
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export const say = (line) => console.error(line)
export const git = (args, cwd) => new Promise((resolve, reject) => {
  execFile('git', args, { cwd, windowsHide: true }, (error, stdout) => (error ? reject(error) : resolve(stdout)))
})

/** A scratch git repository with a README and a LOCUST.md, committed. */
export async function scratchRepository(prefix = 'locust-drive-ws-') {
  const workspace = await mkdtemp(join(tmpdir(), prefix))
  await git(['init', '-q', '-b', 'main'], workspace)
  await git(['config', 'user.email', 'drive@locust.test'], workspace)
  await git(['config', 'user.name', 'Locust drive'], workspace)
  await writeFile(join(workspace, 'README.md'), '# scratch\n\nA scratch project for a user session.\n', 'utf8')
  await writeFile(join(workspace, 'LOCUST.md'), 'Keep answers to one paragraph.\n', 'utf8')
  await git(['add', '.'], workspace)
  await git(['commit', '-q', '-m', 'first'], workspace)
  return workspace
}

/**
 * Launch the app and hand back the step recorder.
 *
 * `seed` is the teammates.json to start from (undefined = a fresh profile
 * and the first-launch screen). `env` is merged over the process
 * environment. `keep` leaves the profile and workspace on disk afterwards.
 */
export async function startDrive({ name, port, workspace, seed, files = {}, env = {}, keep = false, profilePath, outPath, stepFrom = 0 }) {
  try {
    const already = await fetch(`http://127.0.0.1:${String(port)}/json/list`, { signal: AbortSignal.timeout(1500) })
    if (already.ok) { say(`something is already debugging on port ${String(port)}`); process.exit(1) }
  } catch { /* free */ }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  // A relaunch on the same profile (a scheduled routine after a quit) keeps
  // writing into the same record, numbering its steps after the first run's.
  const out = outPath ?? join(new URL('../docs/user-session/', import.meta.url).pathname.slice(1), `${stamp}-${name}`)
  await mkdir(out, { recursive: true })
  const profile = profilePath ?? await mkdtemp(join(tmpdir(), `locust-drive-${name}-`))
  if (seed !== undefined && profilePath === undefined) {
    await mkdir(join(profile, 'mission-ledger'), { recursive: true })
    await writeFile(join(profile, 'teammates.json'), JSON.stringify(seed), 'utf8')
  }
  // Other profile files a drive wants in place BEFORE the app reads them
  // (memories.json, rooms.json, routines.json): written before launch, so
  // nothing the app writes at boot can race them.
  for (const [file, content] of Object.entries(files)) {
    await writeFile(join(profile, file), typeof content === 'string' ? content : JSON.stringify(content), 'utf8')
  }
  const child = spawn(ELECTRON, [APP_DIR, `--remote-debugging-port=${String(port)}`, `--user-data-dir=${profile}`], {
    cwd: workspace,
    env: { ...process.env, PATH: `${NPM_DIR};${process.env.PATH ?? ''}`, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const appOutput = []
  child.stdout.on('data', (d) => appOutput.push(String(d)))
  child.stderr.on('data', (d) => appOutput.push(String(d)))
  const record = []
  let step = stepFrom

  let page
  for (let i = 0; i < 80 && page === undefined; i += 1) {
    await sleep(500)
    if (child.exitCode !== null) throw new Error(`app exited ${String(child.exitCode)}\n${appOutput.join('').slice(-800)}`)
    try {
      const list = await (await fetch(`http://127.0.0.1:${String(port)}/json/list`)).json()
      page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
    } catch { /* not up */ }
  }
  if (page === undefined) { try { child.kill() } catch { /* gone */ } throw new Error('renderer never came up') }
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { socket.addEventListener('open', res, { once: true }); socket.addEventListener('error', rej, { once: true }) })
  let id = 0
  const pending = new Map()
  const consoleErrors = []
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.method === 'Runtime.exceptionThrown') consoleErrors.push(message.params?.exceptionDetails?.text ?? 'exception')
    if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') consoleErrors.push(String(message.params.args?.[0]?.value ?? 'console.error'))
    const waiter = pending.get(message.id)
    if (waiter) { pending.delete(message.id); waiter(message) }
  })
  const send = (method, params = {}) => new Promise((resolve_) => {
    const next = ++id
    const gaveUp = setTimeout(() => { if (pending.delete(next)) resolve_(undefined) }, 400_000)
    pending.set(next, (message) => { clearTimeout(gaveUp); resolve_(message) })
    socket.send(JSON.stringify({ id: next, method, params }))
  })
  const evaluate = async (expression) => {
    let message = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    // Right after launch the page can still be finishing its first
    // navigation, and an evaluate that lands in the old context dies with
    // "Execution context was destroyed". Seen at the first step of several
    // smokes on 2026-09-05; the app itself never reloads. One retry.
    if (/Execution context was destroyed/.test(String(message?.error?.message ?? ''))) {
      await sleep(1500)
      message = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    }
    const thrown = message?.result?.exceptionDetails
    if (thrown !== undefined) say(`  eval threw: ${thrown.exception?.description ?? ''}`.slice(0, 200))
    return message?.result?.result?.value
  }
  await send('Runtime.enable')

  /** One step: do it, then keep the screen's text and picture. */
  const capture = async (title, action) => {
    step += 1
    let note
    try {
      note = await action()
    } catch (error) {
      note = `threw: ${error instanceof Error ? error.message : String(error)}`
    }
    await sleep(600)
    const text = await evaluate(`document.body.innerText`)
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    const file = `${String(step).padStart(2, '0')}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
    if (shot?.result?.data) await writeFile(join(out, `${file}.png`), Buffer.from(shot.result.data, 'base64'))
    await writeFile(join(out, `${file}.txt`), String(text ?? ''), 'utf8')
    record.push({ step, title, note: note ?? '', errors: consoleErrors.splice(0) })
    say(`${String(step).padStart(2, '0')}. ${title}${note ? ` -- ${String(note).slice(0, 160)}` : ''}`)
    return note
  }

  /** Wait until discovery has finished, so the first step is the real first screen. */
  const ready = () => evaluate(`(async () => {
    for (let i = 0; i < 240; i += 1) {
      const field = document.querySelector('form.command-dock textarea')
      if (field && !/Checking local runtimes/.test(field.placeholder)) return 'discovery finished; ' + (document.querySelector('.lc-connected')?.innerText ?? '')
      await new Promise(r => setTimeout(r, 250))
    }
    return 'discovery never finished'
  })()`)

  /** Write SESSION.md with the step table and close the app. */
  const finish = async ({ intro, extra = '', last = true }) => {
    const rows = record.map((r) => `| ${String(r.step)} | ${r.title} | ${String(r.note).replace(/\|/g, '/').replace(/\s+/g, ' ').slice(0, 220)} | ${String(r.errors.length)} |`)
    const session = join(out, 'SESSION.md')
    const { readFile } = await import('node:fs/promises')
    const existing = await readFile(session, 'utf8').catch(() => undefined)
    const table = ['| # | Step | What was seen | Renderer errors |', '|---|---|---|---|', ...rows]
    const tail = last ? ['', extra, '## Judgement', '', '(filled in after reading the captures)', ''] : ['']
    const body = existing === undefined
      ? [`# User session ${stamp} — ${name}`, '', intro, '', ...table, ...tail]
      : [existing.replace(/\n## Judgement[\s\S]*$/, '\n'), `## Continued: ${intro}`, '', ...table, ...tail]
    await writeFile(session, body.join('\n'), 'utf8')
    try { socket.close() } catch { /* gone */ }
    try { child.kill() } catch { /* gone */ }
    await sleep(1500)
    if (!keep && last) await rm(profile, { recursive: true, force: true }).catch(() => undefined)
    if (last) say(`\nrecord: ${out}`)
    return { out, profile, step }
  }

  return { evaluate, send, capture, ready, finish, profile, out, record }
}

/**
 * Pick a route from the composer's picker the way a person does: open it,
 * type a search, click the first enabled row under the runtime's group.
 * Returns what the controls read afterwards, or why nothing was picked.
 */
export function pickRouteScript({ group, search, row }) {
  return `(async () => {
    const control = [...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')
    if (!control) return 'no route control'
    if (control.disabled) return 'route control disabled'
    control.click()
    let target
    let notice = null
    for (let attempt = 0; attempt < 60 && !target; attempt += 1) {
      const picker = document.querySelector('.lc-picker')
      if (!picker) { control.click(); await new Promise(r => setTimeout(r, 500)); continue }
      notice = picker.querySelector('.lc-picker__notice')?.innerText ?? null
      const box = picker.querySelector('.lc-picker__input')
      if (box && ${JSON.stringify(search ?? '')}) {
        const setInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        setInput.call(box, ${JSON.stringify(search ?? '')})
        box.dispatchEvent(new Event('input', { bubbles: true }))
        await new Promise(r => setTimeout(r, 500))
      }
      let current = ''
      for (const node of picker.querySelector('.lc-picker__list').children) {
        const header = node.querySelector('.lc-picker__group')
        if (header) current = header.innerText
        const candidate = node.querySelector('.lc-picker__row')
        if (candidate && !candidate.disabled && ${group}.test(current) && ${row ?? '/./'}.test(candidate.innerText)) { target = candidate; break }
      }
      if (!target) await new Promise(r => setTimeout(r, 500))
    }
    if (!target) return 'no matching route; rows: ' + [...document.querySelectorAll('.lc-picker__row')].map(r => r.innerText.replace(/\\s+/g, ' ')).slice(0, 6).join(' | ')
    target.click()
    await new Promise(r => setTimeout(r, 500))
    return (notice ? 'picker said: ' + notice + ' || ' : '') + [...document.querySelectorAll('.lc-control')].map(c => c.innerText.replace(/\\s+/g, ' ').trim()).filter(Boolean).join(' · ')
  })()`
}

/** Type a message, press send, and wait for the run to end (or not, within the bound). */
export function sendAndWaitScript(text, { waitSeconds = 360, settle = true } = {}) {
  return `(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, ${JSON.stringify(text)})
    field.dispatchEvent(new Event('input', { bubbles: true }))
    let sent = false
    for (let i = 0; i < 120 && !sent; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      const button = document.querySelector('button[aria-label="Start mission"]')
      if (button && !button.disabled) { button.click(); sent = true }
    }
    if (!sent) return 'no send'
    if (!${settle ? 'true' : 'false'}) return 'sent'
    for (let i = 0; i < ${String(waitSeconds * 2)}; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      if (i > 4 && !document.querySelector('button[aria-label^="Stop the running"]')) break
    }
    await new Promise(r => setTimeout(r, 800))
    return 'finished: ' + (document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').slice(-300) ?? '')
  })()`
}
